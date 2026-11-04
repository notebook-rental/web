import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cameraErrorMessage } from './cameraErrors';
import { CameraProvider, useCamera } from './CameraProvider';
import { CameraView } from './CameraView';
import { installFakeCamera } from '../test/fakeCamera';
import { useUploadQueue } from '../capture/UploadQueueProvider';

function Probe({ onReady }: { onReady(c: ReturnType<typeof useCamera>): void }) {
  const c = useCamera();
  onReady(c);
  return (
    <>
      <CameraView stream={c.stream} />
      <span data-testid="error">{c.error ?? ''}</span>
    </>
  );
}

describe('CameraProvider', () => {
  it('스트림을 한 번만 열고 다시 쓰며, stop하면 트랙을 끈다', async () => {
    const cam = installFakeCamera();
    let api!: ReturnType<typeof useCamera>;
    render(
      <CameraProvider>
        <Probe onReady={(c) => (api = c)} />
      </CameraProvider>,
    );
    let s1: MediaStream | null = null;
    await act(async () => {
      const [a, b] = await Promise.all([api.start(), api.start()]);
      s1 = a;
      expect(b).toBe(a);
    });
    await act(async () => {
      expect(await api.start()).toBe(s1);
    });
    expect(cam.getUserMedia).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('camera-video') as HTMLVideoElement).srcObject).toBe(cam.stream);
    act(() => api.stop());
    expect(cam.track.stop).toHaveBeenCalled();
  });

  it('권한 거부 등 오류를 한국어로 알린다', async () => {
    installFakeCamera().getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error(), { name: 'NotAllowedError' }),
    );
    let api!: ReturnType<typeof useCamera>;
    render(
      <CameraProvider>
        <Probe onReady={(c) => (api = c)} />
      </CameraProvider>,
    );
    await act(async () => {
      expect(await api.start()).toBeNull();
    });
    expect(screen.getByTestId('error')).toHaveTextContent('카메라 권한이 필요합니다');
  });

  it('오류 이름별 메시지', () => {
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toContain('찾지 못했습니다');
    expect(cameraErrorMessage({ name: 'OverconstrainedError' })).toContain('찾지 못했습니다');
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toContain('다른 앱');
    expect(cameraErrorMessage({ name: 'SecurityError' })).toContain('권한');
    expect(cameraErrorMessage(null)).toContain('새로 고쳐');
  });

  it('Provider 밖에서 쓰면 오류', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe onReady={() => undefined} />)).toThrow('CameraProvider');
    function Q() {
      useUploadQueue();
      return null;
    }
    expect(() => render(<Q />)).toThrow('UploadQueueProvider');
    spy.mockRestore();
  });
});

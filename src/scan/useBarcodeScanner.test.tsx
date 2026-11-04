import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { pretendVideoReady } from '../test/fakeDecoder';
import type { Decoder } from './qrDecoder';
import { useBarcodeScanner } from './useBarcodeScanner';

function Harness(props: { active: boolean; onFrame(v: string[]): void; factory(): Promise<Decoder> }) {
  const ref = useRef<HTMLVideoElement>(null);
  useBarcodeScanner({
    videoRef: ref,
    active: props.active,
    kind: 'qr',
    onFrame: props.onFrame,
    intervalMs: 1,
    decoderFactory: props.factory,
  });
  return <video ref={ref} />;
}

describe('useBarcodeScanner', () => {
  it('해독 실패 프레임은 건너뛰고 계속 읽는다', async () => {
    pretendVideoReady();
    const decode = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(['A']);
    const onFrame = vi.fn();
    const decoder = { decode, dispose: vi.fn() };
    const { unmount } = render(<Harness active onFrame={onFrame} factory={async () => decoder} />);
    await vi.waitFor(() => expect(onFrame).toHaveBeenCalledWith(['A']));
    unmount();
    expect(decoder.dispose).toHaveBeenCalled();
  });

  it('해독기 준비 전에 꺼지면 바로 정리한다', async () => {
    let resolve!: (d: Decoder) => void;
    const decoder = { decode: vi.fn(), dispose: vi.fn() };
    const { unmount } = render(
      <Harness active onFrame={() => undefined} factory={() => new Promise<Decoder>((r) => (resolve = r))} />,
    );
    unmount();
    resolve(decoder);
    await vi.waitFor(() => expect(decoder.dispose).toHaveBeenCalled());
    expect(decoder.decode).not.toHaveBeenCalled();
  });

  it('해독기를 만들지 못해도 오류를 내지 않는다', async () => {
    const factory = vi.fn(() => Promise.reject(new Error('no wasm')));
    render(<Harness active onFrame={() => undefined} factory={factory} />);
    await vi.waitFor(() => expect(factory).toHaveBeenCalled());
  });

  it('active가 아니면 해독기를 만들지 않는다', () => {
    const factory = vi.fn();
    render(<Harness active={false} onFrame={() => undefined} factory={factory} />);
    expect(factory).not.toHaveBeenCalled();
  });
});

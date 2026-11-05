import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraView } from './CameraView';
import { VIDEO_CONSTRAINTS } from './cameraErrors';

function setVideoSize(v: HTMLVideoElement, w: number, h: number) {
  Object.defineProperty(v, 'videoWidth', { value: w, configurable: true });
  Object.defineProperty(v, 'videoHeight', { value: h, configurable: true });
}

afterEach(() => document.body.replaceChildren());

describe('CameraView', () => {
  it('기본(cover)은 영상과 겹칠 것을 그대로 담는다', () => {
    const { container } = render(
      <CameraView stream={null}>
        <span>틀</span>
      </CameraView>,
    );
    expect(container.querySelector('.camera')).not.toHaveClass('camera--contain');
    expect(container.querySelector('.camera__stage')).toBeNull();
    expect(screen.getByText('틀')).toBeInTheDocument();
  });

  it('contain은 영상 비율을 재서 칸 안에 가장 크게 놓고, 폰을 돌리면 다시 잰다', () => {
    let resized: (() => void) | undefined;
    const box = { w: 400, h: 600 };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { container } = render(
      <CameraView stream={null} fit="contain">
        <span>틀</span>
      </CameraView>,
    );
    const outer = container.querySelector<HTMLElement>('.camera--contain')!;
    Object.defineProperty(outer, 'clientWidth', { get: () => box.w });
    Object.defineProperty(outer, 'clientHeight', { get: () => box.h });
    const stage = container.querySelector<HTMLElement>('.camera__stage')!;
    expect(stage).not.toHaveAttribute('data-aspect');
    act(() => resized!());
    // 비율을 모를 때는 세로 4:3으로 놓는다
    expect([stage.style.width, stage.style.height]).toEqual(['400px', '533px']);

    const video = screen.getByTestId('camera-video') as HTMLVideoElement;
    setVideoSize(video, 4000, 3000);
    fireEvent(video, new Event('loadedmetadata'));
    expect(stage).toHaveAttribute('data-aspect', String(4000 / 3000));
    expect([stage.style.width, stage.style.height]).toEqual(['400px', '300px']);

    box.w = 900;
    box.h = 300;
    act(() => resized!());
    expect([stage.style.width, stage.style.height]).toEqual(['400px', '300px']);
    vi.unstubAllGlobals();
  });

  it('카메라는 센서 그대로인 4:3으로 요청한다(16:9면 화각이 좁아 폰을 높이 들어야 한다)', () => {
    expect(VIDEO_CONSTRAINTS.video).toMatchObject({ aspectRatio: { ideal: 4 / 3 } });
  });
});

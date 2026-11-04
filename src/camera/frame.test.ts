import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureStill, grabFrame, grabImageData } from './frame';

function video(w = 1920, h = 1080) {
  const v = document.createElement('video');
  Object.defineProperty(v, 'videoWidth', { value: w });
  Object.defineProperty(v, 'videoHeight', { value: h });
  return v;
}

function stubCanvas(blob: Blob | null = new Blob(['jpg'])) {
  const sizes: number[][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    sizes.push([this.width, this.height]);
    return {
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h }),
    } as never;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(blob));
  return sizes;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { ImageCapture?: unknown }).ImageCapture;
});

describe('frame', () => {
  it('ImageCapture가 있으면 takePhoto로 최대 해상도 사진을 찍는다', async () => {
    const photo = new Blob(['full']);
    (globalThis as { ImageCapture?: unknown }).ImageCapture = class {
      takePhoto = async () => photo;
    };
    const stream = { getVideoTracks: () => [{}] } as unknown as MediaStream;
    await expect(captureStill(video(), stream)).resolves.toBe(photo);
  });

  it('takePhoto가 실패하거나 없으면 영상 프레임을 JPEG로 만든다', async () => {
    stubCanvas();
    (globalThis as { ImageCapture?: unknown }).ImageCapture = class {
      takePhoto = async () => {
        throw new Error('x');
      };
    };
    const stream = { getVideoTracks: () => [{}] } as unknown as MediaStream;
    const b = await captureStill(video(), stream);
    expect(b).toBeInstanceOf(Blob);
    delete (globalThis as { ImageCapture?: unknown }).ImageCapture;
    await expect(captureStill(video(), null)).resolves.toBeInstanceOf(Blob);
  });

  it('grabFrame은 최대 크기로 줄이고, 실패하면 오류', async () => {
    const sizes = stubCanvas(null);
    await expect(grabFrame(video(), 0.9, 960)).rejects.toThrow('사진을 만들지');
    expect(sizes[0]).toEqual([960, 540]);
  });

  it('grabImageData는 영상이 없으면 null', () => {
    stubCanvas();
    expect(grabImageData(video(0, 0), 100)).toBeNull();
    expect(grabImageData(video(200, 100), 100)).toEqual({ width: 100, height: 50 });
  });
});

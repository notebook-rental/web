import { vi } from 'vitest';
import type { Decoder } from '../scan/qrDecoder';

/** 프레임마다 정해진 값을 돌려주는 가짜 해독기. 목록이 끝나면 마지막 값을 계속 돌려준다. */
export function fakeDecoderFactory(frames: string[][]) {
  let i = 0;
  const decoder: Decoder = {
    decode: vi.fn(async () => frames[Math.min(i++, frames.length - 1)] ?? []),
    dispose: vi.fn(),
  };
  const factory = vi.fn(async () => decoder);
  return { factory, decoder };
}

/** jsdom의 video는 영상을 재생하지 않으므로, 준비된 것처럼 보이게 한다. */
export function pretendVideoReady() {
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: () => 4, configurable: true });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    value: () => Promise.resolve(),
    configurable: true,
    writable: true,
  });
}

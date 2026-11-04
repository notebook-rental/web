import { vi } from 'vitest';

/** getUserMedia를 가짜 스트림으로 바꾼다. */
export function installFakeCamera() {
  const track = {
    readyState: 'live',
    stop: vi.fn(function (this: { readyState: string }) {
      this.readyState = 'ended';
    }),
  };
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  return { stream, track, getUserMedia };
}

export function removeCamera() {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
}

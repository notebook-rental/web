/**
 * video에서 사진 한 장을 얻는다.
 * ImageCapture.takePhoto()를 지원하면(안드로이드 Chrome) 카메라 최대 해상도로 찍고,
 * 아니면(iOS Safari) 지금 보이는 영상 프레임을 그대로 JPEG로 만든다.
 */

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

export async function captureStill(video: HTMLVideoElement, stream: MediaStream | null): Promise<Blob> {
  const Ctor = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  const track = stream?.getVideoTracks()[0];
  if (Ctor && track) {
    try {
      return await new Ctor(track).takePhoto();
    } catch {
      // 일부 기기는 takePhoto가 실패한다. 프레임 캡처로 넘어간다.
    }
  }
  return grabFrame(video, 0.95);
}

export function grabFrame(video: HTMLVideoElement, quality: number, maxSide = Infinity): Promise<Blob> {
  const canvas = frameCanvas(video, maxSide);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('사진을 만들지 못했습니다.'))),
      'image/jpeg',
      quality,
    ),
  );
}

/** QR 해독용으로 video 프레임을 작은 ImageData로 만든다. */
export function grabImageData(video: HTMLVideoElement, maxSide: number): ImageData | null {
  if (!video.videoWidth) return null;
  const canvas = frameCanvas(video, maxSide);
  return (
    canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height) ??
    null
  );
}

function frameCanvas(video: HTMLVideoElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

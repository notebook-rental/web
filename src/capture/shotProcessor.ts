import {
  ANALYSIS_MAX_SIDE,
  WORKING_JPEG_QUALITY,
  WORKING_MAX_SIDE,
  fitWithin,
  measureQuality,
  qualityReasons,
  sha256Hex,
  type QualityMetrics,
} from './imageOps';

/**
 * 찍은 원본 한 장을 처리한다: 원본 해시, 작업본(2560px JPEG), 1차 품질 검사.
 * Web Worker 안에서도, 화면 스레드에서도 같은 코드가 돈다(Worker를 못 쓰는 브라우저 대비).
 */

export interface ProcessedShot {
  working: Blob;
  originalSha256: string;
  width: number;
  height: number;
  metrics: QualityMetrics;
  reasons: string[];
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function canvasToJpeg(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('작업본을 만들지 못했습니다.'))),
      'image/jpeg',
      quality,
    ),
  );
}

function draw(bitmap: ImageBitmap, size: { width: number; height: number }) {
  const canvas = makeCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('이미지를 처리할 수 없는 브라우저입니다.');
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return { canvas, ctx };
}

export async function processShot(original: Blob): Promise<ProcessedShot> {
  const [buffer, bitmap] = await Promise.all([original.arrayBuffer(), createImageBitmap(original)]);
  try {
    const originalSha256 = await sha256Hex(buffer);

    const small = fitWithin(bitmap.width, bitmap.height, ANALYSIS_MAX_SIDE);
    const a = draw(bitmap, small);
    const pixels = a.ctx.getImageData(0, 0, small.width, small.height);
    const metrics = measureQuality(pixels.data, small.width, small.height);

    const size = fitWithin(bitmap.width, bitmap.height, WORKING_MAX_SIDE);
    const w = draw(bitmap, size);
    const working = await canvasToJpeg(w.canvas, WORKING_JPEG_QUALITY);

    return {
      working,
      originalSha256,
      width: bitmap.width,
      height: bitmap.height,
      metrics,
      reasons: qualityReasons(metrics),
    };
  } finally {
    bitmap.close?.();
  }
}

export interface ShotWorkerLike {
  postMessage(msg: { id: number; blob: Blob }): void;
  addEventListener(
    type: 'message',
    fn: (e: MessageEvent<{ id: number; result?: ProcessedShot; error?: string }>) => void,
  ): void;
  terminate(): void;
}

export type ShotProcessor = ((original: Blob) => Promise<ProcessedShot>) & { dispose(): void };

/** Worker를 쓸 수 있으면 Worker에서, 아니면 화면 스레드에서 처리하는 함수를 만든다. */
export function createShotProcessor(makeWorker?: () => ShotWorkerLike | null): ShotProcessor {
  const factory =
    makeWorker ??
    (() =>
      typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
        ? (new Worker(new URL('./shot.worker.ts', import.meta.url), {
            type: 'module',
          }) as unknown as ShotWorkerLike)
        : null);
  let worker: ShotWorkerLike | null = null;
  try {
    worker = factory();
  } catch {
    worker = null;
  }
  if (!worker) {
    const fn = ((b: Blob) => processShot(b)) as ShotProcessor;
    fn.dispose = () => {};
    return fn;
  }
  const w = worker;
  let seq = 0;
  const waiting = new Map<number, { resolve(r: ProcessedShot): void; reject(e: Error): void }>();
  w.addEventListener('message', (e) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    if (e.data.result) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? '사진 처리에 실패했습니다.'));
  });
  const fn = ((blob: Blob) =>
    new Promise<ProcessedShot>((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      w.postMessage({ id, blob });
    })) as ShotProcessor;
  fn.dispose = () => {
    w.terminate();
    waiting.clear();
  };
  return fn;
}

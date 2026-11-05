import {
  ANALYSIS_MAX_SIDE,
  WORKING_FALLBACKS,
  WORKING_JPEG_QUALITY,
  WORKING_MAX_BYTES,
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

async function encodeWorking(bitmap: ImageBitmap, side: number, quality: number): Promise<Blob> {
  const w = draw(bitmap, fitWithin(bitmap.width, bitmap.height, side));
  return canvasToJpeg(w.canvas, quality);
}

export async function processShot(original: Blob): Promise<ProcessedShot> {
  const [buffer, bitmap] = await Promise.all([original.arrayBuffer(), createImageBitmap(original)]);
  try {
    const originalSha256 = await sha256Hex(buffer);

    const small = fitWithin(bitmap.width, bitmap.height, ANALYSIS_MAX_SIDE);
    const a = draw(bitmap, small);
    const pixels = a.ctx.getImageData(0, 0, small.width, small.height);
    const metrics = measureQuality(pixels.data, small.width, small.height);

    let working = await encodeWorking(bitmap, WORKING_MAX_SIDE, WORKING_JPEG_QUALITY);
    // 1MB를 넘으면 품질·크기를 조금씩 낮춘다(서버 앞단 업로드 한도 대비).
    for (const f of WORKING_FALLBACKS) {
      if (working.size <= WORKING_MAX_BYTES) break;
      working = await encodeWorking(bitmap, f.side, f.quality);
    }

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

/**
 * Worker와 주고받는 메시지. Blob 대신 ArrayBuffer로 주고받는다.
 * iOS Safari는 Worker에서 만든 Blob(또는 Worker로 넘긴 Blob)을 화면 쪽 fetch로 올리면
 * "Load failed"로 실패하고, 다시 올려도 계속 실패한다. 바이트로 넘기고 화면 쪽에서 Blob을 새로 만든다.
 */
export interface ShotWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  type: string;
}
export type ShotWorkerResult = Omit<ProcessedShot, 'working'> & { workingBuffer: ArrayBuffer };
export interface ShotWorkerResponse {
  id: number;
  result?: ShotWorkerResult;
  error?: string;
}

/** Worker 안에서 한 장을 처리해 바이트로 돌려준다. */
export async function processShotForWorker(req: ShotWorkerRequest): Promise<ShotWorkerResult> {
  const { working, ...rest } = await processShot(new Blob([req.buffer], { type: req.type || 'image/jpeg' }));
  return { ...rest, workingBuffer: await working.arrayBuffer() };
}

export interface ShotWorkerLike {
  postMessage(msg: ShotWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<ShotWorkerResponse>) => void): void;
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
    const r = e.data.result;
    if (r) {
      const { workingBuffer, ...rest } = r;
      p.resolve({ ...rest, working: new Blob([workingBuffer], { type: 'image/jpeg' }) });
    } else p.reject(new Error(e.data.error ?? '사진 처리에 실패했습니다.'));
  });
  const fn = (async (blob: Blob) => {
    const buffer = await blob.arrayBuffer();
    return new Promise<ProcessedShot>((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      w.postMessage({ id, buffer, type: blob.type }, [buffer]);
    });
  }) as ShotProcessor;
  fn.dispose = () => {
    w.terminate();
    waiting.clear();
  };
  return fn;
}

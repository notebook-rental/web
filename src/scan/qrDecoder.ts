import { grabImageData } from '../camera/frame';

/**
 * 카메라 프레임에서 자산 번호 라벨(QR 또는 바코드)을 읽는다. 사진은 저장하지 않는다(FR-006).
 *
 * 1순위: 브라우저 내장 BarcodeDetector(안드로이드 Chrome 등). 빠르고 추가 다운로드가 없다.
 * 2순위: zxing-wasm(WebAssembly)을 Web Worker에서 실행. iOS Safari처럼 내장 기능이 없을 때 쓴다.
 *        Worker에서 돌리므로 해독 중에도 화면이 멈추지 않는다.
 */

/**
 * 무엇을 읽을지. 찾는 형식이 적을수록 빠르고 잘못 읽는 일이 줄어든다.
 * - auto: QR과 바코드 모두(기본). 시리얼 라벨 읽기에도 쓴다
 * - qr: QR만
 * - barcode: 1차원 바코드(Code128, Code39)만
 */
export type BarcodeKind = 'auto' | 'qr' | 'barcode';

export interface Decoder {
  decode(source: HTMLVideoElement | ImageBitmap | Blob): Promise<string[]>;
  dispose(): void;
}

// BarcodeDetector 이름 → zxing-wasm 이름
const FORMATS: Record<BarcodeKind, { native: string[]; zxing: string[] }> = {
  qr: { native: ['qr_code'], zxing: ['QRCode'] },
  barcode: { native: ['code_128', 'code_39'], zxing: ['Code128', 'Code39'] },
  auto: {
    native: ['qr_code', 'code_128', 'code_39', 'data_matrix'],
    zxing: ['QRCode', 'Code128', 'Code39', 'DataMatrix'],
  },
};

interface NativeDetector {
  detect(source: unknown): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorCtor {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats?(): Promise<string[]>;
}

export async function nativeDetector(kind: BarcodeKind): Promise<NativeDetector | null> {
  const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [];
    const wanted = FORMATS[kind].native.filter((f) => supported.includes(f));
    if (wanted.length === 0) return null;
    return new Ctor({ formats: wanted });
  } catch {
    return null;
  }
}

/** Worker와 주고받는 메시지 */
export interface WorkerRequest {
  id: number;
  image: ImageData | Blob;
  formats: string[];
}
export interface WorkerResponse {
  id: number;
  texts: string[];
  error?: string;
}

export interface WorkerLike {
  postMessage(msg: WorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<WorkerResponse>) => void): void;
  terminate(): void;
}

/** Worker에 해독을 맡기는 Decoder. 요청마다 id를 붙여 응답을 짝지운다. */
export function workerDecoder(worker: WorkerLike, kind: BarcodeKind, maxSide = 1280): Decoder {
  let seq = 0;
  const waiting = new Map<number, (r: WorkerResponse) => void>();
  worker.addEventListener('message', (e) => {
    const resolve = waiting.get(e.data.id);
    if (resolve) {
      waiting.delete(e.data.id);
      resolve(e.data);
    }
  });
  return {
    async decode(source) {
      let image: ImageData | Blob | null;
      if (source instanceof Blob) image = source;
      else if (source instanceof HTMLVideoElement) image = grabImageData(source, maxSide);
      else image = bitmapToImageData(source, maxSide);
      if (!image) return [];
      const id = ++seq;
      const res = await new Promise<WorkerResponse>((resolve) => {
        waiting.set(id, resolve);
        worker.postMessage({ id, image: image!, formats: FORMATS[kind].zxing });
      });
      return res.texts;
    },
    dispose() {
      worker.terminate();
      waiting.clear();
    },
  };
}

function bitmapToImageData(bitmap: ImageBitmap, maxSide: number): ImageData | null {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function nativeDecoder(detector: NativeDetector): Decoder {
  return {
    async decode(source) {
      const input = source instanceof Blob ? await createImageBitmap(source) : source;
      const found = await detector.detect(input);
      return found.map((f) => f.rawValue);
    },
    dispose() {},
  };
}

export type WorkerFactory = () => WorkerLike;

const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./qr.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

/** 쓸 수 있는 가장 빠른 Decoder를 만든다. */
export async function createDecoder(
  kind: BarcodeKind,
  makeWorker: WorkerFactory = defaultWorkerFactory,
): Promise<Decoder> {
  const native = await nativeDetector(kind);
  if (native) return nativeDecoder(native);
  return workerDecoder(makeWorker(), kind);
}

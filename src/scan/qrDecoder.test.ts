import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDecoder,
  nativeDecoder,
  nativeDetector,
  workerDecoder,
  type WorkerLike,
  type WorkerRequest,
} from './qrDecoder';

function fakeWorker(reply: (req: WorkerRequest) => string[]) {
  let listener: ((e: MessageEvent) => void) | null = null;
  const posted: WorkerRequest[] = [];
  const worker: WorkerLike & { posted: WorkerRequest[] } = {
    posted,
    postMessage(msg) {
      posted.push(msg);
      queueMicrotask(() => listener?.({ data: { id: msg.id, texts: reply(msg) } } as MessageEvent));
    },
    addEventListener(_t, fn) {
      listener = fn as (e: MessageEvent) => void;
    },
    terminate: vi.fn(),
  };
  return worker;
}

function stubCanvas() {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  return ctx;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
});

describe('workerDecoder', () => {
  it('Blob을 Worker로 보내고 응답을 요청 id로 짝지운다', async () => {
    const w = fakeWorker(() => ['NR1:7K3M9QX2TD']);
    const d = workerDecoder(w, 'qr');
    await expect(d.decode(new Blob(['x']))).resolves.toEqual(['NR1:7K3M9QX2TD']);
    expect(w.posted[0].formats).toEqual(['QRCode']);
    d.dispose();
    expect(w.terminate).toHaveBeenCalled();
  });

  it('video는 축소한 ImageData로 보낸다', async () => {
    stubCanvas();
    const w = fakeWorker((req) => [String((req.image as ImageData).width)]);
    const d = workerDecoder(w, 'barcode', 100);
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 400 });
    Object.defineProperty(video, 'videoHeight', { value: 200 });
    await expect(d.decode(video)).resolves.toEqual(['100']);
    expect(w.posted[0].formats).toContain('Code128');
  });

  it('영상이 아직 준비되지 않았으면 빈 결과', async () => {
    const w = fakeWorker(() => ['x']);
    const d = workerDecoder(w, 'qr');
    await expect(d.decode(document.createElement('video'))).resolves.toEqual([]);
    expect(w.posted).toHaveLength(0);
  });

  it('ImageBitmap도 ImageData로 바꿔 보낸다', async () => {
    stubCanvas();
    const w = fakeWorker((req) => [String((req.image as ImageData).height)]);
    const d = workerDecoder(w, 'qr', 50);
    await expect(d.decode({ width: 100, height: 200 } as ImageBitmap)).resolves.toEqual(['50']);
  });

  it('canvas를 못 쓰면 ImageBitmap은 빈 결과', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const d = workerDecoder(
      fakeWorker(() => ['x']),
      'qr',
    );
    await expect(d.decode({ width: 10, height: 10 } as ImageBitmap)).resolves.toEqual([]);
  });

  it('모르는 id의 응답은 무시한다', async () => {
    let listener: ((e: MessageEvent) => void) | null = null;
    const w: WorkerLike = {
      postMessage(msg) {
        listener?.({ data: { id: 999, texts: ['wrong'] } } as MessageEvent);
        listener?.({ data: { id: msg.id, texts: ['right'] } } as MessageEvent);
      },
      addEventListener: (_t, fn) => void (listener = fn as (e: MessageEvent) => void),
      terminate() {},
    };
    await expect(workerDecoder(w, 'qr').decode(new Blob())).resolves.toEqual(['right']);
  });
});

describe('BarcodeDetector', () => {
  function installDetector(supported: string[], found: string[]) {
    const detect = vi.fn(async () => found.map((rawValue) => ({ rawValue })));
    const Ctor = vi.fn(function (this: { detect: typeof detect }, opts: { formats: string[] }) {
      this.detect = detect;
      (Ctor as unknown as { lastFormats: string[] }).lastFormats = opts.formats;
    }) as unknown as { getSupportedFormats: () => Promise<string[]>; lastFormats: string[] };
    Ctor.getSupportedFormats = async () => supported;
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = Ctor;
    return { Ctor, detect };
  }

  it('지원하면 내장 기능을 쓰고, 지원하는 형식만 고른다', async () => {
    const { Ctor } = installDetector(['qr_code', 'code_128'], ['A']);
    const d = await createDecoder('auto', () => {
      throw new Error('worker 쓰면 안 됨');
    });
    expect(Ctor.lastFormats).toEqual(['qr_code', 'code_128']);
    await expect(d.decode(document.createElement('video'))).resolves.toEqual(['A']);
    d.dispose();
  });

  it('Blob은 ImageBitmap으로 바꿔 넘긴다', async () => {
    const { detect } = installDetector(['qr_code'], ['B']);
    const bitmap = { width: 1, height: 1 };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const det = await nativeDetector('qr');
    await expect(nativeDecoder(det!).decode(new Blob())).resolves.toEqual(['B']);
    expect(detect).toHaveBeenCalledWith(bitmap);
    vi.unstubAllGlobals();
  });

  it('QR을 지원하지 않거나 오류가 나면 Worker로 넘어간다', async () => {
    installDetector(['ean_13'], []);
    expect(await nativeDetector('qr')).toBeNull();
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = Object.assign(function () {}, {
      getSupportedFormats: async () => {
        throw new Error('x');
      },
    });
    expect(await nativeDetector('qr')).toBeNull();
    const w = fakeWorker(() => ['W']);
    const d = await createDecoder('qr', () => w);
    await expect(d.decode(new Blob())).resolves.toEqual(['W']);
  });

  it('BarcodeDetector가 없으면 null', async () => {
    expect(await nativeDetector('qr')).toBeNull();
  });
});

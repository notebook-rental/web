import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createShotProcessor,
  processShot,
  processShotForWorker,
  type ShotWorkerLike,
  type ShotWorkerRequest,
  type ShotWorkerResult,
} from './shotProcessor';

function fakeBlob(text: string): Blob {
  const b = new Blob([text]);
  // jsdom Blob에는 arrayBuffer가 없다.
  Object.defineProperty(b, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer });
  return b;
}

function installCanvas(kind: 'offscreen' | 'dom', pixel = 128, checker = true) {
  const drawn: { width: number; height: number }[] = [];
  const ctx = (w: number, h: number) => ({
    drawImage: vi.fn(),
    getImageData: () => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const v = checker ? (((i % w) + Math.floor(i / w)) % 2 ? 255 : 0) : pixel;
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
      }
      return { data, width: w, height: h };
    },
  });
  if (kind === 'offscreen') {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          drawn.push({ width, height });
        }
        getContext() {
          return ctx(this.width, this.height);
        }
        async convertToBlob(opts: { type: string; quality: number }) {
          return new Blob([`jpeg ${this.width}x${this.height} q${opts.quality}`]);
        }
      },
    );
  } else {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      drawn.push({ width: this.width, height: this.height });
      return ctx(this.width, this.height) as never;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb,
    ) {
      cb(new Blob(['jpeg']));
    });
  }
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4000, height: 3000, close })),
  );
  return { drawn, close };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('processShot', () => {
  it('원본 해시, 2560px 작업본, 품질 지표를 만든다(OffscreenCanvas)', async () => {
    const { drawn, close } = installCanvas('offscreen');
    const r = await processShot(fakeBlob('abc'));
    expect(r.originalSha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(r.width).toBe(4000);
    expect(drawn).toEqual([
      { width: 512, height: 384 },
      { width: 2560, height: 1920 },
    ]);
    expect(r.reasons).toEqual([]);
    expect(r.metrics.sharpness).toBeGreaterThan(1000);
    expect(close).toHaveBeenCalled();
  });

  it('작업본이 900KB를 넘으면 품질·크기를 낮춰 다시 만든다(서버 앞단 1MB 한도 대비)', async () => {
    const { drawn } = installCanvas('offscreen');
    const sizes: number[] = [];
    vi.spyOn(OffscreenCanvas.prototype, 'convertToBlob').mockImplementation(async function (
      this: OffscreenCanvas,
      opts?: ImageEncodeOptions,
    ) {
      // 2560px 품질 0.8 이상이면 1.2MB, 그 아래는 500KB인 척한다
      const big = this.width === 2560 && (opts?.quality ?? 1) >= 0.8;
      const b = new Blob([new Uint8Array(big ? 1_200_000 : 500_000)]);
      sizes.push(b.size);
      return b;
    });
    const r = await processShot(fakeBlob('abc'));
    expect(sizes).toEqual([1_200_000, 1_200_000, 500_000]);
    expect(r.working.size).toBe(500_000);
    expect(drawn.slice(1).every((d) => d.width === 2560)).toBe(true);
  });

  it('OffscreenCanvas가 없으면 일반 canvas를 쓰고, 흐린 사진은 사유를 붙인다', async () => {
    installCanvas('dom', 128, false);
    const r = await processShot(fakeBlob('x'));
    expect(r.reasons).toEqual(['blurry']);
  });

  it('canvas가 Blob을 못 만들면 오류', async () => {
    installCanvas('dom');
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    await expect(processShot(fakeBlob('x'))).rejects.toThrow('작업본');
  });

  it('2D 컨텍스트가 없으면 오류', async () => {
    installCanvas('dom');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(processShot(fakeBlob('x'))).rejects.toThrow('브라우저');
  });
});

/** jsdom Blob에는 arrayBuffer가 없다. Worker 주고받기 검사 동안만 FileReader로 채운다. */
function withBlobArrayBuffer() {
  const proto = Blob.prototype as { arrayBuffer?: () => Promise<ArrayBuffer> };
  const had = Object.prototype.hasOwnProperty.call(proto, 'arrayBuffer');
  beforeAll(() => {
    if (!had)
      proto.arrayBuffer = function (this: Blob) {
        return new Promise<ArrayBuffer>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as ArrayBuffer);
          fr.readAsArrayBuffer(this);
        });
      };
  });
  afterAll(() => {
    if (!had) delete proto.arrayBuffer;
  });
}

describe('createShotProcessor', () => {
  withBlobArrayBuffer();
  const sent: { msg: ShotWorkerRequest; transfer?: Transferable[] }[] = [];
  const result = (): ShotWorkerResult =>
    ({ originalSha256: 'h', workingBuffer: new Uint8Array([1, 2, 3]).buffer }) as ShotWorkerResult;

  function worker(respond: 'ok' | 'error' | 'errorNoMessage') {
    let listener: ((e: MessageEvent) => void) | null = null;
    const w: ShotWorkerLike = {
      postMessage(msg, transfer) {
        sent.push({ msg, transfer });
        queueMicrotask(() => {
          listener?.({ data: { id: 12345, result: result() } } as MessageEvent); // 다른 요청의 응답은 무시
          const data =
            respond === 'ok'
              ? { id: msg.id, result: result() }
              : respond === 'error'
                ? { id: msg.id, error: '디코딩 실패' }
                : { id: msg.id };
          listener?.({ data } as MessageEvent);
        });
      },
      addEventListener: (_t, fn) => void (listener = fn as (e: MessageEvent) => void),
      terminate: vi.fn(),
    };
    return w;
  }

  it('Worker가 있으면 Worker에서 처리하고, Blob 대신 바이트로 주고받는다(iOS Safari Load failed 방지)', async () => {
    sent.length = 0;
    const w = worker('ok');
    const p = createShotProcessor(() => w);
    const out = await p(new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }));
    // 보낼 때: ArrayBuffer를 넘기고(transfer), 원본의 형식을 함께 알린다.
    expect(sent[0].msg.buffer).toBeInstanceOf(ArrayBuffer);
    expect(sent[0].msg.type).toBe('image/jpeg');
    expect(sent[0].transfer).toEqual([sent[0].msg.buffer]);
    // 받을 때: 화면 쪽에서 작업본 Blob을 새로 만든다.
    expect(out.originalSha256).toBe('h');
    expect(out.working).toBeInstanceOf(Blob);
    expect(out.working.type).toBe('image/jpeg');
    expect(new Uint8Array(await out.working.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(out).not.toHaveProperty('workingBuffer');
    p.dispose();
    expect(w.terminate).toHaveBeenCalled();
  });

  it('Worker 오류를 그대로 알린다', async () => {
    await expect(createShotProcessor(() => worker('error'))(new Blob())).rejects.toThrow('디코딩 실패');
    await expect(createShotProcessor(() => worker('errorNoMessage'))(new Blob())).rejects.toThrow(
      '사진 처리',
    );
  });

  it('Worker를 만들 수 없으면 화면 스레드에서 처리한다', async () => {
    installCanvas('offscreen');
    const p = createShotProcessor(() => {
      throw new Error('no worker');
    });
    await expect(p(fakeBlob('a'))).resolves.toMatchObject({ width: 4000 });
    p.dispose();
    const q = createShotProcessor(() => null);
    await expect(q(fakeBlob('a'))).resolves.toMatchObject({ width: 4000 });
  });

  it('기본 설정: jsdom에는 OffscreenCanvas가 없어 화면 스레드로 처리한다', () => {
    const p = createShotProcessor();
    expect(typeof p).toBe('function');
    p.dispose();
  });
});

describe('processShotForWorker', () => {
  withBlobArrayBuffer();
  it('바이트로 받은 원본을 처리해 작업본도 바이트로 돌려준다', async () => {
    installCanvas('offscreen');
    const buffer = await fakeBlob('a').arrayBuffer();
    const r = await processShotForWorker({ id: 1, buffer, type: '' });
    expect(r.workingBuffer).toBeInstanceOf(ArrayBuffer);
    expect(r).not.toHaveProperty('working');
    expect(r.width).toBe(4000);
  });
});

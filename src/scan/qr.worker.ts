/// <reference lib="webworker" />
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { WorkerRequest, WorkerResponse } from './qrDecoder';

// wasm 파일을 외부 CDN이 아니라 우리 서버(빌드 결과물)에서 받는다. 오프라인(PWA 캐시)에서도 동작한다.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, image, formats } = e.data;
  const reply = (r: WorkerResponse) => (self as unknown as Worker).postMessage(r);
  try {
    const results = await readBarcodes(image, {
      formats: formats as ReaderOptions['formats'],
      tryHarder: true,
      maxNumberOfSymbols: 4,
    });
    reply({ id, texts: results.filter((r) => r.isValid).map((r) => r.text) });
  } catch (err) {
    reply({ id, texts: [], error: String(err) });
  }
};

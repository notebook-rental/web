/// <reference lib="webworker" />
import { processShot } from './shotProcessor';

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
  try {
    post({ id: e.data.id, result: await processShot(e.data.blob) });
  } catch (err) {
    post({ id: e.data.id, error: err instanceof Error ? err.message : String(err) });
  }
};

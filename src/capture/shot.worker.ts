/// <reference lib="webworker" />
import { processShotForWorker, type ShotWorkerRequest } from './shotProcessor';

self.onmessage = async (e: MessageEvent<ShotWorkerRequest>) => {
  const scope = self as unknown as Worker;
  try {
    const result = await processShotForWorker(e.data);
    scope.postMessage({ id: e.data.id, result }, [result.workingBuffer]);
  } catch (err) {
    scope.postMessage({ id: e.data.id, error: err instanceof Error ? err.message : String(err) });
  }
};

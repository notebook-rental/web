import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useServices } from '../app/services';
import { memoryKvStore, openKvStore } from './kvStore';
import { OriginalUploadQueue, putToSignedUrl, type PendingOriginal, type QueueSnapshot } from './uploadQueue';

interface QueueContextValue {
  queue: OriginalUploadQueue;
  snapshot: QueueSnapshot;
}

const QueueContext = createContext<QueueContextValue | null>(null);

export function UploadQueueProvider({
  children,
  queue: injected,
}: {
  children: ReactNode;
  queue?: OriginalUploadQueue;
}) {
  const { endpoints } = useServices();
  const queue = useMemo(
    () =>
      injected ??
      new OriginalUploadQueue({
        store:
          typeof indexedDB !== 'undefined'
            ? openKvStore<PendingOriginal>('notebook-rental', 'originals')
            : memoryKvStore<PendingOriginal>(),
        put: (url, blob) => putToSignedUrl(url, blob),
        confirm: (inspectionId, photoId) => endpoints.confirmOriginal(inspectionId, photoId),
      }),
    [injected, endpoints],
  );
  const [snapshot, setSnapshot] = useState<QueueSnapshot>({ pending: 0, failed: 0, items: [] });

  useEffect(() => {
    const unsubscribe = queue.subscribe((next) =>
      setSnapshot((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)),
    );
    // 앱을 다시 열었을 때 남은 원본을 이어서 올리고, 통신이 돌아오면 다시 시도한다.
    void queue.drain();
    const online = () => void queue.retryFailed();
    window.addEventListener('online', online);
    return () => {
      unsubscribe();
      window.removeEventListener('online', online);
    };
  }, [queue]);

  return <QueueContext.Provider value={{ queue, snapshot }}>{children}</QueueContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUploadQueue(): QueueContextValue {
  const v = useContext(QueueContext);
  if (!v) throw new Error('UploadQueueProvider 안에서만 쓸 수 있습니다.');
  return v;
}

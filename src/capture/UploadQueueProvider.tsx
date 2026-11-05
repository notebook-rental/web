import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useServices } from '../app/services';
import { ApiError } from '../api/client';
import { memoryKvStore, openKvStore, resilientKvStore } from './kvStore';
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
            ? resilientKvStore(openKvStore<PendingOriginal>('notebook-rental', 'originals'))
            : memoryKvStore<PendingOriginal>(),
        // 원본은 서버를 거쳐 올린다. 폰에서 저장소(MinIO) 주소로 바로 PUT하면 주소·CORS·HTTPS 설정에 따라
        // 막힐 수 있어서다. 서버가 아직 이 기능을 모르면(404·405) 예전처럼 서명 URL로 올린다.
        put: async (url, blob, item) => {
          try {
            await endpoints.uploadOriginal(item.inspectionId, item.photoId, blob);
            return new Response(null, { status: 200 });
          } catch (e) {
            if (e instanceof ApiError && (e.status === 404 || e.status === 405))
              return putToSignedUrl(url, blob);
            throw e;
          }
        },
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

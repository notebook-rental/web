/**
 * IndexedDB를 아주 얇게 감싼 키-값 저장소.
 * 원본 사진(수 MB)을 업로드가 끝날 때까지 폰에 보관하는 데 쓴다. 앱을 닫았다 열어도 남아 있다.
 */
export interface KvStore<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  values(): Promise<T[]>;
}

function req<R>(r: IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openKvStore<T>(dbName: string, storeName: string, idb: IDBFactory = indexedDB): KvStore<T> {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () =>
    (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = idb.open(dbName, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(storeName);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    }));
  const store = async (mode: IDBTransactionMode) =>
    (await db()).transaction(storeName, mode).objectStore(storeName);

  return {
    async get(key) {
      return (await req((await store('readonly')).get(key))) as T | undefined;
    },
    async put(key, value) {
      await req((await store('readwrite')).put(value, key));
    },
    async delete(key) {
      await req((await store('readwrite')).delete(key));
    },
    async values() {
      return (await req((await store('readonly')).getAll())) as T[];
    },
  };
}

/** 테스트·IndexedDB 없는 환경용 메모리 저장소 */
export function memoryKvStore<T>(): KvStore<T> {
  const map = new Map<string, T>();
  return {
    async get(k) {
      return map.get(k);
    },
    async put(k, v) {
      map.set(k, v);
    },
    async delete(k) {
      map.delete(k);
    },
    async values() {
      return [...map.values()];
    },
  };
}

/**
 * IndexedDB가 실패하면(아이폰 Safari의 개인정보 보호 모드, 저장 공간 부족, Blob 저장 오류 등) 메모리에 보관한다.
 * 메모리에 든 원본은 앱을 닫으면 사라지지만, 앱이 열려 있는 동안에는 올라간다.
 */
export function resilientKvStore<T>(
  primary: KvStore<T>,
  fallback: KvStore<T> = memoryKvStore<T>(),
  timeoutMs = 3000,
): KvStore<T> {
  // IndexedDB 요청이 끝나지 않고 멈추는 경우도 있어서, 일정 시간이 지나면 실패로 본다.
  // 한 번 실패하면 이후로는 IndexedDB를 건너뛰고 메모리만 쓴다(매번 기다리지 않게).
  let broken = false;
  const limit = <R>(p: () => Promise<R>): Promise<R> => {
    if (broken) return Promise.reject(new Error('IndexedDB 사용 안 함'));
    return new Promise<R>((resolve, reject) => {
      const fail = (e: unknown) => {
        broken = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      const t = setTimeout(() => fail(new Error('IndexedDB 응답 없음')), timeoutMs);
      p().then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(t);
          fail(e);
        },
      );
    });
  };
  const safe = async <R>(fn: () => Promise<R>, otherwise: R): Promise<R> => {
    try {
      return await limit(fn);
    } catch {
      return otherwise;
    }
  };
  return {
    async get(k) {
      return (await fallback.get(k)) ?? (await safe(() => primary.get(k), undefined));
    },
    async put(k, v) {
      try {
        await limit(() => primary.put(k, v));
        await fallback.delete(k);
      } catch {
        await fallback.put(k, v);
      }
    },
    async delete(k) {
      await fallback.delete(k);
      await safe(() => primary.delete(k), undefined);
    },
    async values() {
      const mem = await fallback.values();
      const disk = await safe(() => primary.values(), [] as T[]);
      return [...mem, ...disk];
    },
  };
}

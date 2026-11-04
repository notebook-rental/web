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

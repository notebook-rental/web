import { describe, expect, it, vi } from 'vitest';
import { memoryKvStore, openKvStore } from './kvStore';
import { OriginalUploadQueue, putToSignedUrl, type PendingOriginal } from './uploadQueue';

const item = {
  inspectionId: 1,
  photoId: 10,
  shotType: 'top',
  uploadUrl: 'https://s3/put',
  blob: new Blob(['x']),
};

function setup(
  put = vi.fn(async () => new Response(null, { status: 200 })),
  confirm = vi.fn(async () => null),
) {
  const store = memoryKvStore<PendingOriginal>();
  const sleep = vi.fn(async () => undefined);
  const queue = new OriginalUploadQueue({ store, put, confirm, sleep, maxAttempts: 3, retryDelays: [5, 50] });
  return { store, queue, put, confirm, sleep };
}

describe('OriginalUploadQueue', () => {
  it('원본을 PUT하고 서버에 확인을 보낸 뒤 큐에서 지운다', async () => {
    const { queue, put, confirm, store } = setup();
    await queue.enqueue(item);
    await queue.drain();
    expect(put).toHaveBeenCalledWith('https://s3/put', item.blob);
    expect(confirm).toHaveBeenCalledWith(1, 10);
    expect(await store.values()).toEqual([]);
  });

  it('업로드가 실패하면 기다렸다 다시 시도하고, 한도를 넘으면 실패로 멈춘다', async () => {
    const put = vi.fn(async () => new Response(null, { status: 500 }));
    const { queue, sleep } = setup(put);
    const seen: number[] = [];
    queue.subscribe((s) => seen.push(s.failed));
    await queue.enqueue(item);
    await queue.drain();
    expect(put).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([5, 50]);
    const snap = await queue.snapshot(1);
    expect(snap).toMatchObject({ pending: 0, failed: 1 });
    expect(snap.items[0].lastError).toContain('HTTP 500');
    expect(seen.at(-1)).toBe(1);
  });

  it('업로드는 됐는데 확인만 실패하면 다시 PUT하지 않고 확인만 다시 한다', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('409')).mockResolvedValue(null);
    const { queue, put, store } = setup(undefined, confirm);
    await queue.enqueue(item);
    await queue.drain();
    expect(put).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await store.values()).toEqual([]);
  });

  it('retryFailed는 실패 항목을 되살려 다시 올린다', async () => {
    const put = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const { queue, store } = setup(put);
    await queue.enqueue(item);
    await queue.drain();
    expect((await queue.snapshot()).failed).toBe(1);
    await queue.retryFailed();
    expect(await store.values()).toEqual([]);
  });

  it('예외 메시지가 Error가 아니어도 기록한다', async () => {
    const put = vi.fn().mockRejectedValue('boom');
    const { queue } = setup(put);
    await queue.enqueue(item);
    await queue.drain();
    expect((await queue.snapshot()).items[0].lastError).toBe('boom');
  });

  it('구독을 해제하면 더는 알리지 않는다', async () => {
    const { queue } = setup();
    const fn = vi.fn();
    const off = queue.subscribe(fn);
    await vi.waitFor(() => expect(fn).toHaveBeenCalled());
    off();
    fn.mockClear();
    await queue.enqueue(item);
    await queue.drain();
    expect(fn).not.toHaveBeenCalled();
  });

  it('기본 sleep과 지연 값으로도 동작한다', async () => {
    vi.useFakeTimers();
    const put = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(new Response(null));
    const queue = new OriginalUploadQueue({ store: memoryKvStore(), put, confirm: async () => null });
    await queue.enqueue(item);
    const done = queue.drain();
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(put).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('putToSignedUrl은 인증 헤더 없이 image/jpeg로 PUT한다', async () => {
    const f = vi.fn(async () => new Response(null));
    await putToSignedUrl('https://s3/x', item.blob, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith('https://s3/x', {
      method: 'PUT',
      body: item.blob,
      headers: { 'Content-Type': 'image/jpeg' },
    });
  });
});

describe('openKvStore(IndexedDB)', () => {
  it('넣고 읽고 지운다', async () => {
    const store = openKvStore<{ v: number }>('test-db', 'items');
    await store.put('a', { v: 1 });
    await store.put('b', { v: 2 });
    expect(await store.get('a')).toEqual({ v: 1 });
    expect((await store.values()).length).toBe(2);
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });

  it('DB를 열지 못하면 오류를 낸다', async () => {
    const failing = {
      open() {
        const r = {} as IDBOpenDBRequest & { error: Error };
        Object.assign(r, { error: new Error('blocked') });
        setTimeout(() => r.onerror?.(new Event('error')));
        return r;
      },
    } as unknown as IDBFactory;
    await expect(openKvStore('x', 'y', failing).get('a')).rejects.toThrow('blocked');
  });
});

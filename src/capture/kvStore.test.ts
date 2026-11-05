import { describe, expect, it } from 'vitest';
import { memoryKvStore, resilientKvStore, type KvStore } from './kvStore';

function brokenStore<T>(): KvStore<T> {
  const fail = async () => {
    throw new Error('IndexedDB 오류');
  };
  return { get: fail, put: fail, delete: fail, values: fail };
}

describe('resilientKvStore', () => {
  it('IndexedDB가 실패하면 메모리에 보관한다', async () => {
    const s = resilientKvStore<number>(brokenStore());
    await s.put('a', 1);
    expect(await s.get('a')).toBe(1);
    expect(await s.values()).toEqual([1]);
    await s.delete('a');
    expect(await s.get('a')).toBeUndefined();
    expect(await s.values()).toEqual([]);
  });

  it('IndexedDB가 되면 거기에 보관하고, 메모리에 남은 같은 키는 지운다', async () => {
    const disk = memoryKvStore<number>();
    const mem = memoryKvStore<number>();
    await mem.put('a', 0);
    const s = resilientKvStore(disk, mem);
    await s.put('a', 1);
    expect(await disk.get('a')).toBe(1);
    expect(await mem.get('a')).toBeUndefined();
    expect(await s.get('a')).toBe(1);
    expect(await s.values()).toEqual([1]);
  });
});

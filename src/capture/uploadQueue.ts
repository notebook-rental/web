import type { KvStore } from './kvStore';

/**
 * 원본 사진 백그라운드 업로드 큐.
 *
 * 컷을 찍으면 작은 작업본만 먼저 서버로 보내 비교를 바로 시작하고(속도),
 * 큰 원본(12MP, 3~6MB)은 이 큐가 뒤에서 MinIO 서명 URL로 직접 올린다(PUT).
 * 올린 뒤 서버에 "도착했다"고 알리면(POST .../original) 서버가 sha256을 대조한다(원본 불변, 헌법 II).
 *
 * 원본은 IndexedDB에 먼저 저장하므로, 업로드 중에 앱을 닫거나 통신이 끊겨도 다음에 다시 올린다.
 */

export interface PendingOriginal {
  key: string;
  inspectionId: number;
  photoId: number;
  shotType: string;
  uploadUrl: string;
  blob: Blob;
  attempts: number;
  /** 업로드는 됐고 서버 확인만 남았는지 */
  uploaded: boolean;
  lastError?: string;
  failed?: boolean;
}

export interface QueueDeps {
  store: KvStore<PendingOriginal>;
  put(url: string, blob: Blob): Promise<Response>;
  confirm(inspectionId: number, photoId: number): Promise<unknown>;
  sleep?(ms: number): Promise<void>;
  maxAttempts?: number;
  retryDelays?: number[];
}

export interface QueueSnapshot {
  pending: number;
  failed: number;
  items: Pick<PendingOriginal, 'key' | 'inspectionId' | 'shotType' | 'failed' | 'lastError'>[];
}

export class OriginalUploadQueue {
  private draining: Promise<void> | null = null;
  private listeners = new Set<(s: QueueSnapshot) => void>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly delays: number[];

  constructor(private readonly deps: QueueDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.delays = deps.retryDelays ?? [1000, 3000, 10000, 30000];
  }

  static keyOf(inspectionId: number, photoId: number): string {
    return `${inspectionId}:${photoId}`;
  }

  async enqueue(item: Omit<PendingOriginal, 'key' | 'attempts' | 'uploaded'>): Promise<void> {
    const key = OriginalUploadQueue.keyOf(item.inspectionId, item.photoId);
    await this.deps.store.put(key, { ...item, key, attempts: 0, uploaded: false });
    await this.emit();
    void this.drain();
  }

  subscribe(fn: (s: QueueSnapshot) => void): () => void {
    this.listeners.add(fn);
    void this.snapshot().then(fn);
    return () => this.listeners.delete(fn);
  }

  async snapshot(inspectionId?: number): Promise<QueueSnapshot> {
    const all = (await this.deps.store.values()).filter(
      (i) => inspectionId === undefined || i.inspectionId === inspectionId,
    );
    return {
      pending: all.filter((i) => !i.failed).length,
      failed: all.filter((i) => i.failed).length,
      items: all.map(({ key, inspectionId, shotType, failed, lastError }) => ({
        key,
        inspectionId,
        shotType,
        failed,
        lastError,
      })),
    };
  }

  /** 실패로 멈춘 항목을 다시 시도한다. */
  async retryFailed(): Promise<void> {
    for (const item of await this.deps.store.values()) {
      if (item.failed) await this.deps.store.put(item.key, { ...item, failed: false, attempts: 0 });
    }
    await this.emit();
    return this.drain();
  }

  drain(): Promise<void> {
    this.draining ??= this.run().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async run(): Promise<void> {
    for (;;) {
      const next = (await this.deps.store.values()).find((i) => !i.failed);
      if (!next) return;
      await this.process(next);
      await this.emit();
    }
  }

  private async process(item: PendingOriginal): Promise<void> {
    try {
      if (!item.uploaded) {
        const res = await this.deps.put(item.uploadUrl, item.blob);
        if (!res.ok) throw new Error(`원본 업로드 실패 (HTTP ${res.status})`);
        item = { ...item, uploaded: true };
        await this.deps.store.put(item.key, item);
      }
      await this.deps.confirm(item.inspectionId, item.photoId);
      await this.deps.store.delete(item.key);
    } catch (e) {
      const attempts = item.attempts + 1;
      const failed = attempts >= this.maxAttempts;
      await this.deps.store.put(item.key, {
        ...item,
        attempts,
        failed,
        lastError: e instanceof Error ? e.message : String(e),
      });
      if (!failed) await this.sleep(this.delays[Math.min(attempts - 1, this.delays.length - 1)]);
    }
  }

  private async emit(): Promise<void> {
    if (this.listeners.size === 0) return;
    const s = await this.snapshot();
    this.listeners.forEach((fn) => fn(s));
  }
}

/** 서명 URL로 원본을 PUT한다. 인증 헤더는 붙이지 않는다(서명이 URL에 들어 있다). */
export function putToSignedUrl(url: string, blob: Blob, fetchFn: typeof fetch = fetch): Promise<Response> {
  return fetchFn(url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
}

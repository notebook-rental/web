import type { ApiClient } from './client';
import type { ComparisonEvent, InspectionEvent } from './types';

/**
 * SSE(Server-Sent Events) 읽기.
 *
 * 브라우저 기본 EventSource는 Authorization 헤더를 붙일 수 없어서, fetch로 응답 본문 스트림을 직접 읽는다.
 * 서버는 아래 형식의 텍스트를 계속 흘려보낸다(빈 줄이 메시지 하나의 끝).
 *
 *   id: 7
 *   event: comparison
 *   data: {"shotType":"top","status":"done","findingCount":2}
 *
 * 연결이 끊기면 마지막으로 받은 id를 Last-Event-ID 헤더로 보내 다시 붙고, 서버가 그 뒤 이벤트를 다시 보낸다.
 */

export interface SseMessage {
  id?: string;
  event: string;
  data: string;
}

export class SseParser {
  private buffer = '';
  private id: string | undefined;
  private event = '';
  private data: string[] = [];

  feed(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    let idx: number;
    while ((idx = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, idx);
      const nl = this.buffer[idx] === '\r' && this.buffer[idx + 1] === '\n' ? 2 : 1;
      // 끝에 \r만 들어온 경우 다음 조각의 \n을 기다린다.
      if (this.buffer[idx] === '\r' && idx + 1 === this.buffer.length) break;
      this.buffer = this.buffer.slice(idx + nl);
      const msg = this.line(line);
      if (msg) out.push(msg);
    }
    return out;
  }

  private line(line: string): SseMessage | null {
    if (line === '') {
      if (this.data.length === 0) {
        this.event = '';
        return null;
      }
      const msg: SseMessage = { id: this.id, event: this.event || 'message', data: this.data.join('\n') };
      this.event = '';
      this.data = [];
      return msg;
    }
    if (line.startsWith(':')) return null; // 주석(연결 유지용 ping)
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'id') this.id = value;
    return null;
  }
}

export interface InspectionEventHandlers {
  onComparison?(e: ComparisonEvent): void;
  onInspection?(e: InspectionEvent): void;
  /** 다시 연결했을 때. 놓친 상태를 GET /inspections/{id}로 채우는 데 쓴다. */
  onReconnect?(): void;
}

export interface SubscribeOptions {
  /** 재연결 대기(ms). 테스트에서 줄인다. */
  retryDelays?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function dispatchSseMessage(msg: SseMessage, handlers: InspectionEventHandlers): void {
  let payload: unknown;
  try {
    payload = JSON.parse(msg.data);
  } catch {
    return;
  }
  if (msg.event === 'comparison') handlers.onComparison?.(payload as ComparisonEvent);
  else if (msg.event === 'inspection') handlers.onInspection?.(payload as InspectionEvent);
}

/** 검사 이벤트를 구독한다. 돌려준 함수를 부르면 끊는다. */
export function subscribeInspectionEvents(
  api: ApiClient,
  inspectionId: number,
  handlers: InspectionEventHandlers,
  options: SubscribeOptions = {},
): () => void {
  const controller = new AbortController();
  const delays = options.retryDelays ?? [1000, 2000, 5000, 10000];
  const sleep = options.sleep ?? defaultSleep;
  let lastEventId: string | undefined;

  async function run() {
    let attempt = 0;
    while (!controller.signal.aborted) {
      let receivedAny = false;
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (lastEventId) headers['Last-Event-ID'] = lastEventId;
        const res = await api.raw(`/inspections/${inspectionId}/events`, {
          headers,
          signal: controller.signal,
        });
        if (res.ok && res.body) {
          if (attempt > 0) handlers.onReconnect?.();
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          const parser = new SseParser();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const msg of parser.feed(value)) {
              receivedAny = true;
              if (msg.id) lastEventId = msg.id;
              dispatchSseMessage(msg, handlers);
            }
          }
        }
      } catch {
        // 끊김. 아래에서 기다렸다가 다시 붙는다.
      }
      if (controller.signal.aborted) return;
      if (receivedAny) attempt = 0;
      await sleep(delays[Math.min(attempt, delays.length - 1)]);
      attempt += 1;
    }
  }

  void run();
  return () => controller.abort();
}

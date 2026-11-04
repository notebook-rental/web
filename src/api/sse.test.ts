import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client';
import { SseParser, dispatchSseMessage, subscribeInspectionEvents } from './sse';

describe('SseParser', () => {
  it('빈 줄로 끝나는 메시지를 id, event, data로 나눈다', () => {
    const p = new SseParser();
    const msgs = p.feed('id: 1\nevent: comparison\ndata: {"a":1}\n\n');
    expect(msgs).toEqual([{ id: '1', event: 'comparison', data: '{"a":1}' }]);
  });

  it('조각난 입력과 \\r\\n 줄바꿈, 여러 줄 data, 주석을 처리한다', () => {
    const p = new SseParser();
    expect(p.feed(': ping\r\nda')).toEqual([]);
    expect(p.feed('ta: a\r')).toEqual([]);
    expect(p.feed('\ndata:b\r\n\r\n')).toEqual([{ id: undefined, event: 'message', data: 'a\nb' }]);
  });

  it('data 없는 빈 메시지는 버리고 event를 초기화한다', () => {
    const p = new SseParser();
    expect(p.feed('event: x\n\ndata: y\n\n')).toEqual([{ id: undefined, event: 'message', data: 'y' }]);
  });

  it('값 없는 필드와 모르는 필드를 견딘다', () => {
    const p = new SseParser();
    expect(p.feed('data\nretry: 10\n\n')).toEqual([{ id: undefined, event: 'message', data: '' }]);
  });
});

describe('dispatchSseMessage', () => {
  it('event 이름에 맞는 처리기를 부르고 깨진 JSON은 무시한다', () => {
    const onComparison = vi.fn();
    const onInspection = vi.fn();
    dispatchSseMessage({ event: 'comparison', data: '{"shotType":"top","status":"done"}' }, { onComparison });
    dispatchSseMessage({ event: 'inspection', data: '{"status":"reviewing"}' }, { onInspection });
    dispatchSseMessage({ event: 'comparison', data: 'not json' }, { onComparison });
    dispatchSseMessage({ event: 'other', data: '{}' }, { onComparison, onInspection });
    expect(onComparison).toHaveBeenCalledTimes(1);
    expect(onComparison).toHaveBeenCalledWith({ shotType: 'top', status: 'done' });
    expect(onInspection).toHaveBeenCalledWith({ status: 'reviewing' });
  });
});

function streamResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

describe('subscribeInspectionEvents', () => {
  it('이벤트를 전달하고, 끊기면 Last-Event-ID로 다시 붙으며 onReconnect를 부른다', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse('id: 3\nevent: comparison\ndata: {"shotType":"top","status":"done"}\n\n'),
      )
      .mockResolvedValueOnce(streamResponse('id: 4\nevent: inspection\ndata: {"status":"reviewing"}\n\n'))
      .mockImplementation(() => new Promise(() => undefined));
    const api = { raw } as unknown as ApiClient;
    const onComparison = vi.fn();
    const onInspection = vi.fn();
    const onReconnect = vi.fn();
    const stop = subscribeInspectionEvents(
      api,
      9,
      { onComparison, onInspection, onReconnect },
      { sleep: async () => undefined },
    );
    await vi.waitFor(() => expect(onInspection).toHaveBeenCalled());
    stop();
    expect(onComparison).toHaveBeenCalledWith({ shotType: 'top', status: 'done' });
    expect(raw.mock.calls[0][0]).toBe('/inspections/9/events');
    expect(raw.mock.calls[0][1].headers['Last-Event-ID']).toBeUndefined();
    expect(raw.mock.calls[1][1].headers['Last-Event-ID']).toBe('3');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('오류 응답이나 예외가 나면 점점 길게 기다렸다 다시 시도하고, 끊으면 멈춘다', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new Error('network'))
      .mockImplementation(() => new Promise(() => undefined));
    const sleeps: number[] = [];
    const stop = subscribeInspectionEvents(
      { raw } as unknown as ApiClient,
      1,
      {},
      { retryDelays: [10, 20], sleep: async (ms) => void sleeps.push(ms) },
    );
    await vi.waitFor(() => expect(raw).toHaveBeenCalledTimes(3));
    stop();
    expect(sleeps).toEqual([10, 20]);
  });

  it('끊은 뒤에는 다시 연결하지 않는다', async () => {
    let resolve!: (r: Response) => void;
    const raw = vi.fn().mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)));
    const sleep = vi.fn(async () => undefined);
    const stop = subscribeInspectionEvents({ raw } as unknown as ApiClient, 1, {}, { sleep });
    stop();
    resolve(new Response('', { status: 500 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(raw).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

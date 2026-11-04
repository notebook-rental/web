import { vi } from 'vitest';

/**
 * 테스트용 가짜 업무 API. "METHOD /경로" 별로 응답을 정해 두고 fetch 대신 끼운다.
 * 응답은 실제 서버처럼 공통 응답 형식(header/result/totalCount)으로 감싼다.
 */

export interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

export type Handler = (call: Call) => Response | Promise<Response>;

export function ok(result: unknown, status = 200, totalCount?: number): Response {
  const body: Record<string, unknown> = {
    header: { isSuccessful: true, resultCode: 0, resultMessage: 'SUCCESS' },
    result,
  };
  if (totalCount !== undefined) body.totalCount = totalCount;
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function list(items: unknown[]): Response {
  return ok(items, 200, items.length);
}

export function fail(
  status: number,
  resultCode: number,
  resultMessage: string,
  result: unknown = null,
): Response {
  return new Response(
    JSON.stringify({ header: { isSuccessful: false, resultCode, resultMessage }, result }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

export function createFakeServer(base = '/api/v1') {
  const handlers = new Map<string, Handler>();
  const calls: Call[] = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.startsWith(base) ? url.slice(base.length) : url;
    const method = (init.method ?? 'GET').toUpperCase();
    let body: unknown = init.body;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: Call = { method, path, headers: new Headers(init.headers), body };
    calls.push(call);
    const handler = handlers.get(`${method} ${path}`);
    if (!handler) return fail(404, -1002, `테스트 핸들러 없음: ${method} ${path}`);
    return handler(call);
  });

  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    calls,
    on(method: string, path: string, handler: Handler | Response | object | null) {
      handlers.set(`${method} ${path}`, (call) => {
        if (typeof handler === 'function') return (handler as Handler)(call);
        if (handler instanceof Response) return handler.clone();
        return ok(handler);
      });
      return this;
    },
    callsTo(method: string, path: string) {
      return calls.filter((c) => c.method === method && c.path === path);
    },
  };
}

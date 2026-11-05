import type { ApiEnvelope } from './types';

/**
 * 업무 API 호출 도우미.
 *
 * - 모든 JSON 응답은 공통 응답 형식(header/result/totalCount)이다. 성공이면 result만 꺼내 돌려준다.
 * - 실패(header.isSuccessful=false 또는 HTTP 4xx/5xx)는 ApiError로 던진다. 화면은 resultCode로 분기하고
 *   resultMessage를 그대로 보여 준다(서버가 사용자용 한국어 문장을 넣는다).
 * - 401을 받으면 refresh token으로 access token을 한 번 다시 받고 같은 요청을 한 번만 다시 보낸다.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly resultCode: number;
  readonly result: unknown;

  constructor(status: number, resultCode: number, message: string, result: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.resultCode = resultCode;
    this.result = result;
  }
}

export const NETWORK_ERROR_CODE = -1;

/** fetch가 응답 없이 실패했을 때. 브라우저가 준 원래 오류는 cause에 남겨 원인을 찾을 때 쓴다. */
function networkError(cause: unknown): ApiError {
  const err = new ApiError(0, NETWORK_ERROR_CODE, '네트워크에 연결할 수 없습니다. 연결을 확인해 주세요.');
  (err as { cause?: unknown }).cause = cause;
  return err;
}
export const SERVER_ERROR_CODE = -1099;

export interface TokenSource {
  getAccessToken(): string | null;
  /** refresh token으로 새 access token을 받는다. 성공하면 true. */
  refresh(): Promise<boolean>;
  /** 다시 로그인해야 할 때 호출된다. */
  onUnauthorized(): void;
}

export interface RequestOptions {
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** 인증 헤더를 붙이지 않는다(로그인·재발급). */
  anonymous?: boolean;
}

export interface ListResult<T> {
  items: T[];
  totalCount: number;
}

export interface ApiClient {
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
  list<T>(path: string, options?: RequestOptions): Promise<ListResult<T>>;
  blob(path: string, options?: RequestOptions): Promise<Blob>;
  /** 인증 헤더가 붙은 원시 fetch. SSE처럼 응답 본문을 직접 읽을 때 쓴다. */
  raw(path: string, init?: RequestInit): Promise<Response>;
}

export interface ApiClientConfig {
  baseUrl: string;
  tokens: TokenSource;
  fetchFn?: typeof fetch;
}

function isEnvelope(body: unknown): body is ApiEnvelope<unknown> {
  return typeof body === 'object' && body !== null && 'header' in body;
}

export function createApiClient({ baseUrl, tokens, fetchFn }: ApiClientConfig): ApiClient {
  const doFetch: typeof fetch = (input, init) => (fetchFn ?? globalThis.fetch)(input, init);

  function buildInit(method: string, options: RequestOptions): RequestInit {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }
    if (!options.anonymous) {
      const token = tokens.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return { method, headers, body, signal: options.signal };
  }

  async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, buildInit(method, options));
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw networkError(e);
    }
    if (res.status === 401 && !options.anonymous) {
      const refreshed = await tokens.refresh();
      if (!refreshed) {
        tokens.onUnauthorized();
        return res;
      }
      try {
        res = await doFetch(baseUrl + path, buildInit(method, options));
      } catch (e) {
        throw networkError(e);
      }
      if (res.status === 401) tokens.onUnauthorized();
    }
    return res;
  }

  async function toError(res: Response): Promise<ApiError> {
    const body = await readJson(res);
    if (isEnvelope(body)) {
      return new ApiError(res.status, body.header.resultCode, body.header.resultMessage, body.result ?? null);
    }
    return new ApiError(res.status, SERVER_ERROR_CODE, `요청을 처리하지 못했습니다. (HTTP ${res.status})`);
  }

  async function readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function envelope<T>(method: string, path: string, options: RequestOptions): Promise<ApiEnvelope<T>> {
    const res = await send(method, path, options);
    if (!res.ok) throw await toError(res);
    const body = await readJson(res);
    if (body === null)
      return { header: { isSuccessful: true, resultCode: 0, resultMessage: '' }, result: null as T };
    if (!isEnvelope(body)) {
      throw new ApiError(res.status, SERVER_ERROR_CODE, '서버 응답 형식이 올바르지 않습니다.');
    }
    if (!body.header.isSuccessful) {
      throw new ApiError(res.status, body.header.resultCode, body.header.resultMessage, body.result ?? null);
    }
    return body as ApiEnvelope<T>;
  }

  return {
    async request<T>(method: string, path: string, options: RequestOptions = {}) {
      return (await envelope<T>(method, path, options)).result;
    },
    async list<T>(path: string, options: RequestOptions = {}) {
      const body = await envelope<T[]>('GET', path, options);
      const items = body.result ?? [];
      return { items, totalCount: body.totalCount ?? items.length };
    },
    async blob(path: string, options: RequestOptions = {}) {
      const res = await send('GET', path, { ...options, headers: { Accept: '*/*', ...options.headers } });
      if (!res.ok) throw await toError(res);
      return res.blob();
    },
    async raw(path: string, init: RequestInit = {}) {
      const withAuth = (): RequestInit => {
        const headers = new Headers(init.headers);
        const token = tokens.getAccessToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        return { ...init, headers };
      };
      const res = await doFetch(baseUrl + path, withAuth());
      if (res.status !== 401) return res;
      if (!(await tokens.refresh())) {
        tokens.onUnauthorized();
        return res;
      }
      return doFetch(baseUrl + path, withAuth());
    },
  };
}

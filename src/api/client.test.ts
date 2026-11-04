import { describe, expect, it, vi } from 'vitest';
import { createFakeServer, fail, list, ok } from '../test/fakeServer';
import { ApiError, NETWORK_ERROR_CODE, SERVER_ERROR_CODE, createApiClient, type TokenSource } from './client';

function tokens(overrides: Partial<TokenSource> = {}): TokenSource {
  let token = 'old';
  return {
    getAccessToken: () => token,
    refresh: vi.fn(async () => {
      token = 'new';
      return true;
    }),
    onUnauthorized: vi.fn(),
    ...overrides,
  };
}

describe('createApiClient', () => {
  it('성공 응답에서 result만 꺼내고 Authorization 헤더를 붙인다', async () => {
    const server = createFakeServer().on('GET', '/scan/X', { nextAction: 'none' });
    const api = createApiClient({ baseUrl: '/api/v1', tokens: tokens(), fetchFn: server.fetchFn });
    await expect(api.request('GET', '/scan/X')).resolves.toEqual({ nextAction: 'none' });
    expect(server.calls[0].headers.get('Authorization')).toBe('Bearer old');
  });

  it('JSON 본문을 보내고 anonymous면 토큰을 붙이지 않는다', async () => {
    const server = createFakeServer().on('POST', '/auth/login', { accessToken: 'a' });
    const api = createApiClient({ baseUrl: '/api/v1', tokens: tokens(), fetchFn: server.fetchFn });
    await api.request('POST', '/auth/login', { json: { loginId: 'u' }, anonymous: true });
    expect(server.calls[0].body).toEqual({ loginId: 'u' });
    expect(server.calls[0].headers.get('Authorization')).toBeNull();
    expect(server.calls[0].headers.get('Content-Type')).toBe('application/json');
  });

  it('FormData는 그대로 보낸다', async () => {
    const server = createFakeServer().on('POST', '/x', null);
    const api = createApiClient({ baseUrl: '/api/v1', tokens: tokens(), fetchFn: server.fetchFn });
    const form = new FormData();
    form.append('a', '1');
    await api.request('POST', '/x', { form });
    expect(server.calls[0].body).toBe(form);
  });

  it('실패 응답을 resultCode와 result를 가진 ApiError로 바꾼다', async () => {
    const server = createFakeServer().on(
      'POST',
      '/inspections/1/submit',
      fail(422, -3002, '필수 컷이 빠졌습니다.', { missingShots: ['hinge'] }),
    );
    const api = createApiClient({ baseUrl: '/api/v1', tokens: tokens(), fetchFn: server.fetchFn });
    const err = (await api.request('POST', '/inspections/1/submit').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, resultCode: -3002, message: '필수 컷이 빠졌습니다.' });
    expect(err.result).toEqual({ missingShots: ['hinge'] });
  });

  it('HTTP 200이어도 isSuccessful=false면 실패로 본다', async () => {
    const server = createFakeServer().on('GET', '/x', fail(200, -1001, '입력값 오류'));
    const api = createApiClient({ baseUrl: '', tokens: tokens(), fetchFn: server.fetchFn });
    await expect(api.request('GET', '/x')).rejects.toMatchObject({ resultCode: -1001 });
  });

  it('공통 형식이 아닌 오류 응답은 서버 오류로 다룬다', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    const api = createApiClient({ baseUrl: '', tokens: tokens(), fetchFn });
    await expect(api.request('GET', '/x')).rejects.toMatchObject({
      status: 502,
      resultCode: SERVER_ERROR_CODE,
    });
  });

  it('성공인데 형식이 다르면 오류, 본문이 비면 null', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ foo: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const api = createApiClient({ baseUrl: '', tokens: tokens(), fetchFn });
    await expect(api.request('GET', '/x')).rejects.toMatchObject({ resultCode: SERVER_ERROR_CODE });
    await expect(api.request('GET', '/x')).resolves.toBeNull();
  });

  it('네트워크 오류는 NETWORK_ERROR_CODE, 취소는 그대로 던진다', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(abort);
    const api = createApiClient({ baseUrl: '', tokens: tokens(), fetchFn });
    await expect(api.request('GET', '/x')).rejects.toMatchObject({ resultCode: NETWORK_ERROR_CODE });
    await expect(api.request('GET', '/x')).rejects.toBe(abort);
  });

  it('401이면 토큰을 재발급하고 한 번만 다시 보낸다', async () => {
    let n = 0;
    const server = createFakeServer().on('GET', '/me', () =>
      ++n === 1 ? fail(401, -1005, '만료') : ok({ id: 1 }),
    );
    const t = tokens();
    const api = createApiClient({ baseUrl: '', tokens: t, fetchFn: server.fetchFn });
    await expect(api.request('GET', '/me')).resolves.toEqual({ id: 1 });
    expect(t.refresh).toHaveBeenCalledTimes(1);
    expect(server.calls[1].headers.get('Authorization')).toBe('Bearer new');
  });

  it('재발급에 실패하면 로그아웃 처리하고 401 오류를 던진다', async () => {
    const server = createFakeServer().on('GET', '/me', fail(401, -1004, '인증 필요'));
    const t = tokens({ refresh: vi.fn(async () => false) });
    const api = createApiClient({ baseUrl: '', tokens: t, fetchFn: server.fetchFn });
    await expect(api.request('GET', '/me')).rejects.toMatchObject({ status: 401, resultCode: -1004 });
    expect(t.onUnauthorized).toHaveBeenCalled();
  });

  it('재발급 뒤에도 401이면 로그아웃 처리한다', async () => {
    const server = createFakeServer().on('GET', '/me', fail(401, -1004, '인증 필요'));
    const t = tokens();
    const api = createApiClient({ baseUrl: '', tokens: t, fetchFn: server.fetchFn });
    await expect(api.request('GET', '/me')).rejects.toMatchObject({ status: 401 });
    expect(t.onUnauthorized).toHaveBeenCalled();
  });

  it('재시도 중 네트워크 오류는 NETWORK_ERROR_CODE', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockRejectedValueOnce(new TypeError('x'));
    const api = createApiClient({ baseUrl: '', tokens: tokens(), fetchFn });
    await expect(api.request('GET', '/x')).rejects.toMatchObject({ resultCode: NETWORK_ERROR_CODE });
  });

  it('list는 items와 totalCount를 돌려준다', async () => {
    const server = createFakeServer().on('GET', '/device-models', list([{ id: 1 }, { id: 2 }]));
    const api = createApiClient({ baseUrl: '', tokens: tokens(), fetchFn: server.fetchFn });
    await expect(api.list('/device-models')).resolves.toEqual({
      items: [{ id: 1 }, { id: 2 }],
      totalCount: 2,
    });
  });

  it('list는 totalCount가 없으면 개수로 채우고 null 결과는 빈 목록', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(ok([{ id: 1 }]))
      .mockResolvedValueOnce(ok(null));
    const api = createApiClient({ baseUrl: '', tokens: tokens(), fetchFn });
    await expect(api.list('/a')).resolves.toEqual({ items: [{ id: 1 }], totalCount: 1 });
    await expect(api.list('/a')).resolves.toEqual({ items: [], totalCount: 0 });
  });

  it('blob은 바이너리를 돌려주고 실패하면 ApiError', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('%PDF', { status: 200 }))
      .mockResolvedValueOnce(fail(403, -1003, '권한 없음'));
    const api = createApiClient({ baseUrl: '', tokens: tokens(), fetchFn });
    const blob = await api.blob('/qr-batches/1/labels.pdf');
    expect(await blob.text()).toBe('%PDF');
    await expect(api.blob('/x')).rejects.toMatchObject({ resultCode: -1003 });
  });

  it('raw는 인증 헤더를 붙이고 401이면 재발급 후 다시 보낸다', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const t = tokens();
    const api = createApiClient({ baseUrl: '/b', tokens: t, fetchFn });
    const res = await api.raw('/events', { headers: { Accept: 'text/event-stream' } });
    expect(res.status).toBe(200);
    const headers = fetchFn.mock.calls[1][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer new');
    expect(headers.get('Accept')).toBe('text/event-stream');
  });

  it('raw는 재발급에 실패하면 401 응답을 그대로 돌려준다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const t = tokens({ refresh: vi.fn(async () => false), getAccessToken: () => null });
    const api = createApiClient({ baseUrl: '', tokens: t, fetchFn });
    expect((await api.raw('/e')).status).toBe(401);
    expect(t.onUnauthorized).toHaveBeenCalled();
    expect((fetchFn.mock.calls[0][1].headers as Headers).get('Authorization')).toBeNull();
  });
});

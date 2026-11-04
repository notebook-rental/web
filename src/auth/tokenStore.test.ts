import { describe, expect, it } from 'vitest';
import { loadSession, saveSession, sessionFromTokens } from './tokenStore';

describe('tokenStore', () => {
  it('토큰 응답을 만료 시각이 있는 세션으로 바꾼다', () => {
    const s = sessionFromTokens(
      { accessToken: 'a', refreshToken: 'r', accessTokenExpiresIn: 1800, roles: ['admin'] },
      1000,
    );
    expect(s).toEqual({ accessToken: 'a', refreshToken: 'r', roles: ['admin'], expiresAt: 1000 + 1_800_000 });
  });

  it('roles가 없으면 빈 배열', () => {
    const s = sessionFromTokens({ accessToken: 'a', refreshToken: 'r', accessTokenExpiresIn: 1 } as never, 0);
    expect(s.roles).toEqual([]);
  });

  it('저장하고 다시 읽고 지운다', () => {
    const s = sessionFromTokens({ accessToken: 'a', refreshToken: 'r', accessTokenExpiresIn: 1, roles: [] });
    saveSession(s);
    expect(loadSession()).toEqual(s);
    saveSession(null);
    expect(loadSession()).toBeNull();
  });

  it('깨졌거나 필수 값이 없는 저장값은 무시한다', () => {
    localStorage.setItem('nr.session', '{not json');
    expect(loadSession()).toBeNull();
    localStorage.setItem('nr.session', JSON.stringify({ accessToken: 'a' }));
    expect(loadSession()).toBeNull();
  });

  it('저장소가 막혀도 오류를 내지 않는다', () => {
    const broken = {
      setItem() {
        throw new Error('quota');
      },
      removeItem() {
        throw new Error('quota');
      },
    } as unknown as Storage;
    expect(() => saveSession(null, broken)).not.toThrow();
  });
});

import type { Role, TokenPair } from '../api/types';

/**
 * 로그인 정보 저장.
 * access token(30분)과 refresh token(14일)을 브라우저 localStorage에 둔다.
 * 직원 폰에서 앱을 다시 열어도 로그인이 유지되게 하려는 것이다.
 * 공용 기기에서는 반드시 로그아웃하도록 안내한다(로그아웃하면 서버에서도 refresh token을 폐기한다).
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  roles: Role[];
  /** access token 만료 시각(epoch ms) */
  expiresAt: number;
}

const KEY = 'nr.session';

export function sessionFromTokens(t: TokenPair, now = Date.now()): Session {
  return {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    roles: t.roles ?? [],
    expiresAt: now + t.accessTokenExpiresIn * 1000,
  };
}

export function loadSession(storage: Storage = localStorage): Session | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.accessToken || !s.refreshToken) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null, storage: Storage = localStorage): void {
  try {
    if (s) storage.setItem(KEY, JSON.stringify(s));
    else storage.removeItem(KEY);
  } catch {
    // 사생활 보호 모드 등에서 저장이 막혀도 앱은 메모리 상태로 계속 동작한다.
  }
}

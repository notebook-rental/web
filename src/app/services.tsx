import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from '../api/client';
import { createEndpoints, type Endpoints } from '../api/endpoints';
import type { Role } from '../api/types';
import { loadSession, saveSession, sessionFromTokens, type Session } from '../auth/tokenStore';

/**
 * 앱 전체가 함께 쓰는 것들: API 클라이언트와 로그인 상태.
 * 테스트에서는 fetchFn을 바꿔 끼워 서버 없이 화면을 검증한다.
 */

export interface Services {
  api: ApiClient;
  endpoints: Endpoints;
  session: Session | null;
  hasRole(role: Role): boolean;
  login(loginId: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const ServicesContext = createContext<Services | null>(null);

export interface ServicesProviderProps {
  children: ReactNode;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  initialSession?: Session | null;
}

export function ServicesProvider({
  children,
  baseUrl = '/api/v1',
  fetchFn,
  initialSession,
}: ServicesProviderProps) {
  const [session, setSessionState] = useState<Session | null>(() =>
    initialSession === undefined ? loadSession() : initialSession,
  );
  const sessionRef = useRef(session);
  const refreshing = useRef<Promise<boolean> | null>(null);

  const setSession = (s: Session | null) => {
    sessionRef.current = s;
    saveSession(s);
    setSessionState(s);
  };
  const setSessionRef = useRef(setSession);
  setSessionRef.current = setSession;

  const { api, endpoints } = useMemo(() => {
    // eslint-disable-next-line prefer-const
    let endpoints: Endpoints;
    const api = createApiClient({
      baseUrl,
      fetchFn,
      tokens: {
        getAccessToken: () => sessionRef.current?.accessToken ?? null,
        refresh: () => {
          const current = sessionRef.current;
          if (!current) return Promise.resolve(false);
          // 여러 요청이 동시에 401을 받아도 재발급은 한 번만 한다.
          refreshing.current ??= endpoints
            .refresh(current.refreshToken)
            .then((t) => {
              setSessionRef.current(sessionFromTokens(t));
              return true;
            })
            .catch(() => false)
            .finally(() => {
              refreshing.current = null;
            });
          return refreshing.current;
        },
        onUnauthorized: () => setSessionRef.current(null),
      },
    });
    endpoints = createEndpoints(api);
    return { api, endpoints };
  }, [baseUrl, fetchFn]);

  const value: Services = {
    api,
    endpoints,
    session,
    hasRole: (role) => !!session?.roles.includes(role),
    async login(loginId, password) {
      const tokens = await endpoints.login(loginId, password);
      setSession(sessionFromTokens(tokens));
    },
    async logout() {
      try {
        await endpoints.logout();
      } catch {
        // 서버 폐기에 실패해도 이 기기에서는 로그아웃한다.
      }
      setSession(null);
    },
  };

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesProvider 안에서만 쓸 수 있습니다.');
  return s;
}

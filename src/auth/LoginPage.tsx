import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useServices } from '../app/services';
import { Icon } from '../shared/ui/Icon';

/**
 * 데모용 기본 계정(사용자 요청, 2026-11-04): 화면을 열면 admin / admin이 채워져 있어 로그인 버튼만 누르면 된다.
 * 빌드할 때 VITE_DEMO_LOGIN=off 로 주면 빈칸으로 시작한다(실제 운영 전환 시).
 */
// eslint-disable-next-line react-refresh/only-export-components
export const DEMO_CREDENTIALS =
  import.meta.env.VITE_DEMO_LOGIN === 'off'
    ? { loginId: '', password: '' }
    : { loginId: 'admin', password: 'admin' };

export function LoginPage() {
  const { session, login } = useServices();
  const location = useLocation();
  const [loginId, setLoginId] = useState(DEMO_CREDENTIALS.loginId);
  const [password, setPassword] = useState(DEMO_CREDENTIALS.password);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (session) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(loginId.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인하지 못했습니다.');
      setBusy(false);
    }
  }

  return (
    <section className="login">
      <div className="login__card">
        <div className="login__brand">
          <span className="brand__mark brand__mark--lg" aria-hidden="true">
            <Icon name="laptop" size={28} />
          </span>
          <h1>노트북 반납 검사</h1>
          <p className="muted">QR을 찍고 8컷만 촬영하면 대여 때와 비교해 손상을 찾아 드려요.</p>
        </div>
        <form className="form" onSubmit={submit}>
          <label>
            아이디
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="alert alert--error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--primary btn--big" disabled={busy}>
            {busy ? '로그인 중…' : '로그인'}
          </button>
        </form>
        {DEMO_CREDENTIALS.loginId && <p className="login__demo">데모 계정 admin / admin 이 채워져 있어요.</p>}
      </div>
    </section>
  );
}

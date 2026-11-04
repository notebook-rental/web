import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useServices } from '../app/services';

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
    <section className="screen screen--center">
      <h1>노트북 반납 검사</h1>
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
        <button className="btn btn--primary" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </section>
  );
}

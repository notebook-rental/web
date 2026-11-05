import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useServices } from '../app/services';
import { Icon } from '../shared/ui/Icon';
import { goToScanResult } from './navigation';

/**
 * 라벨이 훼손되어 읽히지 않을 때 자산 번호를 직접 넣어 노트북을 찾는다(FR-008).
 * 서버는 이렇게 찾은 경우 identifiedBy=manual로 기록한다.
 */
export function ManualIdentify() {
  const { endpoints } = useServices();
  const navigate = useNavigate();
  const [assetNo, setAssetNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = assetNo.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const scan = await endpoints.findByAsset(value);
      goToScanResult(navigate, scan, 'manual');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? '그 자산 번호의 노트북이 없습니다.'
          : err instanceof Error
            ? err.message
            : '조회에 실패했습니다.',
      );
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <h1>자산 번호로 찾기</h1>
      <p className="hint">
        라벨을 읽을 수 없을 때만 씁니다. 찾은 뒤에는 관리자에게 라벨을 다시 출력해 달라고 요청해 주세요.
      </p>
      <form onSubmit={submit} className="form">
        <label>
          자산 번호
          <input
            value={assetNo}
            onChange={(e) => setAssetNo(e.target.value)}
            autoFocus
            autoCapitalize="characters"
            required
          />
        </label>
        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary btn--big" disabled={busy}>
          <Icon name="search" size={20} />
          {busy ? '찾는 중…' : '찾기'}
        </button>
      </form>
    </section>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import type { QrBatch } from '../api/types';
import { formatDate } from '../admin/format';
import { useServices } from '../app/services';
import { isSystemQr, normalizeQrValue } from '../scan/qrValue';
import { Icon } from '../shared/ui/Icon';

/**
 * 관리자: 빈 QR 스티커 묶음 출력(FR-046)과 분실·오인쇄 QR 폐기.
 * 발급한 QR은 아직 어느 노트북에도 묶이지 않은 "미등록" 상태다. 노트북에 붙이고 스캔하면 등록 화면이 열린다.
 */
export function QrBatchPage() {
  const { endpoints } = useServices();
  const [count, setCount] = useState(20);
  const [batch, setBatch] = useState<QrBatch | null>(null);
  const [history, setHistory] = useState<QrBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidValue, setVoidValue] = useState('');
  const [voidMessage, setVoidMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 지난 묶음 목록은 없어도 발급·폐기는 쓸 수 있으니 실패는 조용히 넘긴다.
    endpoints.listQrBatches().then(
      (r) => alive && setHistory(r.items),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [endpoints]);

  async function issue(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await endpoints.createQrBatch(count);
      setBatch(created);
      setHistory((h) => [created, ...h.filter((b) => b.id !== created.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '발급하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function download(batchId: number) {
    setError(null);
    try {
      const blob = await endpoints.qrBatchPdf(batchId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-batch-${batchId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF를 받지 못했습니다.');
    }
  }

  async function voidQr(e: FormEvent) {
    e.preventDefault();
    setVoidMessage(null);
    const value = normalizeQrValue(voidValue);
    if (!isSystemQr(value)) {
      setVoidMessage('QR 값 형식이 올바르지 않습니다. 예: NR1:7K3M9QX2TD');
      return;
    }
    try {
      await endpoints.voidQr(value);
      setVoidMessage(`${value}을(를) 폐기했습니다.`);
      setVoidValue('');
    } catch (err) {
      setVoidMessage(err instanceof Error ? err.message : '폐기하지 못했습니다.');
    }
  }

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>QR 스티커 출력</h1>
        </div>
      </header>

      <form className="card form" onSubmit={issue}>
        <h2 className="card__title">빈 QR 발급</h2>
        <p className="hint">발급한 QR을 노트북에 붙이고 스캔하면 새 노트북 등록 화면이 열립니다.</p>
        <label>
          장 수(1~500)
          <input
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            required
          />
        </label>
        <button className="btn btn--primary" disabled={busy}>
          <Icon name="qr" size={18} />
          {busy ? '발급 중…' : '빈 QR 발급'}
        </button>
        {batch && (
          <div className="confirm">
            <p>
              묶음 #{batch.id}: {batch.count}장 발급됨
            </p>
            <button type="button" className="btn" onClick={() => void download(batch.id)}>
              <Icon name="download" size={18} />
              스티커 PDF 내려받기
            </button>
          </div>
        )}
        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
      </form>

      {history.length > 0 && (
        <div className="card">
          <h2 className="card__title">지난 묶음</h2>
          <ul className="rows rows--plain" aria-label="지난 QR 묶음">
            {history.map((b) => (
              <li key={b.id} className="row row--static">
                <span className="row__main">
                  <strong>묶음 #{b.id}</strong>
                  <span className="muted">
                    {b.count}장 · {formatDate(b.createdAt)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void download(b.id)}
                  aria-label={`묶음 #${b.id} PDF`}
                >
                  <Icon name="printer" size={16} />
                  PDF
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="card form" onSubmit={voidQr}>
        <h2 className="card__title">QR 폐기</h2>
        <p className="hint">분실하거나 잘못 인쇄된 QR은 폐기하세요. 폐기한 QR은 스캔해도 쓰이지 않습니다.</p>
        <label>
          QR 값
          <input
            value={voidValue}
            onChange={(e) => setVoidValue(e.target.value)}
            placeholder="NR1:…"
            spellCheck={false}
            required
          />
        </label>
        <button className="btn btn--danger">폐기</button>
        {voidMessage && <p role="status">{voidMessage}</p>}
      </form>
    </section>
  );
}

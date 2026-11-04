import { useState, type FormEvent } from 'react';
import type { QrBatch } from '../api/types';
import { useServices } from '../app/services';
import { isSystemQr, normalizeQrValue } from '../scan/qrValue';

/**
 * 관리자: 빈 QR 스티커 묶음 출력(FR-046)과 분실·오인쇄 QR 폐기.
 * 발급한 QR은 아직 어느 노트북에도 묶이지 않은 "미등록" 상태다. 노트북에 붙이고 스캔하면 등록 화면이 열린다.
 */
export function QrBatchPage() {
  const { endpoints } = useServices();
  const [count, setCount] = useState(20);
  const [batch, setBatch] = useState<QrBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidValue, setVoidValue] = useState('');
  const [voidMessage, setVoidMessage] = useState<string | null>(null);

  async function issue(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setBatch(await endpoints.createQrBatch(count));
    } catch (err) {
      setError(err instanceof Error ? err.message : '발급하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!batch) return;
    setError(null);
    try {
      const blob = await endpoints.qrBatchPdf(batch.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-batch-${batch.id}.pdf`;
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
    <section className="screen">
      <h1>QR 스티커 출력</h1>
      <form className="form" onSubmit={issue}>
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
          {busy ? '발급 중…' : '빈 QR 발급'}
        </button>
      </form>
      {batch && (
        <div className="confirm">
          <p>
            묶음 #{batch.id}: {batch.count}장 발급됨
          </p>
          <button type="button" className="btn" onClick={download}>
            스티커 PDF 내려받기
          </button>
        </div>
      )}
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}

      <h2>QR 폐기</h2>
      <p className="hint">분실하거나 잘못 인쇄된 QR은 폐기하세요. 폐기한 QR은 스캔해도 쓰이지 않습니다.</p>
      <form className="form" onSubmit={voidQr}>
        <label>
          QR 값
          <input
            value={voidValue}
            onChange={(e) => setVoidValue(e.target.value)}
            placeholder="NR1:…"
            required
          />
        </label>
        <button className="btn">폐기</button>
      </form>
      {voidMessage && <p role="status">{voidMessage}</p>}
    </section>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import type { QrBatch } from '../api/types';
import { formatDate } from '../admin/format';
import { useServices } from '../app/services';
import { isLabelValue, normalizeQrValue } from '../scan/qrValue';
import { downloadBlob } from '../shared/downloadBlob';
import { Icon } from '../shared/ui/Icon';
import { LabelFormatPicker } from './LabelFormatPicker';
import { useLabelFormat } from './labelFormat';

/**
 * 관리자: 자산 번호 라벨 발급과 출력(FR-046, spec 002), 분실·오인쇄 라벨 폐기.
 *
 * 발급하면 시스템이 자산 번호를 NB + 연월 + 그 달 순번 4자리로 매긴다(예: NB26110001).
 * 출력할 때 QR이나 바코드 중 하나를 고른다. 라벨에 든 값(자산 번호)은 같고 모양만 다르다.
 * 발급한 라벨은 아직 어느 노트북에도 묶이지 않은 "미등록" 상태다. 노트북에 붙이고 스캔하면 등록 화면이 열린다.
 */
export function QrBatchPage() {
  const { endpoints } = useServices();
  const [count, setCount] = useState(20);
  const [format, setFormat] = useLabelFormat();
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
      downloadBlob(await endpoints.qrBatchPdf(batchId, format), `labels-${batchId}-${format}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF를 받지 못했습니다.');
    }
  }

  async function voidLabel(e: FormEvent) {
    e.preventDefault();
    setVoidMessage(null);
    const value = normalizeQrValue(voidValue);
    if (!isLabelValue(value)) {
      setVoidMessage('자산 번호 형식이 올바르지 않습니다. 예: NB26110001');
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

  const range = (b: QrBatch) =>
    b.firstAssetNo
      ? b.firstAssetNo === b.lastAssetNo
        ? b.firstAssetNo
        : `${b.firstAssetNo} ~ ${b.lastAssetNo}`
      : null;

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>자산 번호 라벨</h1>
        </div>
      </header>

      <form className="card form" onSubmit={issue}>
        <h2 className="card__title">새 자산 번호 발급</h2>
        <p className="hint">
          자산 번호는 NB + 연월 + 순번으로 매겨집니다(예: NB26110001은 2026년 11월 첫 번째). 라벨을 노트북에
          붙이고 스캔하면 새 노트북 등록 화면이 열립니다.
        </p>
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
          <Icon name="plus" size={18} />
          {busy ? '발급 중…' : '자산 번호 발급'}
        </button>
        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
      </form>

      <div className="card form">
        <h2 className="card__title">라벨 출력</h2>
        <p className="hint">
          QR은 작게 붙여도 잘 읽히고, 바코드는 기존 자산 스티커와 모양이 같습니다. 고른 형식은 다음에도
          기억합니다.
        </p>
        <LabelFormatPicker value={format} onChange={setFormat} />
        {batch && (
          <div className="confirm">
            <p>
              묶음 #{batch.id}: {batch.count}장 발급됨{range(batch) && ` (${range(batch)})`}
            </p>
            <button type="button" className="btn" onClick={() => void download(batch.id)}>
              <Icon name="download" size={18} />
              라벨 PDF 내려받기
            </button>
          </div>
        )}
        {history.length > 0 && (
          <ul className="rows rows--plain" aria-label="지난 라벨 묶음">
            {history.map((b) => (
              <li key={b.id} className="row row--static">
                <span className="row__main">
                  <strong>묶음 #{b.id}</strong>
                  <span className="muted">
                    {range(b) ? `${range(b)} · ` : ''}
                    {b.count}장{b.createdAt ? ` · ${formatDate(b.createdAt)}` : ''}
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
        )}
      </div>

      <form className="card form" onSubmit={voidLabel}>
        <h2 className="card__title">라벨 폐기</h2>
        <p className="hint">
          분실하거나 잘못 인쇄된 라벨은 폐기하세요. 폐기한 번호는 스캔해도 쓰이지 않습니다.
        </p>
        <label>
          자산 번호
          <input
            value={voidValue}
            onChange={(e) => setVoidValue(e.target.value)}
            placeholder="NB26110001"
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

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ResultCode } from '../api/resultCodes';
import type { DamageType, Finding, Geometry, Inspection, Severity } from '../api/types';
import { useServices } from '../app/services';
import { useCamera } from '../camera/CameraProvider';
import { DAMAGE_TYPE_TEXT, SEVERITY_TEXT, shotGuide } from '../capture/shots';
import { AnnotationCanvas } from '../shared/annotate/AnnotationCanvas';
import { CompareViewer } from './CompareViewer';
import { FindingCard } from './FindingPanel';
import { Icon } from '../shared/ui/Icon';
import { DAMAGE_TYPES, SEVERITIES } from './labels';

/**
 * 반납 검토 화면(US3). 컷별로 대여/반납 사진을 비교하며 후보를 판정하고,
 * 놓친 손상은 직접 그려 추가한 뒤, 모든 후보를 판정하면 검사를 완료한다(FR-022).
 */
export function ReviewPage() {
  const { inspectionId } = useParams();
  const id = Number(inspectionId);
  const { endpoints } = useServices();
  const camera = useCamera();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [shot, setShot] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 검토에는 카메라가 필요 없다. 배터리를 아끼려고 끈다.
    camera.stop();
    Promise.all([endpoints.getInspection(id), endpoints.listFindings(id)]).then(
      ([i, f]) => {
        setInspection(i);
        setFindings(f.items);
        const first = f.items.find((x) => !x.verdict)?.shotType ?? i.requiredShots[0] ?? null;
        setShot(first);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : '검사를 불러오지 못했습니다.'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, endpoints]);

  const shots = useMemo(() => {
    const codes = inspection?.requiredShots?.length ? [...inspection.requiredShots] : [];
    for (const f of findings) if (!codes.includes(f.shotType)) codes.push(f.shotType);
    return codes;
  }, [inspection, findings]);

  const shotFindings = findings.filter((f) => f.shotType === shot);
  const pending = findings.filter((f) => !f.verdict).length;
  const photo = inspection?.photos?.find((p) => p.shotType === shot);
  const ref = shotFindings[0];
  const targetUrl = ref?.targetPhotoUrl ?? photo?.url;
  const targetSize = photo?.width && photo?.height ? { width: photo.width, height: photo.height } : undefined;

  async function verdict(f: Finding, v: Parameters<typeof endpoints.setVerdict>[1]) {
    const updated = await endpoints.setVerdict(f.id, v);
    setFindings((all) =>
      all.map((x) => (x.id === f.id ? { ...x, ...updated, verdict: updated?.verdict ?? v.verdict } : x)),
    );
  }

  async function complete() {
    setBusy(true);
    setCompleteError(null);
    try {
      setCompleted(await endpoints.completeInspection(id));
    } catch (e) {
      if (e instanceof ApiError && e.resultCode === ResultCode.PENDING_FINDINGS) {
        setCompleteError('아직 판정하지 않은 후보가 있어요. 모든 후보를 판정해 주세요.');
      } else {
        setCompleteError(e instanceof Error ? e.message : '완료하지 못했습니다.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <section className="screen">
        <p className="alert alert--error" role="alert">
          {error}
        </p>
        <Link to="/" className="btn">
          스캔 화면으로
        </Link>
      </section>
    );
  }
  if (!inspection) return <p className="screen hint">불러오는 중…</p>;

  if (completed) {
    return (
      <section className="screen">
        <div className="done-mark" aria-hidden="true">
          <Icon name="check" size={36} />
        </div>
        <h1>검사 완료</h1>
        <p>
          {completed.result === 'new_damage'
            ? '새 손상이 노트북 손상 이력에 등록되었습니다.'
            : '새 손상 없이 반납 검사를 마쳤습니다.'}
        </p>
        <Link to="/" className="btn btn--primary">
          다음 노트북 스캔
        </Link>
      </section>
    );
  }

  return (
    <section className="screen">
      <header className="page__head">
        <div>
          <p className="eyebrow">반납 검사 #{inspection.id}</p>
          <h1>반납 검토</h1>
        </div>
        <p className={`pill${pending > 0 ? ' pill--warn' : ' pill--ok'}`}>
          후보 {findings.length}건 · 미판정 {pending}건
        </p>
      </header>
      <div className="tabs tabs--scroll" role="tablist" aria-label="컷">
        {shots.map((code) => {
          const n = findings.filter((f) => f.shotType === code).length;
          const open = findings.filter((f) => f.shotType === code && !f.verdict).length;
          return (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={code === shot}
              onClick={() => {
                setShot(code);
                setAdding(false);
              }}
            >
              {shotGuide(code).name}
              {n > 0 && <span className={`count${open ? ' count--open' : ''}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      {adding && photo?.url ? (
        <ManualAdd
          src={photo.url}
          size={targetSize}
          onCancel={() => setAdding(false)}
          onSave={async (geometry, damageType, severity) => {
            const created = await endpoints.addManualFinding(id, {
              photoId: photo.id,
              geometry,
              damageType,
              severity,
            });
            setFindings((all) => [...all, { ...created, shotType: created.shotType ?? shot! }]);
            setAdding(false);
          }}
        />
      ) : (
        <>
          <CompareViewer
            baselineUrl={ref?.baselinePhotoUrl}
            targetUrl={targetUrl}
            alignedTargetUrl={ref?.alignedTargetUrl}
            targetSize={targetSize}
            findings={shotFindings}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {shotFindings.length === 0 && <p className="hint">이 컷에는 자동 후보가 없습니다.</p>}
          <ul className="finding-list">
            {shotFindings.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                selected={f.id === selectedId}
                onSelect={() => setSelectedId(f.id)}
                onVerdict={(v) => verdict(f, v)}
              />
            ))}
          </ul>
          {photo?.url && (
            <button type="button" className="btn btn--ghost" onClick={() => setAdding(true)}>
              놓친 손상 직접 추가
            </button>
          )}
        </>
      )}

      {completeError && (
        <p className="alert alert--error" role="alert">
          {completeError}
        </p>
      )}
      <button
        type="button"
        className="btn btn--primary btn--big btn--sticky"
        onClick={complete}
        disabled={busy || pending > 0}
      >
        {pending > 0 ? `미판정 ${pending}건 남음` : '검사 완료'}
      </button>
    </section>
  );
}

function ManualAdd({
  src,
  size,
  onSave,
  onCancel,
}: {
  src: string;
  size?: { width: number; height: number };
  onSave(g: Geometry, t: DamageType, s: Severity): Promise<void>;
  onCancel(): void;
}) {
  const [mode, setMode] = useState<'box' | 'polygon'>('box');
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [damageType, setDamageType] = useState<DamageType>('scratch');
  const [severity, setSeverity] = useState<Severity>('minor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!geometry) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(geometry, damageType, severity);
    } catch (e) {
      setError(e instanceof Error ? e.message : '추가하지 못했습니다.');
      setBusy(false);
    }
  }

  return (
    <div className="manual-add">
      <div className="tabs" role="tablist" aria-label="그리기 방식">
        <button type="button" role="tab" aria-selected={mode === 'box'} onClick={() => setMode('box')}>
          박스
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'polygon'}
          onClick={() => setMode('polygon')}
        >
          다각형
        </button>
      </div>
      <AnnotationCanvas src={src} size={size} mode={mode} value={geometry} onChange={setGeometry} />
      <div className="input-row">
        <label>
          유형
          <select value={damageType} onChange={(e) => setDamageType(e.target.value as DamageType)}>
            {DAMAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {DAMAGE_TYPE_TEXT[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          심각도
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_TEXT[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn btn--primary" onClick={save} disabled={!geometry || busy}>
          손상 추가
        </button>
      </div>
    </div>
  );
}

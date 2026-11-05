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
import { DAMAGE_TYPES, SEVERITIES, VERDICT_HELP, VERDICT_TEXT, needsManualCheck, reasonText } from './labels';
import type { ShotComparison, VerdictValue } from '../api/types';

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
  const comparison = inspection?.comparisons?.find((c) => c.shotType === shot);
  const ref = shotFindings.find((f) => f.baselinePhotoUrl || f.targetPhotoUrl) ?? shotFindings[0];
  const baselineUrl = comparison?.baselinePhotoUrl ?? ref?.baselinePhotoUrl;
  const targetUrl = ref?.targetPhotoUrl ?? photo?.url;
  const targetSize = photo?.width && photo?.height ? { width: photo.width, height: photo.height } : undefined;
  const manualShots = (inspection?.comparisons ?? []).filter((c) => needsManualCheck(c.status));

  /** 다음에 볼 컷: 판정이 남은 컷 → 직접 봐야 하는 컷 → 그냥 다음 컷 순서로 고른다. */
  const nextShot = useMemo(() => {
    if (!shot) return null;
    const after = [...shots.slice(shots.indexOf(shot) + 1), ...shots.slice(0, shots.indexOf(shot))];
    return (
      after.find((c) => findings.some((f) => f.shotType === c && !f.verdict)) ??
      shots[shots.indexOf(shot) + 1] ??
      null
    );
  }, [shot, shots, findings]);

  function goShot(code: string) {
    setShot(code);
    setAdding(false);
    setSelectedId(null);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

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
        <Link to="/" className="btn btn--primary btn--big">
          <Icon name="scan" size={20} />
          다음 노트북 스캔
        </Link>
      </section>
    );
  }

  return (
    <section className="screen screen--wide">
      <header className="page__head">
        <div>
          <p className="eyebrow">반납 검사 #{inspection.id}</p>
          <h1>반납 검토</h1>
        </div>
        <p className={`pill${pending > 0 ? ' pill--warn' : ' pill--ok'}`}>
          후보 {findings.length}건 · 미판정 {pending}건
        </p>
      </header>
      {manualShots.length > 0 && (
        <p className="review-banner">
          <Icon name="alert" size={18} />
          <span>
            직접 볼 컷 {manualShots.length}개: {manualShots.map((c) => shotGuide(c.shotType).name).join(', ')}
          </span>
        </p>
      )}
      <div className="tabs tabs--scroll" role="tablist" aria-label="컷">
        {shots.map((code) => {
          const open = findings.filter((f) => f.shotType === code && !f.verdict).length;
          const status = inspection.comparisons?.find((c) => c.shotType === code)?.status;
          return (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={code === shot}
              ref={code === shot ? scrollIntoViewIfNeeded : undefined}
              onClick={() => goShot(code)}
            >
              {shotGuide(code).name}
              {open > 0 ? (
                <span className="count count--open" aria-label={`미판정 ${open}건`}>
                  {open}
                </span>
              ) : needsManualCheck(status) ? (
                <span className="count count--warn" aria-label="직접 확인">
                  !
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {adding && photo?.url ? (
        <ManualAdd
          key={shot ?? ''}
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
          <ShotStatus comparison={comparison} findingCount={shotFindings.length} />
          <CompareViewer
            key={shot ?? ''}
            baselineUrl={baselineUrl}
            targetUrl={targetUrl}
            alignedTargetUrl={ref?.alignedTargetUrl}
            targetSize={targetSize}
            findings={shotFindings}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {shotFindings.length > 0 && (
            <>
              <p className="review__lead">
                번호 상자는 대여 때와 달라 보이는 곳이에요. 번호마다 아래에서 판정해 주세요.
              </p>
              <VerdictLegend />
            </>
          )}
          <ul className="finding-list">
            {shotFindings.map((f, i) => (
              <FindingCard
                key={f.id}
                finding={f}
                number={i + 1}
                selected={f.id === selectedId}
                onSelect={() => setSelectedId(f.id)}
                onVerdict={(v) => verdict(f, v)}
              />
            ))}
          </ul>
          <div className="review__actions">
            {photo?.url && (
              <button type="button" className="btn btn--ghost" onClick={() => setAdding(true)}>
                <Icon name="draw" size={18} />
                놓친 손상 직접 추가
              </button>
            )}
            {nextShot && shotFindings.every((f) => f.verdict) && (
              <button type="button" className="btn" onClick={() => goShot(nextShot)}>
                다음 컷: {shotGuide(nextShot).name}
                <Icon name="arrow" size={18} />
              </button>
            )}
          </div>
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
        <Icon name={pending > 0 ? 'alert' : 'checkCircle'} size={22} />
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
      <p className="hint">
        반납 사진에서 손상 부분을 손가락으로 끌어 상자를 그려요. 모양이 길쭉하면 "다각형"으로 점을 찍어
        둘러싸요.
      </p>
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

/**
 * 지금 컷의 자동 비교 결과를 한 줄로 알려 준다(FR-049).
 * "자동 비교 불가"·"비교 실패"는 후보가 없다는 뜻이 아니므로, 직원이 직접 봐야 한다고 분명히 적는다.
 */
function ShotStatus({ comparison, findingCount }: { comparison?: ShotComparison; findingCount: number }) {
  const status = comparison?.status;
  if (status === 'not_comparable' || status === 'failed') {
    return (
      <div className="shot-status shot-status--warn" role="status">
        <Icon name="alert" size={20} />
        <div>
          <strong>
            {status === 'failed' ? '자동 비교 중 오류가 났어요' : '이 컷은 자동으로 비교하지 못했어요'}
          </strong>
          <p>
            {status === 'failed' ? '서버에서 비교를 끝내지 못했어요.' : reasonText(comparison?.reason)} 손상이
            없다는 뜻은 아니에요. 아래 두 사진을 눈으로 비교하고, 새 손상이 보이면 "놓친 손상 직접 추가"로
            표시해 주세요.
          </p>
        </div>
      </div>
    );
  }
  if (status === 'queued' || status === 'running') {
    return (
      <div className="shot-status" role="status">
        <Icon name="retry" size={20} />
        <div>
          <strong>아직 비교하는 중이에요</strong>
          <p>잠시 뒤 새로 고치면 결과가 보여요. 그동안 두 사진을 직접 봐도 돼요.</p>
        </div>
      </div>
    );
  }
  // 후보가 있으면 사진 아래에 짧게 안내한다(사진이 화면 위쪽에 바로 보이게).
  if (findingCount > 0) return null;
  return (
    <div className="shot-status shot-status--ok" role="status">
      <Icon name="checkCircle" size={20} />
      <div>
        <strong>달라진 곳을 찾지 못했어요</strong>
        <p>두 사진을 한 번 훑어보고, 놓친 손상이 없으면 다음 컷으로 넘어가세요.</p>
      </div>
    </div>
  );
}

/** 판정 버튼 세 개가 무엇을 뜻하는지 */
function VerdictLegend() {
  return (
    <dl className="verdict-legend">
      {(Object.keys(VERDICT_TEXT) as VerdictValue[]).map((v) => (
        <div key={v}>
          <dt>{VERDICT_TEXT[v]}</dt>
          <dd>{VERDICT_HELP[v]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 가로로 넘기는 컷 탭에서 지금 컷이 보이게 한다. */
function scrollIntoViewIfNeeded(el: HTMLElement | null) {
  el?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

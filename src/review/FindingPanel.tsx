import { useState } from 'react';
import type { DamageType, Finding, Severity, Verdict, VerdictValue } from '../api/types';
import { DAMAGE_TYPE_TEXT, SEVERITY_TEXT } from '../capture/shots';
import { DAMAGE_TYPES, SEVERITIES, VERDICT_HELP, VERDICT_TEXT } from './labels';

/**
 * 후보 하나를 판정하는 카드(FR-020). 카드 번호는 사진 위 상자의 번호와 같다.
 * 먼저 판정 버튼을 고르고, "새 손상"일 때만 유형과 심각도를 고른다(고르면 바로 다시 저장한다).
 * 판정은 서버에서 바로 학습 라벨이 된다(FR-024).
 */
export function FindingCard({
  finding,
  number,
  selected,
  onSelect,
  onVerdict,
}: {
  finding: Finding;
  /** 이 컷 안에서 몇 번째 후보인지(1부터). 사진 위 번호표와 같다 */
  number: number;
  selected: boolean;
  onSelect(): void;
  onVerdict(v: Verdict): Promise<void>;
}) {
  const [damageType, setDamageType] = useState<DamageType>(finding.predictedType ?? 'other');
  const [severity, setSeverity] = useState<Severity>('minor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(v: Verdict) {
    setBusy(true);
    setError(null);
    try {
      await onVerdict(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : '판정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function decide(verdict: VerdictValue) {
    return save(verdict === 'new_damage' ? { verdict, damageType, severity } : { verdict });
  }

  const label = `후보 #${finding.id}`;
  const isNew = finding.verdict === 'new_damage';
  return (
    <li className={`finding${selected ? ' is-selected' : ''}`} aria-label={label}>
      <button type="button" className="finding__head" onClick={onSelect}>
        <span className={`finding__no finding__no--${finding.verdict ?? 'pending'}`} aria-hidden="true">
          {number}
        </span>
        <strong>
          {finding.source === 'manual'
            ? '수동 추가'
            : (DAMAGE_TYPE_TEXT[finding.predictedType ?? 'other'] ?? '기타')}
        </strong>
        {finding.confidence !== undefined && (
          <span title="AI가 이 자리를 손상이라고 본 확신 정도예요. 높을수록 손상일 가능성이 커요.">
            AI 확신 {Math.round(finding.confidence * 100)}%
          </span>
        )}
        {finding.overlapsExistingDamage && <span className="badge">기존 손상과 겹침</span>}
        <span className={`verdict verdict--${finding.verdict ?? 'pending'}`}>
          {finding.verdict ? VERDICT_TEXT[finding.verdict] : '미판정'}
        </span>
      </button>
      <div className="finding__body">
        <div className="verdict-buttons" role="group" aria-label="판정">
          {(Object.keys(VERDICT_TEXT) as VerdictValue[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`btn btn--${v}${finding.verdict === v ? ' is-active' : ''}`}
              aria-pressed={finding.verdict === v}
              title={VERDICT_HELP[v]}
              disabled={busy}
              onClick={() => void decide(v)}
            >
              {VERDICT_TEXT[v]}
            </button>
          ))}
        </div>
        {(isNew || !finding.verdict) && (
          <div className="input-row">
            <label>
              유형
              <select
                value={damageType}
                disabled={busy}
                onChange={(e) => {
                  const t = e.target.value as DamageType;
                  setDamageType(t);
                  if (isNew) void save({ verdict: 'new_damage', damageType: t, severity });
                }}
              >
                {DAMAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DAMAGE_TYPE_TEXT[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              심각도
              <select
                value={severity}
                disabled={busy}
                onChange={(e) => {
                  const s = e.target.value as Severity;
                  setSeverity(s);
                  if (isNew) void save({ verdict: 'new_damage', damageType, severity: s });
                }}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_TEXT[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {!finding.verdict && <p className="finding__hint">유형·심각도는 "새 손상"일 때만 저장돼요.</p>}
        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

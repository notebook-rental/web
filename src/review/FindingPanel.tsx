import { useState } from 'react';
import type { DamageType, Finding, Severity, Verdict, VerdictValue } from '../api/types';
import { DAMAGE_TYPE_TEXT, SEVERITY_TEXT } from '../capture/shots';
import { DAMAGE_TYPES, SEVERITIES, VERDICT_TEXT } from './labels';

/**
 * 후보 하나를 판정하는 카드(FR-020). "새 손상"이면 유형과 심각도를 함께 고른다.
 * 판정은 서버에서 바로 학습 라벨이 된다(FR-024).
 */
export function FindingCard({
  finding,
  selected,
  onSelect,
  onVerdict,
}: {
  finding: Finding;
  selected: boolean;
  onSelect(): void;
  onVerdict(v: Verdict): Promise<void>;
}) {
  const [damageType, setDamageType] = useState<DamageType>(finding.predictedType ?? 'other');
  const [severity, setSeverity] = useState<Severity>('minor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(verdict: VerdictValue) {
    setBusy(true);
    setError(null);
    try {
      await onVerdict(verdict === 'new_damage' ? { verdict, damageType, severity } : { verdict });
    } catch (e) {
      setError(e instanceof Error ? e.message : '판정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const label = `후보 #${finding.id}`;
  return (
    <li className={`finding${selected ? ' is-selected' : ''}`} aria-label={label}>
      <button type="button" className="finding__head" onClick={onSelect}>
        <strong>
          {finding.source === 'manual'
            ? '수동 추가'
            : (DAMAGE_TYPE_TEXT[finding.predictedType ?? 'other'] ?? '기타')}
        </strong>
        {finding.confidence !== undefined && <span>신뢰도 {Math.round(finding.confidence * 100)}%</span>}
        {finding.overlapsExistingDamage && <span className="badge">기존 손상과 겹침</span>}
        <span className={`verdict verdict--${finding.verdict ?? 'pending'}`}>
          {finding.verdict ? VERDICT_TEXT[finding.verdict] : '미판정'}
        </span>
      </button>
      <div className="finding__body">
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
        <div className="verdict-buttons">
          {(Object.keys(VERDICT_TEXT) as VerdictValue[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`btn btn--${v}${finding.verdict === v ? ' is-active' : ''}`}
              disabled={busy}
              onClick={() => void decide(v)}
            >
              {VERDICT_TEXT[v]}
            </button>
          ))}
        </div>
        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

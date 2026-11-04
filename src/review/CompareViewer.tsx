import { useState } from 'react';
import type { Finding } from '../api/types';
import { svgPoints, type Size } from '../shared/annotate/geometry';

/**
 * 대여(기준) 사진과 반납 사진 비교(FR-019).
 * - 나란히: 두 장을 위아래로 놓고, 반납 사진 위에 후보 영역을 그린다.
 * - 겹쳐 보기: 기준 사진 위에 정렬된 반납 사진을 올리고 슬라이더로 경계를 옮기며 차이를 본다.
 */
export function CompareViewer({
  baselineUrl,
  targetUrl,
  alignedTargetUrl,
  targetSize,
  findings,
  selectedId,
  onSelect,
}: {
  baselineUrl?: string;
  targetUrl?: string;
  alignedTargetUrl?: string;
  targetSize?: Size;
  findings: Finding[];
  selectedId: number | null;
  onSelect(id: number): void;
}) {
  const [mode, setMode] = useState<'side' | 'overlay'>('side');
  const [split, setSplit] = useState(50);
  const [natural, setNatural] = useState<Size | null>(null);
  const size = targetSize ?? natural;
  const canOverlay = !!baselineUrl && !!(alignedTargetUrl ?? targetUrl);

  return (
    <div className="viewer">
      <div className="tabs" role="tablist" aria-label="보기 방식">
        <button type="button" role="tab" aria-selected={mode === 'side'} onClick={() => setMode('side')}>
          나란히
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'overlay'}
          onClick={() => setMode('overlay')}
          disabled={!canOverlay}
        >
          겹쳐 보기
        </button>
      </div>

      {mode === 'side' ? (
        <div className="viewer__side">
          <figure>
            <figcaption>대여 시</figcaption>
            {baselineUrl ? (
              <img src={baselineUrl} alt="대여 시 사진" />
            ) : (
              <p className="hint">기준 사진 없음</p>
            )}
          </figure>
          <figure>
            <figcaption>반납 시</figcaption>
            {targetUrl ? (
              <div className="annotate__stage">
                <img
                  src={targetUrl}
                  alt="반납 시 사진"
                  onLoad={(e) =>
                    setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
                  }
                />
                {size && (
                  <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none">
                    {findings.map((f) => (
                      <polygon
                        key={f.id}
                        data-testid={`finding-shape-${f.id}`}
                        className={`shape shape--${f.verdict ?? 'pending'}${f.id === selectedId ? ' is-selected' : ''}`}
                        points={svgPoints(f.geometry)}
                        onClick={() => onSelect(f.id)}
                      />
                    ))}
                  </svg>
                )}
              </div>
            ) : (
              <p className="hint">반납 사진 없음</p>
            )}
          </figure>
        </div>
      ) : (
        <div className="viewer__overlay">
          <div className="overlay-stack">
            <img src={baselineUrl} alt="대여 시 사진" />
            <img
              src={alignedTargetUrl ?? targetUrl}
              alt="반납 시 사진(정렬)"
              className="overlay-top"
              style={{ clipPath: `inset(0 0 0 ${split}%)` }}
            />
          </div>
          <label>
            경계 위치
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </label>
        </div>
      )}
    </div>
  );
}

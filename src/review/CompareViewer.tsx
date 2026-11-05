import { useEffect, useState, type ReactNode } from 'react';
import type { Finding } from '../api/types';
import { Icon } from '../shared/ui/Icon';
import { svgPoints, type Size } from '../shared/annotate/geometry';

/**
 * 대여(기준) 사진과 반납 사진 비교(FR-019).
 * - 나란히: 두 장을 나란히 놓고(폰에서도 한 화면에 들어오게), 반납 사진 위에 후보 영역을 번호와 함께 그린다.
 *   사진을 누르면 화면 가득 크게 보고, "대여 시 / 반납 시"를 번갈아 눌러 같은 자리를 비교한다(FR-050).
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
  baselineUrl?: string | null;
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
  const [zoom, setZoom] = useState<'baseline' | 'target' | null>(null);
  const size = targetSize ?? natural;
  const canOverlay = !!baselineUrl && !!(alignedTargetUrl ?? targetUrl);
  const overlayTarget = alignedTargetUrl ?? targetUrl;

  // 겹쳐 볼 수 없는 컷이면 늘 나란히 보기로 보여 준다.
  const view = canOverlay ? mode : 'side';

  const shapes = size && (
    <svg className="viewer__shapes" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none">
      {findings.map((f) => (
        <polygon
          key={f.id}
          data-testid={`finding-shape-${f.id}`}
          className={`shape shape--${f.verdict ?? 'pending'}${f.id === selectedId ? ' is-selected' : ''}`}
          points={svgPoints(f.geometry)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(f.id);
          }}
        />
      ))}
    </svg>
  );
  // 번호표는 SVG 글자 대신 HTML로 그린다(사진 비율이 바뀌어도 글자가 찌그러지지 않게).
  const tags =
    size &&
    findings.map((f, i) => {
      const [x, y] = topLeft(f);
      return (
        <span
          key={f.id}
          className={`shape-tag shape-tag--${f.verdict ?? 'pending'}${f.id === selectedId ? ' is-selected' : ''}`}
          style={{ left: `${(x / size.width) * 100}%`, top: `${(y / size.height) * 100}%` }}
          aria-hidden="true"
        >
          {i + 1}
        </span>
      );
    });

  return (
    <div className="viewer">
      <div className="tabs" role="tablist" aria-label="보기 방식">
        <button type="button" role="tab" aria-selected={view === 'side'} onClick={() => setMode('side')}>
          <Icon name="sideBySide" size={16} />
          나란히
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'overlay'}
          onClick={() => setMode('overlay')}
          disabled={!canOverlay}
        >
          <Icon name="overlay" size={16} />
          겹쳐 보기
        </button>
      </div>

      {view === 'side' ? (
        <>
          <div className="viewer__side">
            <figure>
              <figcaption>대여 시</figcaption>
              {baselineUrl ? (
                <button
                  type="button"
                  className="viewer__photo"
                  onClick={() => setZoom('baseline')}
                  aria-label="대여 시 사진 크게 보기"
                >
                  <img src={baselineUrl} alt="대여 시 사진" />
                </button>
              ) : (
                <p className="viewer__empty">대여 때 사진이 없어요</p>
              )}
            </figure>
            <figure>
              <figcaption>반납 시</figcaption>
              {targetUrl ? (
                <div className="annotate__stage">
                  <button
                    type="button"
                    className="viewer__photo"
                    onClick={() => setZoom('target')}
                    aria-label="반납 시 사진 크게 보기"
                  >
                    <img
                      src={targetUrl}
                      alt="반납 시 사진"
                      onLoad={(e) =>
                        setNatural({
                          width: e.currentTarget.naturalWidth,
                          height: e.currentTarget.naturalHeight,
                        })
                      }
                    />
                  </button>
                  {shapes}
                  {tags}
                </div>
              ) : (
                <p className="viewer__empty">반납 사진이 없어요</p>
              )}
            </figure>
          </div>
          {(baselineUrl || targetUrl) && <p className="viewer__tip">사진을 누르면 크게 볼 수 있어요.</p>}
        </>
      ) : (
        <div className="viewer__overlay">
          <div className="overlay-stack">
            <img src={baselineUrl ?? undefined} alt="대여 시 사진" />
            <img
              src={overlayTarget}
              alt="반납 시 사진(정렬)"
              className="overlay-top"
              style={{ clipPath: `inset(0 0 0 ${split}%)` }}
            />
          </div>
          <label>
            경계 위치 (왼쪽: 대여 시 · 오른쪽: 반납 시)
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              aria-label="경계 위치"
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {zoom && (
        <ZoomDialog
          which={zoom}
          onWhich={setZoom}
          baselineUrl={baselineUrl ?? undefined}
          targetUrl={targetUrl}
          shapes={shapes}
          tags={tags}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

/** 사진을 화면 가득 보여 준다. 대여 시/반납 시를 번갈아 눌러 같은 자리를 비교한다. */
function ZoomDialog({
  which,
  onWhich,
  baselineUrl,
  targetUrl,
  shapes,
  tags,
  onClose,
}: {
  which: 'baseline' | 'target';
  onWhich(w: 'baseline' | 'target'): void;
  baselineUrl?: string;
  targetUrl?: string;
  shapes: ReactNode;
  tags: ReactNode;
  onClose(): void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const src = which === 'baseline' ? baselineUrl : targetUrl;
  return (
    <div className="photo-dialog" role="dialog" aria-modal="true" aria-label="사진 크게 보기">
      <div className="photo-dialog__bar">
        <div className="tabs tabs--dark" role="tablist" aria-label="어느 사진">
          <button
            type="button"
            role="tab"
            aria-selected={which === 'baseline'}
            disabled={!baselineUrl}
            onClick={() => onWhich('baseline')}
          >
            대여 시
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={which === 'target'}
            disabled={!targetUrl}
            onClick={() => onWhich('target')}
          >
            반납 시
          </button>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="닫기">
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="photo-dialog__stage">
        <div className="annotate__stage photo-dialog__frame">
          <img src={src} alt={which === 'baseline' ? '대여 시 사진(크게)' : '반납 시 사진(크게)'} />
          {which === 'target' && shapes}
          {which === 'target' && tags}
        </div>
      </div>
    </div>
  );
}

function topLeft(f: Finding): [number, number] {
  if (f.geometry.type === 'box') return [f.geometry.coords[0], f.geometry.coords[1]];
  const xs = f.geometry.coords.map((c) => c[0]);
  const ys = f.geometry.coords.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys)];
}

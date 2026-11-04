import { useRef, useState, type PointerEvent } from 'react';
import type { Geometry } from '../../api/types';
import { boxFrom, clientToImage, isUsable, svgPoints, type Point, type Size } from './geometry';

/**
 * 사진 위에 박스나 폴리곤(꼭짓점을 이은 다각형)을 그린다. 검토 화면의 수동 추가(US3)와 라벨링 화면(US4)이 함께 쓴다.
 * 좌표는 사진의 원본 픽셀 기준이다. 화면에 작게 보여도 서버에는 원본 좌표로 보낸다.
 *
 * - 박스: 누른 채로 끌었다 놓는다.
 * - 폴리곤: 꼭짓점을 차례로 누르고 "다각형 닫기"를 누른다(3점 이상).
 */
export function AnnotationCanvas({
  src,
  size: givenSize,
  mode,
  value,
  onChange,
}: {
  src: string;
  size?: Size;
  mode: 'box' | 'polygon';
  value: Geometry | null;
  onChange(g: Geometry | null): void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [draft, setDraft] = useState<Geometry | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const size = givenSize ?? natural;

  function toImage(e: PointerEvent): Point | null {
    if (!svgRef.current || !size) return null;
    return clientToImage(svgRef.current.getBoundingClientRect(), size, e.clientX, e.clientY);
  }

  function down(e: PointerEvent<SVGSVGElement>) {
    const p = toImage(e);
    if (!p) return;
    if (mode === 'box') {
      svgRef.current?.setPointerCapture?.(e.pointerId);
      setDragStart(p);
      setDraft(boxFrom(p, p));
    } else {
      setPoints((prev) => [...prev, p]);
    }
  }

  function move(e: PointerEvent<SVGSVGElement>) {
    if (mode !== 'box' || !dragStart) return;
    const p = toImage(e);
    if (p) setDraft(boxFrom(dragStart, p));
  }

  function up(e: PointerEvent<SVGSVGElement>) {
    if (mode !== 'box' || !dragStart) return;
    const p = toImage(e) ?? dragStart;
    const g = boxFrom(dragStart, p);
    setDragStart(null);
    setDraft(null);
    onChange(isUsable(g) ? g : null);
  }

  function closePolygon() {
    const g: Geometry = { type: 'polygon', coords: points };
    setPoints([]);
    onChange(isUsable(g) ? g : null);
  }

  function clear() {
    setPoints([]);
    setDraft(null);
    onChange(null);
  }

  const shown = draft ?? value;

  return (
    <div className="annotate">
      <div className="annotate__stage">
        <img
          src={src}
          alt="표시할 사진"
          onLoad={(e) =>
            setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
          }
          draggable={false}
        />
        {size && (
          <svg
            ref={svgRef}
            data-testid="annotate-surface"
            viewBox={`0 0 ${size.width} ${size.height}`}
            preserveAspectRatio="none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
          >
            {shown && <polygon className="shape shape--draft" points={svgPoints(shown)} />}
            {points.length > 0 && (
              <polyline className="shape shape--draft" points={points.map((p) => p.join(',')).join(' ')} />
            )}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={Math.max(size.width, size.height) / 150}
                className="vertex"
              />
            ))}
          </svg>
        )}
      </div>
      <div className="annotate__tools">
        {mode === 'polygon' && (
          <button type="button" className="btn" onClick={closePolygon} disabled={points.length < 3}>
            다각형 닫기 ({points.length}점)
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={clear}>
          지우기
        </button>
      </div>
    </div>
  );
}

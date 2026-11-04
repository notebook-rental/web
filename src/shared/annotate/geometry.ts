import type { Geometry } from '../../api/types';

/** 사진 좌표(원본 픽셀) 계산 도우미 */

export interface Size {
  width: number;
  height: number;
}
export type Point = [number, number];

/** 화면에서 누른 위치(clientX, clientY)를 사진 픽셀 좌표로 바꾼다. 사진 밖이면 가장자리로 붙인다. */
export function clientToImage(
  rect: DOMRect | { left: number; top: number; width: number; height: number },
  size: Size,
  clientX: number,
  clientY: number,
): Point {
  const x = ((clientX - rect.left) / rect.width) * size.width;
  const y = ((clientY - rect.top) / rect.height) * size.height;
  return [clamp(Math.round(x), 0, size.width), clamp(Math.round(y), 0, size.height)];
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** 두 꼭짓점으로 박스를 만든다. 어느 방향으로 끌어도 [x1,y1,x2,y2] (x1<x2, y1<y2)가 된다. */
export function boxFrom(a: Point, b: Point): Geometry {
  return {
    type: 'box',
    coords: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  };
}

/** 너무 작은 영역(손 떨림으로 생긴 점)은 버린다. */
export function isUsable(g: Geometry, minSide = 4): boolean {
  if (g.type === 'box') {
    const [x1, y1, x2, y2] = g.coords;
    return x2 - x1 >= minSide && y2 - y1 >= minSide;
  }
  return g.coords.length >= 3;
}

/** SVG polygon의 points 속성 문자열 */
export function svgPoints(g: Geometry): string {
  const pts: Point[] =
    g.type === 'box'
      ? [
          [g.coords[0], g.coords[1]],
          [g.coords[2], g.coords[1]],
          [g.coords[2], g.coords[3]],
          [g.coords[0], g.coords[3]],
        ]
      : g.coords;
  return pts.map((p) => p.join(',')).join(' ');
}

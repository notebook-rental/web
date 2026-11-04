import { describe, expect, it } from 'vitest';
import { boxFrom, clientToImage, isUsable, svgPoints } from './geometry';

describe('geometry', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  const size = { width: 4000, height: 2000 };

  it('화면 좌표를 원본 픽셀 좌표로 바꾸고 바깥은 가장자리로 붙인다', () => {
    expect(clientToImage(rect, size, 110, 70)).toEqual([2000, 1000]);
    expect(clientToImage(rect, size, 0, 0)).toEqual([0, 0]);
    expect(clientToImage(rect, size, 500, 500)).toEqual([4000, 2000]);
  });

  it('어느 방향으로 끌어도 박스 좌표가 정렬된다', () => {
    expect(boxFrom([30, 40], [10, 20])).toEqual({ type: 'box', coords: [10, 20, 30, 40] });
  });

  it('너무 작은 박스와 3점 미만 다각형은 쓰지 않는다', () => {
    expect(isUsable({ type: 'box', coords: [0, 0, 2, 50] })).toBe(false);
    expect(isUsable({ type: 'box', coords: [0, 0, 10, 10] })).toBe(true);
    expect(
      isUsable({
        type: 'polygon',
        coords: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBe(false);
    expect(
      isUsable({
        type: 'polygon',
        coords: [
          [0, 0],
          [1, 1],
          [2, 0],
        ],
      }),
    ).toBe(true);
  });

  it('SVG points 문자열을 만든다', () => {
    expect(svgPoints({ type: 'box', coords: [1, 2, 3, 4] })).toBe('1,2 3,2 3,4 1,4');
    expect(
      svgPoints({
        type: 'polygon',
        coords: [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
      }),
    ).toBe('0,0 5,0 5,5');
  });
});

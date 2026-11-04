import { describe, expect, it } from 'vitest';
import {
  fitWithin,
  laplacianVariance,
  meanLuma,
  measureQuality,
  qualityReasons,
  sha256Hex,
  toGray,
} from './imageOps';

function rgba(width: number, height: number, f: (x: number, y: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = f(x, y);
      const i = (y * width + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  return d;
}

describe('fitWithin', () => {
  it('긴 변을 기준으로 비율을 지키며 줄이고, 작은 사진은 키우지 않는다', () => {
    expect(fitWithin(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3000, 4000, 2560)).toEqual({ width: 1920, height: 2560 });
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe('밝기와 선명도', () => {
  it('toGray는 BT.601 가중치를 쓴다', () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    expect(g[0]).toBeCloseTo(76.245);
    expect(g[1]).toBeCloseTo(149.685);
  });

  it('meanLuma는 평균, 빈 배열은 0', () => {
    expect(meanLuma(new Float32Array([0, 100, 200]))).toBe(100);
    expect(meanLuma(new Float32Array())).toBe(0);
  });

  it('또렷한 체크무늬는 라플라시안 분산이 크고 평평한 면은 0이다', () => {
    const sharp = toGray(
      rgba(32, 32, (x, y) => ((x + y) % 2 ? 255 : 0)),
      32,
      32,
    );
    const flat = toGray(
      rgba(32, 32, () => 128),
      32,
      32,
    );
    expect(laplacianVariance(sharp, 32, 32)).toBeGreaterThan(10000);
    expect(laplacianVariance(flat, 32, 32)).toBe(0);
    expect(laplacianVariance(flat, 2, 2)).toBe(0);
  });

  it('부드러운 그라데이션(흐린 사진)은 흐림으로 판정한다', () => {
    const m = measureQuality(
      rgba(64, 64, (x) => 60 + x * 2),
      64,
      64,
    );
    expect(qualityReasons(m)).toEqual(['blurry']);
  });

  it('어둡거나 너무 밝으면 사유를 붙인다', () => {
    expect(qualityReasons({ sharpness: 500, brightness: 10 })).toEqual(['too_dark']);
    expect(qualityReasons({ sharpness: 500, brightness: 250 })).toEqual(['too_bright']);
    expect(qualityReasons({ sharpness: 500, brightness: 128 })).toEqual([]);
  });
});

describe('sha256Hex', () => {
  it('알려진 값과 같다', async () => {
    const data = new TextEncoder().encode('abc');
    expect(await sha256Hex(data.buffer as ArrayBuffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

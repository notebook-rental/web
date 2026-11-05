import { isLabelValue, normalizeQrValue } from './qrValue';

/**
 * 프레임마다 읽은 라벨 값을 모아 "확정"을 판단한다.
 *
 * - 같은 값이 연속 2프레임에서 읽히면 확정한다(잘못 읽은 한 프레임에 반응하지 않게). 바코드는 가끔 한 글자를 잘못 읽는다.
 * - 한 프레임에 서로 다른 라벨 값이 둘 이상이면 식별을 거부한다(FR-009, 옆 노트북 라벨이 함께 찍힌 경우).
 * - 자산 번호로 쓸 수 없는 값(URL 등)은 따로 알려 준다.
 */
export type ReadOutcome =
  | { kind: 'none' }
  | { kind: 'pending'; value: string }
  | { kind: 'confirmed'; value: string }
  | { kind: 'multiple'; values: string[] }
  | { kind: 'foreign' };

export class StableReader {
  private last: string | null = null;
  private count = 0;

  constructor(private readonly needed = 2) {}

  push(rawValues: string[]): ReadOutcome {
    const values = [...new Set(rawValues.map(normalizeQrValue))];
    const ours = values.filter(isLabelValue);
    if (ours.length > 1) {
      this.reset();
      return { kind: 'multiple', values: ours };
    }
    if (ours.length === 0) {
      this.reset();
      return values.length > 0 ? { kind: 'foreign' } : { kind: 'none' };
    }
    const value = ours[0];
    if (value === this.last) this.count += 1;
    else {
      this.last = value;
      this.count = 1;
    }
    if (this.count >= this.needed) {
      this.reset();
      return { kind: 'confirmed', value };
    }
    return { kind: 'pending', value };
  }

  reset(): void {
    this.last = null;
    this.count = 0;
  }
}

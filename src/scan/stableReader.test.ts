import { describe, expect, it } from 'vitest';
import { isLabelValue, isSystemQr, normalizeQrValue } from './qrValue';
import { StableReader } from './stableReader';

const A = 'NR1:7K3M9QX2TD';
const B = 'NR1:0123456789';

describe('qrValue', () => {
  it('NR1: 접두와 Crockford Base32 10자만 받는다', () => {
    expect(isSystemQr(A)).toBe(true);
    expect(isSystemQr(' nr1:7k3m9qx2td ')).toBe(true);
    expect(isSystemQr('NR1:7K3M9QX2T')).toBe(false); // 9자
    expect(isSystemQr('NR1:7K3M9QX2TI')).toBe(false); // I는 쓰지 않는 글자
    expect(isSystemQr('https://example.com')).toBe(false);
    expect(normalizeQrValue(' nr1:abc ')).toBe('NR1:ABC');
  });

  it('자산 번호 라벨 값은 글자 그대로 두고, 자산 번호 모양만 받는다(spec 002)', () => {
    expect(normalizeQrValue(' NB26110001 ')).toBe('NB26110001');
    expect(normalizeQrValue('a-001')).toBe('a-001');
    expect(isLabelValue('NB26110001')).toBe(true);
    expect(isLabelValue('OLD/ASSET_7.1')).toBe(true);
    expect(isLabelValue(A)).toBe(true);
    expect(isLabelValue('NR1:BAD')).toBe(false);
    expect(isLabelValue('https://example.com')).toBe(false);
    expect(isLabelValue('-x')).toBe(false);
    expect(isLabelValue('A'.repeat(31))).toBe(false);
  });
});

describe('StableReader', () => {
  it('같은 값이 연속 2프레임이면 확정한다', () => {
    const r = new StableReader();
    expect(r.push([A])).toEqual({ kind: 'pending', value: A });
    expect(r.push([A])).toEqual({ kind: 'confirmed', value: A });
    // 확정 뒤에는 처음부터 다시 센다.
    expect(r.push([A])).toEqual({ kind: 'pending', value: A });
  });

  it('값이 바뀌면 다시 센다', () => {
    const r = new StableReader();
    r.push([A]);
    expect(r.push([B])).toEqual({ kind: 'pending', value: B });
    expect(r.push([B])).toEqual({ kind: 'confirmed', value: B });
  });

  it('빈 프레임이 끼면 처음부터 센다', () => {
    const r = new StableReader();
    r.push([A]);
    expect(r.push([])).toEqual({ kind: 'none' });
    expect(r.push([A]).kind).toBe('pending');
  });

  it('서로 다른 시스템 QR이 둘 이상이면 거부한다(FR-009)', () => {
    const r = new StableReader();
    expect(r.push([A, B])).toEqual({ kind: 'multiple', values: [A, B] });
  });

  it('같은 QR이 두 번 읽힌 것은 하나로 본다', () => {
    const r = new StableReader(1);
    expect(r.push([A, A.toLowerCase()])).toEqual({ kind: 'confirmed', value: A });
  });

  it('자산 번호로 쓸 수 없는 값만 있으면 foreign', () => {
    const r = new StableReader();
    expect(r.push(['https://example.com'])).toEqual({ kind: 'foreign' });
    // URL 같은 값이 섞여 있어도 라벨은 읽는다.
    expect(r.push(['https://example.com', A]).kind).toBe('pending');
    expect(r.push(['NB26110001']).kind).toBe('pending');
  });
});

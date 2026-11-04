import { describe, expect, it } from 'vitest';
import { isSystemQr, normalizeQrValue } from './qrValue';
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

  it('시스템 QR이 아닌 값만 있으면 foreign', () => {
    const r = new StableReader();
    expect(r.push(['hello'])).toEqual({ kind: 'foreign' });
    // 다른 바코드가 섞여 있어도 시스템 QR은 읽는다.
    expect(r.push(['hello', A]).kind).toBe('pending');
  });
});

/**
 * 이 시스템이 발급한 QR 값인지 확인한다.
 * 형식: "NR1:" + Crockford Base32 10자 (tasks T030). 예: NR1:7K3M9QX2TD
 * Crockford Base32는 헷갈리는 글자(I, L, O, U)를 뺀 32글자다.
 */
const PATTERN = /^NR1:[0-9A-HJKMNP-TV-Z]{10}$/;

export function normalizeQrValue(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isSystemQr(raw: string): boolean {
  return PATTERN.test(normalizeQrValue(raw));
}

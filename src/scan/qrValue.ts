/**
 * 라벨 값 규칙(docs spec 002). 노트북은 자산 번호 하나로 식별하고, 라벨(QR 또는 바코드)에는 자산 번호만 들어 있다.
 *
 * - 시스템이 매기는 자산 번호: NB + 연도 2자리 + 월 2자리 + 그 달 순번 4자리. 예: NB26110001
 * - 원래 붙어 있던 외부 자산 번호도 받는다: 영문·숫자로 시작, 영문·숫자·. _ / - 만, 30자 이하
 * - 예전 QR 스티커: "NR1:" + Crockford Base32 10자(헷갈리는 I, L, O, U를 뺀 32글자). 예: NR1:7K3M9QX2TD
 */
const LEGACY = /^NR1:[0-9A-HJKMNP-TV-Z]{10}$/;
const ASSET = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,29}$/;

/** 앞뒤 공백을 지운다. 예전 QR 값만 대문자로 바꾼다(자산 번호는 글자 그대로 둔다). */
export function normalizeQrValue(raw: string): string {
  const v = raw.trim();
  return /^nr1:/i.test(v) ? v.toUpperCase() : v;
}

/** 예전 방식 QR 스티커 값인가. */
export function isSystemQr(raw: string): boolean {
  return LEGACY.test(normalizeQrValue(raw));
}

/** 스캔해서 서버에 물어볼 만한 라벨 값인가(예전 QR 또는 자산 번호 모양). URL 같은 값은 거른다. */
export function isLabelValue(raw: string): boolean {
  const v = normalizeQrValue(raw);
  return LEGACY.test(v) || (!/^nr1:/i.test(v) && ASSET.test(v));
}

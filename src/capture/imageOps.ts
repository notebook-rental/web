/**
 * 촬영 직후 폰에서 하는 계산. 순수 함수라 단위 테스트로 검증한다.
 *
 * - 작업본 크기: 긴 변 2560px로 줄인다(업로드를 2~5배 빠르게, research R15).
 * - 1차 품질 검사: 흐림(라플라시안 분산), 노출(평균 밝기). 서버가 최종 검사를 한 번 더 한다(헌법 VI).
 * - sha256: 원본이 서버에 바뀌지 않고 도착했는지 서버가 대조하는 값(헌법 II).
 */

export const WORKING_MAX_SIDE = 2560;
export const WORKING_JPEG_QUALITY = 0.9;
/**
 * 작업본 최대 크기. 서버 앞단 Nginx가 기본 설정(client_max_body_size 1m)이면 1MB를 넘는 요청을 끊는데,
 * 아이폰 Safari는 이것을 응답 없이 "Load failed"로만 알린다. 그래서 1MB 아래로 맞춰 보낸다.
 */
export const WORKING_MAX_BYTES = 900 * 1024;
/** 크기를 넘으면 차례로 시도할 (긴 변, 품질) */
export const WORKING_FALLBACKS: { side: number; quality: number }[] = [
  { side: 2560, quality: 0.8 },
  { side: 2560, quality: 0.7 },
  { side: 2048, quality: 0.75 },
  { side: 2048, quality: 0.6 },
  { side: 1600, quality: 0.6 },
];
/** 품질 검사용 축소 크기. 작게 줄여도 흐림·노출 판단에는 충분하다. */
export const ANALYSIS_MAX_SIDE = 512;

export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** RGBA → 밝기(0~255). ITU-R BT.601 가중치. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return gray;
}

export function meanLuma(gray: Float32Array): number {
  if (gray.length === 0) return 0;
  let sum = 0;
  for (const v of gray) sum += v;
  return sum / gray.length;
}

/**
 * 라플라시안 분산: 경계가 또렷할수록 커진다. 흔들린 사진은 경계가 뭉개져 값이 작다.
 * 3x3 커널 [0,1,0;1,-4,1;0,1,0]을 안쪽 픽셀에 적용한 결과의 분산.
 */
export function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export interface QualityMetrics {
  sharpness: number;
  brightness: number;
}

export interface QualityThresholds {
  minSharpness: number;
  minBrightness: number;
  maxBrightness: number;
}

/** 기본 기준. 실제 폰으로 찍어 보며 조정한다(서버 기준보다 느슨하게 둬서 서버와 엇갈리지 않게). */
export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minSharpness: 40,
  minBrightness: 45,
  maxBrightness: 225,
};

export function measureQuality(rgba: Uint8ClampedArray, width: number, height: number): QualityMetrics {
  const gray = toGray(rgba, width, height);
  return { sharpness: laplacianVariance(gray, width, height), brightness: meanLuma(gray) };
}

export function qualityReasons(m: QualityMetrics, t: QualityThresholds = DEFAULT_THRESHOLDS): string[] {
  const reasons: string[] = [];
  if (m.sharpness < t.minSharpness) reasons.push('blurry');
  if (m.brightness < t.minBrightness) reasons.push('too_dark');
  else if (m.brightness > t.maxBrightness) reasons.push('too_bright');
  return reasons;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

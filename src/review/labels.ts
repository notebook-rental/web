import type { ComparisonStatus, DamageType, Severity, VerdictValue } from '../api/types';
import { DAMAGE_TYPE_TEXT, SEVERITY_TEXT } from '../capture/shots';

export const VERDICT_TEXT: Record<VerdictValue, string> = {
  new_damage: '새 손상',
  existing_damage: '기존 손상',
  false_positive: '손상 아님',
};

/** 판정 버튼마다 무엇을 뜻하는지 한 줄로 알려 준다(처음 쓰는 직원용). */
export const VERDICT_HELP: Record<VerdictValue, string> = {
  new_damage: '이번 대여 중에 생긴 손상',
  existing_damage: '빌려 가기 전부터 있던 손상',
  false_positive: '빛 반사, 먼지, 그림자처럼 손상이 아닌 것',
};

export const DAMAGE_TYPES = Object.keys(DAMAGE_TYPE_TEXT) as DamageType[];
export const SEVERITIES = Object.keys(SEVERITY_TEXT) as Severity[];

/**
 * 자동 비교를 못 한 이유(ml 의 reason 코드)를 직원이 알아듣는 말로 바꾼다.
 * 대부분 "같은 점을 충분히 못 찾았다"는 뜻이라, 무엇이 원인일 수 있는지를 함께 적는다.
 */
const REASON_TEXT: Record<string, string> = {
  too_few_matches: '대여 때 사진과 같은 곳(모서리, 로고 등)을 충분히 찾지 못했어요.',
  too_few_inliers: '대여 때 사진과 같은 곳(모서리, 로고 등)을 충분히 찾지 못했어요.',
  homography_failed: '두 사진을 같은 모양으로 겹치지 못했어요.',
  alignment_error_too_large: '두 사진을 겹쳐 봤지만 어긋남이 너무 커요.',
  alignment_failed: '두 사진을 같은 모양으로 겹치지 못했어요.',
  no_baseline: '비교할 대여 때 사진이 없어요.',
  laptop_not_found: '반납 사진에서 노트북을 찾지 못했어요.',
  no_matching_baseline: '대여 때 찍은 이 노트북 사진 중 닮은 사진을 찾지 못했어요.',
};

export function reasonText(reason?: string | null): string {
  return (reason && REASON_TEXT[reason]) || '두 사진을 자동으로 맞춰 보지 못했어요.';
}

/** 자동 비교를 하지 못해 사람이 직접 봐야 하는 컷인지 */
export function needsManualCheck(status?: ComparisonStatus | null): boolean {
  return status === 'not_comparable' || status === 'failed';
}

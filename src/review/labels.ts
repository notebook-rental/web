import type { DamageType, Severity, VerdictValue } from '../api/types';
import { DAMAGE_TYPE_TEXT, SEVERITY_TEXT } from '../capture/shots';

export const VERDICT_TEXT: Record<VerdictValue, string> = {
  new_damage: '새 손상',
  existing_damage: '기존 손상',
  false_positive: '오탐',
};

export const DAMAGE_TYPES = Object.keys(DAMAGE_TYPE_TEXT) as DamageType[];
export const SEVERITIES = Object.keys(SEVERITY_TEXT) as Severity[];

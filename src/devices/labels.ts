import type { DeviceStatus } from '../api/types';

export const STATUS_TEXT: Record<DeviceStatus, string> = {
  available: '대여 가능',
  rented: '대여 중',
  inspecting: '검사 중',
  repair: '수리 중',
  retired: '폐기',
};

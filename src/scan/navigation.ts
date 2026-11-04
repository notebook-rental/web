import type { NavigateFunction } from 'react-router-dom';
import type { ScanResult } from '../api/types';

export interface DevicePageState {
  scan: ScanResult;
  identifiedBy: 'qr' | 'manual';
  scannedQrValue?: string;
}

/** 스캔(또는 자산 번호 조회) 결과에 맞는 화면으로 이동한다(FR-007, FR-047). */
export function goToScanResult(
  navigate: NavigateFunction,
  scan: ScanResult,
  identifiedBy: 'qr' | 'manual',
  scannedQrValue?: string,
): void {
  if (scan.nextAction === 'register') {
    navigate(`/register?qr=${encodeURIComponent(scan.qrValue ?? scannedQrValue ?? '')}`);
    return;
  }
  const state: DevicePageState = { scan, identifiedBy, scannedQrValue };
  navigate('/device', { state });
}

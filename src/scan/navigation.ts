import type { NavigateFunction } from 'react-router-dom';
import type { ScanResult } from '../api/types';
import type { CaptureRequest } from '../capture/CaptureScreen';

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
  options: { replace?: boolean } = {},
): void {
  if (scan.nextAction === 'register') {
    navigate(`/register?qr=${encodeURIComponent(scan.qrValue ?? scannedQrValue ?? '')}`, options);
    return;
  }
  const state: DevicePageState = { scan, identifiedBy, scannedQrValue };
  navigate('/device', { state, ...options });
}

/**
 * 등록 기준 사진(spec 002 US5)을 찍을 수 있으면 촬영 화면으로 넘길 정보를 만든다.
 * 대여 가능 상태이고 진행할 대여·반납이 없으며, 기준 사진을 아직 다 찍지 않았을 때만이다.
 */
export function registerCaptureRequest(
  scan: ScanResult,
  identifiedBy: 'qr' | 'manual',
  scannedQrValue?: string,
): CaptureRequest | null {
  const device = scan.device;
  if (!device || device.status !== 'available' || scan.nextAction !== 'none') return null;
  if (scan.registerPhotos === 'completed') return null;
  return {
    kind: 'register',
    deviceId: device.id,
    identifiedBy,
    scannedQrValue,
    inspectionId: scan.registerInspectionId ?? undefined,
    requiredShots: scan.requiredShots,
    deviceLabel: device.assetNo,
  };
}

import { useState } from 'react';
import type { BarcodeKind } from './qrDecoder';

/**
 * 스캔 방식(자동/QR/바코드). 자동은 둘 다 읽는다. 잘 안 읽힐 때 하나만 고르면 해독기가 찾을 형식이 줄어 더 빠르고,
 * 엉뚱한 바코드(제조사 바코드 등)를 덜 읽는다. 마지막에 고른 것을 이 폰에 기억한다.
 */
export const SCAN_MODES: { kind: BarcodeKind; label: string }[] = [
  { kind: 'auto', label: '자동' },
  { kind: 'qr', label: 'QR' },
  { kind: 'barcode', label: '바코드' },
];

const KEY = 'scanMode';

export function loadScanMode(): BarcodeKind {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'auto' || v === 'qr' || v === 'barcode') return v;
  } catch {
    // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)는 기본값
  }
  return 'auto';
}

export function useScanMode(): [BarcodeKind, (k: BarcodeKind) => void] {
  const [mode, setMode] = useState<BarcodeKind>(loadScanMode);
  return [
    mode,
    (k) => {
      setMode(k);
      try {
        localStorage.setItem(KEY, k);
      } catch {
        // 기억하지 못해도 이번 스캔에는 쓴다
      }
    },
  ];
}

import { useState } from 'react';
import type { LabelFormat } from '../api/types';

const KEY = 'labelFormat';

/** 라벨 출력 형식(QR/바코드). 마지막에 고른 것을 이 브라우저에 기억한다. */
export function useLabelFormat(): [LabelFormat, (f: LabelFormat) => void] {
  const [format, setFormat] = useState<LabelFormat>(() => {
    try {
      return localStorage.getItem(KEY) === 'barcode' ? 'barcode' : 'qr';
    } catch {
      return 'qr';
    }
  });
  return [
    format,
    (f) => {
      setFormat(f);
      try {
        localStorage.setItem(KEY, f);
      } catch {
        // 기억하지 못해도 이번 출력에는 쓴다
      }
    },
  ];
}

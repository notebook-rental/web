import { useEffect, useRef, type RefObject } from 'react';
import { createDecoder, type BarcodeKind, type Decoder } from './qrDecoder';

export interface ScannerOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  kind: BarcodeKind;
  /** 프레임마다 읽은 값(없으면 빈 배열) */
  onFrame(values: string[]): void;
  /** 다음 해독까지 쉬는 시간(ms). 해독이 끝난 뒤부터 센다. */
  intervalMs?: number;
  decoderFactory?: (kind: BarcodeKind) => Promise<Decoder>;
}

/**
 * 카메라 영상을 계속 해독한다. 앞 해독이 끝나야 다음 해독을 시작해서 느린 폰에서도 밀리지 않는다.
 */
export function useBarcodeScanner({
  videoRef,
  active,
  kind,
  onFrame,
  intervalMs = 80,
  decoderFactory = createDecoder,
}: ScannerOptions): void {
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let decoder: Decoder | null = null;

    const tick = async () => {
      if (stopped || !decoder) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const values = await decoder.decode(video);
          if (!stopped) onFrameRef.current(values);
        } catch {
          // 한 프레임 실패는 무시하고 다음 프레임을 본다.
        }
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };

    decoderFactory(kind).then(
      (d) => {
        if (stopped) {
          d.dispose();
          return;
        }
        decoder = d;
        void tick();
      },
      // 해독기를 만들 수 없는 아주 오래된 브라우저. 스캔 화면의 "자산 번호로 찾기"로 진행한다.
      () => undefined,
    );

    return () => {
      stopped = true;
      clearTimeout(timer);
      decoder?.dispose();
    };
  }, [active, kind, intervalMs, videoRef, decoderFactory]);
}

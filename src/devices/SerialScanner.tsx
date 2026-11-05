import { useEffect, useRef } from 'react';
import { useCamera } from '../camera/CameraProvider';
import { CameraView } from '../camera/CameraView';
import type { BarcodeKind, Decoder } from '../scan/qrDecoder';
import { useBarcodeScanner } from '../scan/useBarcodeScanner';

/** 하판 시리얼 라벨의 바코드를 비춰 시리얼 번호를 읽는다. 읽히면 바로 닫힌다. */
export function SerialScanner({
  onRead,
  onClose,
  decoderFactory,
}: {
  onRead(value: string): void;
  onClose(): void;
  decoderFactory?: (k: BarcodeKind) => Promise<Decoder>;
}) {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const done = useRef(false);

  useEffect(() => {
    void camera.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useBarcodeScanner({
    videoRef,
    active: !!camera.stream,
    kind: 'auto',
    decoderFactory,
    onFrame(values) {
      const v = values.map((s) => s.trim()).find((s) => s && !s.startsWith('NR1:'));
      if (v && !done.current) {
        done.current = true;
        onRead(v);
      }
    },
  });

  return (
    <div className="sheet" role="dialog" aria-label="시리얼 바코드 스캔">
      <CameraView ref={videoRef} stream={camera.stream}>
        <div className="scan-frame scan-frame--wide" aria-hidden="true" />
      </CameraView>
      <p className="hint">하판 라벨의 시리얼 바코드를 비춰 주세요.</p>
      <button type="button" className="btn" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

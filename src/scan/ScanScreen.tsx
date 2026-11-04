import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ResultCode } from '../api/resultCodes';
import { useServices } from '../app/services';
import { useCamera } from '../camera/CameraProvider';
import { CameraView } from '../camera/CameraView';
import type { BarcodeKind, Decoder } from './qrDecoder';
import { goToScanResult } from './navigation';
import { StableReader } from './stableReader';
import { useBarcodeScanner } from './useBarcodeScanner';
import { Icon } from '../shared/ui/Icon';

const RETRY_COOLDOWN_MS = 3000;

/**
 * 앱 첫 화면. 카메라를 켜 두고 QR이 보이는 즉시 읽어 다음 화면으로 넘어간다.
 * 사진을 찍거나 저장하지 않는다. 서버에는 읽은 값만 보낸다(GET /scan/{qrValue}).
 */
export function ScanScreen({ decoderFactory }: { decoderFactory?: (k: BarcodeKind) => Promise<Decoder> }) {
  const { endpoints } = useServices();
  const camera = useCamera();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const reader = useRef(new StableReader());
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('노트북 상판의 QR을 화면 안에 비춰 주세요.');
  const [error, setError] = useState<string | null>(null);
  // 조회에 실패한 QR이 계속 화면에 있으면 같은 요청을 반복하지 않도록 잠시 무시한다.
  const cooldown = useRef<{ value: string; until: number } | null>(null);

  useEffect(() => {
    void camera.start();
    // camera.start는 안정된 함수다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookUp = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      navigator.vibrate?.(40);
      try {
        const scan = await endpoints.scan(value);
        if (scan.nextAction === 'blocked') {
          cooldown.current = { value, until: Date.now() + RETRY_COOLDOWN_MS };
          setError('폐기된 QR입니다. 관리자에게 새 QR을 받아 붙여 주세요.');
          setBusy(false);
          return;
        }
        goToScanResult(navigate, scan, 'qr', value);
      } catch (e) {
        cooldown.current = { value, until: Date.now() + RETRY_COOLDOWN_MS };
        if (e instanceof ApiError && e.resultCode === ResultCode.QR_NOT_ISSUED) {
          setError('이 시스템에서 발급한 QR이 아닙니다.');
        } else {
          setError(e instanceof Error ? e.message : '조회에 실패했습니다.');
        }
        setBusy(false);
      }
    },
    [endpoints, navigate],
  );

  const onFrame = useCallback(
    (values: string[]) => {
      const out = reader.current.push(values);
      if (out.kind === 'confirmed') {
        const c = cooldown.current;
        if (c && c.value === out.value && Date.now() < c.until) return;
        void lookUp(out.value);
      } else if (out.kind === 'multiple')
        setHint('QR이 여러 개 보입니다. 노트북 한 대의 QR만 화면에 들어오게 해 주세요.');
      else if (out.kind === 'foreign') setHint('이 서비스의 QR이 아닙니다. 노트북 상판의 QR을 비춰 주세요.');
      else if (out.kind === 'pending') setHint('QR을 읽는 중입니다. 잠시 그대로 있어 주세요.');
    },
    [lookUp],
  );

  useBarcodeScanner({
    videoRef,
    active: !!camera.stream && !busy,
    kind: 'qr',
    onFrame,
    decoderFactory,
  });

  return (
    <section className="screen screen--camera">
      <CameraView ref={videoRef} stream={camera.stream}>
        <div className="scan-frame" aria-hidden="true" />
        <div className="camera__label">
          <Icon name="scan" size={16} />
          노트북 QR 스캔
        </div>
      </CameraView>
      <div className="panel panel--sheet">
        {camera.error ? (
          <p className="alert alert--error" role="alert">
            {camera.error}
          </p>
        ) : (
          <p className="hint" aria-live="polite">
            {busy ? '노트북 정보를 불러오는 중…' : hint}
          </p>
        )}
        {error && (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        )}
        {camera.error && (
          <button type="button" className="btn" onClick={() => void camera.start()}>
            카메라 다시 켜기
          </button>
        )}
        <Link to="/manual" className="btn btn--ghost">
          <Icon name="keyboard" size={18} />
          QR이 안 읽혀요 · 자산 번호로 찾기
        </Link>
      </div>
    </section>
  );
}

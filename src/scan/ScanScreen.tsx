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
import { SCAN_MODES, useScanMode } from './scanMode';
import { Icon } from '../shared/ui/Icon';

const RETRY_COOLDOWN_MS = 3000;

/**
 * 앱 첫 화면. 카메라를 켜 두고 자산 번호 라벨(QR 또는 바코드)이 보이는 즉시 읽어 다음 화면으로 넘어간다.
 * 사진을 찍거나 저장하지 않는다. 서버에는 읽은 값(=자산 번호)만 보낸다(GET /scan/{value}).
 * 처음 보는 자산 번호면 서버가 등록 화면으로 보낸다.
 */
export function ScanScreen({ decoderFactory }: { decoderFactory?: (k: BarcodeKind) => Promise<Decoder> }) {
  const { endpoints } = useServices();
  const camera = useCamera();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const reader = useRef(new StableReader());
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useScanMode();
  const [hint, setHint] = useState('노트북 상판의 자산 번호 라벨을 화면 안에 비춰 주세요.');
  const [error, setError] = useState<string | null>(null);
  // 조회에 실패한 라벨이 계속 화면에 있으면 같은 요청을 반복하지 않도록 잠시 무시한다.
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
          setError('폐기된 라벨입니다. 관리자에게 라벨을 다시 출력해 달라고 해 주세요.');
          setBusy(false);
          return;
        }
        goToScanResult(navigate, scan, 'qr', value);
      } catch (e) {
        cooldown.current = { value, until: Date.now() + RETRY_COOLDOWN_MS };
        if (e instanceof ApiError && e.resultCode === ResultCode.QR_NOT_ISSUED) {
          setError('자산 번호로 쓸 수 없는 값입니다. 노트북의 자산 번호 라벨을 비춰 주세요.');
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
        setHint('라벨이 여러 개 보입니다. 노트북 한 대의 자산 번호 라벨만 화면에 들어오게 해 주세요.');
      else if (out.kind === 'foreign')
        setHint('자산 번호 라벨이 아닙니다. 노트북의 자산 번호 라벨을 비춰 주세요.');
      else if (out.kind === 'pending') setHint('라벨을 읽는 중입니다. 잠시 그대로 있어 주세요.');
    },
    [lookUp],
  );

  useBarcodeScanner({
    videoRef,
    active: !!camera.stream && !busy,
    kind: mode,
    onFrame,
    decoderFactory,
  });

  return (
    <section className="screen screen--camera">
      <CameraView ref={videoRef} stream={camera.stream}>
        <div
          className={mode === 'barcode' ? 'scan-frame scan-frame--wide' : 'scan-frame'}
          aria-hidden="true"
        />
        <div className="camera__label">
          <Icon name="scan" size={16} />
          자산 번호 스캔
        </div>
      </CameraView>
      <div className="panel panel--sheet">
        <div className="tabs" role="tablist" aria-label="스캔 방식">
          {SCAN_MODES.map((m) => (
            <button
              key={m.kind}
              type="button"
              role="tab"
              aria-selected={mode === m.kind}
              onClick={() => {
                reader.current.reset();
                setMode(m.kind);
              }}
            >
              {m.kind !== 'auto' && <Icon name={m.kind === 'qr' ? 'qr' : 'barcode'} size={16} />}
              {m.label}
            </button>
          ))}
        </div>
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
            <Icon name="retry" size={18} />
            카메라 다시 켜기
          </button>
        )}
        <Link to="/manual" className="btn btn--ghost">
          <Icon name="keyboard" size={18} />
          라벨이 안 읽혀요 · 자산 번호로 찾기
        </Link>
      </div>
    </section>
  );
}

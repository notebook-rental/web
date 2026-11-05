import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ResultCode } from '../api/resultCodes';
import type { DeviceCreate, DeviceModel, ScanResult } from '../api/types';
import { useServices } from '../app/services';
import type { BarcodeKind, Decoder } from '../scan/qrDecoder';
import { goToScanResult, registerCaptureRequest } from '../scan/navigation';
import { isLabelValue, isSystemQr, normalizeQrValue } from '../scan/qrValue';
import { Icon } from '../shared/ui/Icon';
import { SerialScanner } from './SerialScanner';

/**
 * 처음 보는 라벨을 스캔하면 열리는 등록 화면(FR-047, spec 002). 라벨 값은 이미 채워져 있다.
 *
 * - 자산 번호 라벨(시스템이 발급한 번호든 원래 붙어 있던 번호든): 라벨 값이 곧 자산 번호라 모델만 고르면 끝난다.
 * - 예전 QR 스티커(NR1:…): 그 QR을 이 노트북에 묶고, 자산 번호는 직접 넣는다.
 * - 시리얼 번호는 선택 항목이라 접혀 있다. 수리·보증 접수처럼 필요할 때만 펼쳐 넣는다.
 */
export function RegisterPage({ decoderFactory }: { decoderFactory?: (k: BarcodeKind) => Promise<Decoder> }) {
  const [params] = useSearchParams();
  const value = normalizeQrValue(params.get('qr') ?? '');

  if (!isLabelValue(value)) {
    return (
      <section className="screen">
        <p className="alert alert--error" role="alert">
          등록할 라벨 값이 올바르지 않습니다. 스캔 화면에서 다시 스캔해 주세요.
        </p>
        <Link to="/" className="btn">
          스캔 화면으로
        </Link>
      </section>
    );
  }

  return (
    <section className="screen">
      <h1>새 노트북 등록</h1>
      <NewDeviceForm scanned={value} decoderFactory={decoderFactory} />
    </section>
  );
}

function registerError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.resultCode === ResultCode.QR_ALREADY_ASSIGNED) return '이미 다른 노트북에 등록된 라벨입니다.';
    if (e.resultCode === ResultCode.QR_VOID)
      return '폐기된 라벨입니다. 관리자에게 라벨을 다시 출력해 달라고 해 주세요.';
    if (e.resultCode === ResultCode.DUPLICATE_DEVICE) return '이미 등록된 자산 번호 또는 시리얼 번호입니다.';
    return e.message;
  }
  return '저장하지 못했습니다.';
}

function NewDeviceForm({
  scanned,
  decoderFactory,
}: {
  scanned: string;
  decoderFactory?: (k: BarcodeKind) => Promise<Decoder>;
}) {
  const { endpoints } = useServices();
  const navigate = useNavigate();
  const legacy = isSystemQr(scanned);
  const [models, setModels] = useState<DeviceModel[] | null>(null);
  const [modelId, setModelId] = useState('');
  const [assetNo, setAssetNo] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.listDeviceModels().then(
      (r) => {
        setModels(r.items);
        if (r.items.length === 1) setModelId(String(r.items[0].id));
      },
      (e: unknown) => setError(e instanceof Error ? e.message : '노트북 모델 목록을 불러오지 못했습니다.'),
    );
  }, [endpoints]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: DeviceCreate = { qrValue: scanned, deviceModelId: Number(modelId) };
      if (legacy) body.assetNo = assetNo.trim();
      if (serialNo.trim()) body.serialNo = serialNo.trim();
      await endpoints.createDevice(body);
      const scan: ScanResult = await endpoints.scan(scanned);
      goToScanResult(navigate, scan, 'qr', scanned, { replace: true });
      // 등록하면 바로 기준 사진 8컷을 찍는다(spec 002 US5). 뒤로 가면 노트북 화면이 나온다.
      const request = registerCaptureRequest(scan, 'qr', scanned);
      if (request) navigate('/capture', { state: request });
    } catch (err) {
      setError(registerError(err));
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      {legacy ? (
        <>
          <p className="qr-value">{scanned}</p>
          <p className="hint">예전 QR 스티커입니다. 이 노트북의 자산 번호를 넣어 주세요.</p>
          <label>
            자산 번호
            <input
              value={assetNo}
              onChange={(e) => setAssetNo(e.target.value)}
              required
              maxLength={30}
              autoCapitalize="characters"
            />
          </label>
        </>
      ) : (
        <div className="kv-block">
          <p className="eyebrow">자산 번호</p>
          <p className="qr-value" aria-label="자산 번호">
            {scanned}
          </p>
        </div>
      )}
      <label>
        노트북 모델
        <select value={modelId} onChange={(e) => setModelId(e.target.value)} required disabled={!models}>
          <option value="">{models ? '모델을 고르세요' : '불러오는 중…'}</option>
          {models?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.manufacturer} {m.name}
            </option>
          ))}
        </select>
      </label>
      <details className="optional">
        <summary>시리얼 번호 (선택)</summary>
        <p className="hint">수리·보증 접수처럼 제조사 번호가 필요할 때만 넣으세요. 비워 둬도 됩니다.</p>
        <label>
          시리얼 번호
          <span className="input-row">
            <input
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
              maxLength={50}
              autoCapitalize="characters"
            />
            <button type="button" className="btn btn--ghost" onClick={() => setScanning(true)}>
              <Icon name="scan" size={18} />
              바코드로 읽기
            </button>
          </span>
        </label>
      </details>
      {scanning && (
        <SerialScanner
          decoderFactory={decoderFactory}
          onRead={(v) => {
            setSerialNo(v);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn--primary btn--big" disabled={busy}>
        <Icon name="check" size={20} />
        {busy ? '저장 중…' : '등록'}
      </button>
    </form>
  );
}

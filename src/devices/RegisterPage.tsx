import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ResultCode } from '../api/resultCodes';
import type { DeviceModel, ScanResult } from '../api/types';
import { useServices } from '../app/services';
import type { BarcodeKind, Decoder } from '../scan/qrDecoder';
import { goToScanResult } from '../scan/navigation';
import { isSystemQr } from '../scan/qrValue';
import { Icon } from '../shared/ui/Icon';
import { SerialScanner } from './SerialScanner';

/**
 * 미등록 QR을 스캔하면 열리는 화면(FR-047). QR 값은 이미 채워져 있다.
 * - 신규 등록: 모델을 고르고 자산 번호·시리얼을 넣어 저장 → 이 QR이 새 노트북에 묶인다.
 * - 기존 노트북에 다시 붙이기(관리자, FR-048): QR이 훼손된 노트북에 새 QR을 붙였을 때. 옛 QR은 폐기된다.
 */
export function RegisterPage({ decoderFactory }: { decoderFactory?: (k: BarcodeKind) => Promise<Decoder> }) {
  const [params] = useSearchParams();
  const qrValue = params.get('qr') ?? '';
  const { hasRole } = useServices();
  const [mode, setMode] = useState<'new' | 'reattach'>('new');

  if (!isSystemQr(qrValue)) {
    return (
      <section className="screen">
        <p className="alert alert--error" role="alert">
          등록할 QR 값이 올바르지 않습니다. 스캔 화면에서 다시 스캔해 주세요.
        </p>
        <Link to="/" className="btn">
          스캔 화면으로
        </Link>
      </section>
    );
  }

  return (
    <section className="screen">
      <h1>새 QR 등록</h1>
      <p className="qr-value">{qrValue}</p>
      {hasRole('admin') && (
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'new'} onClick={() => setMode('new')}>
            신규 노트북
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'reattach'}
            onClick={() => setMode('reattach')}
          >
            기존 노트북에 다시 붙이기
          </button>
        </div>
      )}
      {mode === 'new' ? (
        <NewDeviceForm qrValue={qrValue} decoderFactory={decoderFactory} />
      ) : (
        <ReattachForm qrValue={qrValue} />
      )}
    </section>
  );
}

function registerError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.resultCode === ResultCode.QR_ALREADY_ASSIGNED) return '이미 다른 노트북에 등록된 QR입니다.';
    if (e.resultCode === ResultCode.QR_VOID) return '폐기된 QR입니다. 새 QR을 붙여 주세요.';
    return e.message;
  }
  return '저장하지 못했습니다.';
}

function NewDeviceForm({
  qrValue,
  decoderFactory,
}: {
  qrValue: string;
  decoderFactory?: (k: BarcodeKind) => Promise<Decoder>;
}) {
  const { endpoints } = useServices();
  const navigate = useNavigate();
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
      await endpoints.createDevice({
        qrValue,
        deviceModelId: Number(modelId),
        assetNo: assetNo.trim(),
        serialNo: serialNo.trim(),
      });
      const scan: ScanResult = await endpoints.scan(qrValue);
      goToScanResult(navigate, scan, 'qr', qrValue);
    } catch (err) {
      setError(registerError(err));
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
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
      <label>
        자산 번호
        <input
          value={assetNo}
          onChange={(e) => setAssetNo(e.target.value)}
          required
          autoCapitalize="characters"
        />
      </label>
      <label>
        시리얼 번호
        <span className="input-row">
          <input
            value={serialNo}
            onChange={(e) => setSerialNo(e.target.value)}
            required
            autoCapitalize="characters"
          />
          <button type="button" className="btn btn--ghost" onClick={() => setScanning(true)}>
            <Icon name="scan" size={18} />
            바코드로 읽기
          </button>
        </span>
      </label>
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

function ReattachForm({ qrValue }: { qrValue: string }) {
  const { endpoints } = useServices();
  const navigate = useNavigate();
  const [assetNo, setAssetNo] = useState('');
  const [found, setFound] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function find(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFound(null);
    try {
      setFound(await endpoints.findByAsset(assetNo.trim()));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? '그 자산 번호의 노트북이 없습니다.'
          : registerError(err),
      );
    }
  }

  async function reattach() {
    if (!found?.device) return;
    setBusy(true);
    setError(null);
    try {
      await endpoints.replaceQr(found.device.id, qrValue);
      goToScanResult(navigate, await endpoints.scan(qrValue), 'qr', qrValue);
    } catch (err) {
      setError(registerError(err));
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <form onSubmit={find} className="form">
        <label>
          QR을 바꿀 노트북의 자산 번호
          <input value={assetNo} onChange={(e) => setAssetNo(e.target.value)} required />
        </label>
        <button className="btn">
          <Icon name="search" size={18} />
          찾기
        </button>
      </form>
      {found?.device && (
        <div className="confirm">
          <p>
            <strong>{found.device.assetNo}</strong> (시리얼 {found.device.serialNo})의 QR을 바꿉니다. 지금
            붙어 있는 QR {found.device.qrValue}은 폐기되고 교체 이력이 남습니다.
          </p>
          <button type="button" className="btn btn--primary" onClick={reattach} disabled={busy}>
            이 노트북에 새 QR 붙이기
          </button>
        </div>
      )}
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

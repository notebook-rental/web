import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { ScanResult } from '../api/types';
import { useServices } from '../app/services';
import type { CaptureRequest } from '../capture/CaptureScreen';
import { DAMAGE_TYPE_TEXT, SEVERITY_TEXT, shotGuide } from '../capture/shots';
import type { DevicePageState } from '../scan/navigation';
import { STATUS_TEXT } from './labels';
import { Icon } from '../shared/ui/Icon';
import { downloadBlob } from '../shared/downloadBlob';
import { LabelFormatPicker } from './LabelFormatPicker';
import { useLabelFormat } from './labelFormat';

/**
 * 노트북 화면(FR-007). 스캔 결과 하나로 상태, 진행할 일, 기존 손상을 보여 주고
 * "대여 촬영 시작"/"반납 촬영 시작"을 누르면 바로 촬영 화면으로 넘어간다(검사 생성은 촬영 화면이 동시에 한다).
 */
export function DevicePage() {
  const location = useLocation();
  const state = location.state as DevicePageState | null;
  if (!state?.scan?.device) return <Navigate to="/" replace />;
  return <DeviceView initial={state} />;
}

function DeviceView({ initial }: { initial: DevicePageState }) {
  const { endpoints, hasRole } = useServices();
  const navigate = useNavigate();
  const [scan, setScan] = useState<ScanResult>(initial.scan);
  const device = scan.device!;

  function startCapture() {
    if (!scan.rentalId || (scan.nextAction !== 'checkout' && scan.nextAction !== 'checkin')) return;
    const request: CaptureRequest = {
      kind: scan.nextAction,
      rentalId: scan.rentalId,
      identifiedBy: initial.identifiedBy,
      scannedQrValue: initial.scannedQrValue,
      inspectionId: scan.inspectionId,
      requiredShots: scan.requiredShots,
      deviceLabel: device.assetNo,
    };
    navigate('/capture', { state: request });
  }

  async function reload() {
    const fresh = initial.scannedQrValue
      ? await endpoints.scan(initial.scannedQrValue)
      : await endpoints.findByAsset(device.assetNo);
    setScan(fresh);
  }

  const damages = scan.existingDamages ?? [];
  const startLabel = scan.nextAction === 'checkout' ? '대여 촬영 시작' : '반납 촬영 시작';

  return (
    <section className="screen">
      <div className="card device-card">
        <header className="device-head">
          <span className="device-head__icon" aria-hidden="true">
            <Icon name="laptop" size={26} />
          </span>
          <div>
            {device.model && (
              <p className="eyebrow">
                {device.model.manufacturer} {device.model.name}
              </p>
            )}
            <h1>{device.assetNo}</h1>
          </div>
          <span className={`status status--${device.status}`}>
            {STATUS_TEXT[device.status] ?? device.status}
          </span>
        </header>
        <dl className="kv">
          <dt>시리얼</dt>
          <dd>{device.serialNo || <span className="muted">없음</span>}</dd>
          {device.qrValue && device.qrValue !== device.assetNo && (
            <>
              <dt>예전 QR</dt>
              <dd className="mono">{device.qrValue}</dd>
            </>
          )}
          <dt>식별</dt>
          <dd>{initial.identifiedBy === 'qr' ? '라벨 스캔' : '자산 번호 직접 입력'}</dd>
        </dl>
        {hasRole('admin') && <ReprintLabel deviceId={device.id} assetNo={device.assetNo} />}
      </div>

      {(scan.nextAction === 'checkout' || scan.nextAction === 'checkin') && (
        <button type="button" className="btn btn--primary btn--big" onClick={startCapture}>
          <Icon name="camera" size={22} />
          {scan.inspectionId ? `${startLabel.replace(' 시작', '')} 이어서 하기` : startLabel}
        </button>
      )}
      {scan.nextAction === 'none' && (
        <>
          <p className="callout">지금 이 노트북에 진행할 대여·반납이 없습니다.</p>
          {device.status === 'available' && <CreateRental deviceId={device.id} onCreated={reload} />}
        </>
      )}

      <h2 className="section-title">기존 손상 {damages.length}건</h2>
      {damages.length === 0 ? (
        <p className="hint">확정된 손상이 없습니다.</p>
      ) : (
        <ul className="damage-list">
          {damages.map((d) => (
            <li key={d.id}>
              {d.afterPhotoUrl && <img src={d.afterPhotoUrl} alt="" loading="lazy" />}
              <span>
                {shotGuide(d.shotType).name} · {DAMAGE_TYPE_TEXT[d.damageType] ?? d.damageType} ·{' '}
                {SEVERITY_TEXT[d.severity] ?? d.severity}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/" className="btn btn--ghost">
        <Icon name="scan" size={18} />
        다른 노트북 스캔
      </Link>
    </section>
  );
}

/** 대여 대기 건 만들기. 실제 대여 접수는 다른 시스템이 할 수 있지만, 매장에서 바로 만들 수 있게 둔다. */
function CreateRental({ deviceId, onCreated }: { deviceId: number; onCreated(): Promise<void> }) {
  const { endpoints } = useServices();
  const [customerRef, setCustomerRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await endpoints.createRental(deviceId, customerRef.trim());
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '대여 건을 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>
        고객 참조 번호(대여 계약 번호 등)
        <input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} required />
      </label>
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
      <button className="btn" disabled={busy}>
        대여 대기 건 만들기
      </button>
    </form>
  );
}

/** 관리자: 라벨이 상했을 때 같은 자산 번호로 라벨을 다시 출력한다(예전 "QR 교체"를 대신한다). */
function ReprintLabel({ deviceId, assetNo }: { deviceId: number; assetNo: string }) {
  const { endpoints } = useServices();
  const [format, setFormat] = useLabelFormat();
  const [error, setError] = useState<string | null>(null);

  async function print() {
    setError(null);
    try {
      downloadBlob(await endpoints.deviceLabelPdf(deviceId, format), `label-${assetNo}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '라벨을 받지 못했습니다.');
    }
  }

  return (
    <div className="form">
      <LabelFormatPicker value={format} onChange={setFormat} />
      <button type="button" className="btn" onClick={() => void print()}>
        <Icon name="printer" size={18} />
        라벨 다시 출력
      </button>
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

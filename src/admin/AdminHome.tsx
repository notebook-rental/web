import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ResultCode } from '../api/resultCodes';
import { useServices } from '../app/services';
import { goToScanResult } from '../scan/navigation';
import { isSystemQr, normalizeQrValue } from '../scan/qrValue';
import { Icon, type IconName } from '../shared/ui/Icon';

type Counts = { devices: number | null; models: number | null; batches: number | null };

/**
 * 관리 홈. 새 노트북 등록 순서를 안내하고, 각 관리 화면으로 가는 입구와 간단한 숫자를 보여 준다.
 * 숫자를 못 불러와도(아직 서버에 없는 목록 API 등) 화면은 그대로 쓸 수 있다.
 */
export function AdminHome() {
  const { endpoints } = useServices();
  const [counts, setCounts] = useState<Counts>({ devices: null, models: null, batches: null });

  useEffect(() => {
    let alive = true;
    const settle = (key: keyof Counts, p: Promise<{ totalCount: number }>) =>
      p.then(
        (r) => alive && setCounts((c) => ({ ...c, [key]: r.totalCount })),
        () => undefined,
      );
    void settle('devices', endpoints.listDevices({ size: 1 }));
    void settle('models', endpoints.listDeviceModels());
    void settle('batches', endpoints.listQrBatches(0, 1));
    return () => {
      alive = false;
    };
  }, [endpoints]);

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>관리 홈</h1>
        </div>
      </header>

      <div className="tiles">
        <Tile to="/admin/devices" icon="laptop" label="등록된 노트북" value={counts.devices} unit="대" />
        <Tile to="/admin/models" icon="layers" label="노트북 모델" value={counts.models} unit="종" />
        <Tile to="/admin/qr" icon="qr" label="QR 스티커 묶음" value={counts.batches} unit="묶음" />
      </div>

      <RegisterGuide />
    </section>
  );
}

function Tile(props: { to: string; icon: IconName; label: string; value: number | null; unit: string }) {
  return (
    <Link to={props.to} className="tile">
      <span className="tile__icon">
        <Icon name={props.icon} />
      </span>
      <span className="tile__label">{props.label}</span>
      <strong className="tile__value">
        {props.value ?? '–'}
        {props.value !== null && <small>{props.unit}</small>}
      </strong>
    </Link>
  );
}

/** 새 노트북 등록 안내(FR-046, FR-047). 스캔이 안 되는 PC에서는 QR 값을 직접 넣어 시작할 수 있다. */
function RegisterGuide() {
  const { endpoints } = useServices();
  const navigate = useNavigate();
  const [qr, setQr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = normalizeQrValue(qr);
    if (!isSystemQr(value)) {
      setError('QR 값 형식이 올바르지 않습니다. 예: NR1:7K3M9QX2TD');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scan = await endpoints.scan(value);
      if (scan.nextAction === 'blocked') {
        setError('폐기된 QR입니다. 새 QR을 붙여 주세요.');
        setBusy(false);
        return;
      }
      // 손으로 넣은 값이라 QR 스캔으로 기록하지 않는다(FR-008). 미등록 QR이면 등록 화면으로 간다.
      if (scan.nextAction === 'register')
        navigate(`/register?qr=${encodeURIComponent(scan.qrValue ?? value)}`);
      else goToScanResult(navigate, scan, 'manual');
    } catch (err) {
      setError(
        err instanceof ApiError && err.resultCode === ResultCode.QR_NOT_ISSUED
          ? '이 시스템에서 발급한 QR이 아닙니다.'
          : err instanceof Error
            ? err.message
            : '조회하지 못했습니다.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card__title">새 노트북 등록</h2>
      <ol className="steps">
        <li>
          <strong>QR 스티커 출력</strong>
          <span>
            <Link to="/admin/qr">QR 스티커</Link> 화면에서 빈 QR을 발급하고 PDF로 인쇄합니다.
          </span>
        </li>
        <li>
          <strong>노트북에 붙이고 스캔</strong>
          <span>상판에 스티커를 붙이고 휴대폰으로 스캔하면 등록 화면이 열립니다.</span>
        </li>
        <li>
          <strong>모델·자산 번호 입력</strong>
          <span>모델을 고르고 자산 번호와 시리얼을 넣어 저장합니다.</span>
        </li>
        <li>
          <strong>기준 사진 8컷 촬영</strong>
          <span>대여할 때 찍는 사진이 이후 반납 비교의 기준이 됩니다.</span>
        </li>
      </ol>
      <div className="actions">
        <Link to="/" className="btn btn--primary">
          <Icon name="scan" size={18} />
          QR 스캔으로 등록
        </Link>
      </div>
      <form className="form form--inline" onSubmit={submit}>
        <label>
          카메라가 없으면 QR 값을 직접 입력
          <input
            value={qr}
            onChange={(e) => setQr(e.target.value)}
            placeholder="NR1:7K3M9QX2TD"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <button className="btn" disabled={busy || !qr.trim()}>
          {busy ? '확인 중…' : '등록 시작'}
        </button>
      </form>
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

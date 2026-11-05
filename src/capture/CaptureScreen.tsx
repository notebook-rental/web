import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { ResultCode } from '../api/resultCodes';
import { subscribeInspectionEvents } from '../api/sse';
import type { Inspection, InspectionKind, InspectionStatus } from '../api/types';
import { useServices } from '../app/services';
import { useCamera } from '../camera/CameraProvider';
import { CameraView } from '../camera/CameraView';
import { captureStill as defaultCaptureStill } from '../camera/frame';
import { createDecoder, type BarcodeKind, type Decoder } from '../scan/qrDecoder';
import { isLabelValue, isSystemQr, normalizeQrValue } from '../scan/qrValue';
import {
  COMPARISON_TEXT,
  allDone,
  captureReducer,
  initialCaptureState,
  type ShotState,
} from './captureState';
import { createShotProcessor, type ProcessedShot } from './shotProcessor';
import { DEFAULT_SHOTS, reasonText, shotGuide } from './shots';
import { Icon } from '../shared/ui/Icon';
import { ShotDiagram } from '../shared/ui/Illustrations';
import { useUploadQueue } from './UploadQueueProvider';

/** 노트북 화면에서 촬영 화면으로 넘기는 정보 */
export interface CaptureRequest {
  kind: InspectionKind;
  /** 대여·반납 검사 */
  rentalId?: number;
  /** 등록 기준 촬영(kind=register) */
  deviceId?: number;
  identifiedBy: 'qr' | 'manual';
  scannedQrValue?: string;
  inspectionId?: number;
  requiredShots?: string[];
  deviceLabel?: string;
}

export interface CaptureDeps {
  processShot?: (b: Blob) => Promise<ProcessedShot>;
  decoderFactory?: (k: BarcodeKind) => Promise<Decoder>;
  captureStill?: (video: HTMLVideoElement, stream: MediaStream | null) => Promise<Blob>;
}

const KIND_TITLE: Record<InspectionKind, string> = {
  checkout: '대여 촬영',
  checkin: '반납 촬영',
  register: '기준 사진 촬영',
};

type Phase = 'capturing' | 'submitting' | 'analyzing' | 'reviewing' | 'done';

const TOP_SHOT = 'top';

export function CaptureScreen({ deps = {} }: { deps?: CaptureDeps }) {
  const location = useLocation();
  const request = location.state as CaptureRequest | null;
  if (!request || (request.kind === 'register' ? !request.deviceId : !request.rentalId)) {
    return <Navigate to="/" replace />;
  }
  return <CaptureFlow request={request} deps={deps} />;
}

function CaptureFlow({ request, deps }: { request: CaptureRequest; deps: CaptureDeps }) {
  const { endpoints, api } = useServices();
  const camera = useCamera();
  const { queue, snapshot } = useUploadQueue();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const shotCodes = request.requiredShots?.length ? request.requiredShots : DEFAULT_SHOTS;
  const [state, dispatch] = useReducer(captureReducer, shotCodes, initialCaptureState);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('capturing');
  const [held, setHeld] = useState<{ code: string; original: Blob; processed: ProcessedShot } | null>(null);
  const isCheckin = request.kind === 'checkin';

  const processShot = useMemo(() => deps.processShot ?? createShotProcessor(), [deps.processShot]);
  useEffect(() => () => (processShot as { dispose?: () => void }).dispose?.(), [processShot]);
  const decoderRef = useRef<Promise<Decoder> | null>(null);
  useEffect(
    () => () => {
      void decoderRef.current?.then((d) => d.dispose());
    },
    [],
  );

  const applyInspection = useCallback((i: Inspection) => {
    setInspection(i);
    if (i.capturedShots?.length) dispatch({ type: 'alreadyCaptured', codes: i.capturedShots });
    applyStatus(i.status);
  }, []);

  function applyStatus(status: InspectionStatus) {
    if (status === 'reviewing') setPhase('reviewing');
    else if (status === 'completed') setPhase('done');
    else if (status === 'analyzing') setPhase('analyzing');
  }

  // 1) 카메라 켜기 + 검사 만들기(또는 이어서 찍기)를 동시에 시작한다.
  useEffect(() => {
    void camera.start();
    let cancelled = false;
    const load = request.inspectionId
      ? endpoints.getInspection(request.inspectionId)
      : endpoints.createInspection({
          ...(request.kind === 'register' ? { deviceId: request.deviceId } : { rentalId: request.rentalId }),
          kind: request.kind,
          identifiedBy: request.identifiedBy,
          scannedQrValue: request.scannedQrValue,
        });
    load
      .then((i) => {
        if (cancelled) return;
        applyInspection(i);
        // 새로 고침해도 검사를 또 만들지 않도록, 만든 검사 id를 이 화면의 기록(history state)에 남긴다.
        if (!request.inspectionId) {
          navigate('.', {
            replace: true,
            state: { ...request, inspectionId: i.id } satisfies CaptureRequest,
          });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFatal(
          e instanceof ApiError && e.resultCode === ResultCode.DEVICE_RENTAL_MISMATCH
            ? '스캔한 노트북이 대여 기록의 노트북과 다릅니다. 노트북을 확인해 주세요.'
            : e instanceof Error
              ? e.message
              : '검사를 시작하지 못했습니다.',
        );
      });
    return () => {
      cancelled = true;
    };
    // 화면에 들어올 때 한 번만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 반납이면 컷별 비교 결과를 SSE로 받는다.
  const inspectionId = inspection?.id;
  useEffect(() => {
    if (!isCheckin || !inspectionId) return;
    return subscribeInspectionEvents(api, inspectionId, {
      onComparison: (event) => dispatch({ type: 'comparison', event }),
      onInspection: (event) => applyStatus(event.status),
      onReconnect: () => {
        endpoints.getInspection(inspectionId).then(applyInspection, () => undefined);
      },
    });
  }, [api, endpoints, inspectionId, isCheckin, applyInspection]);

  const current: ShotState | undefined = state.shots.find((s) => s.code === state.selected);

  async function readQr(blob: Blob): Promise<string[]> {
    decoderRef.current ??= (deps.decoderFactory ?? createDecoder)('auto');
    try {
      const values = await (await decoderRef.current).decode(blob);
      return [...new Set(values.map(normalizeQrValue).filter(isLabelValue))];
    } catch {
      return [];
    }
  }

  async function upload(code: string, original: Blob, processed: ProcessedShot) {
    if (!inspection) return;
    dispatch({ type: 'processing', code });
    let decodedQrValues: string[] | undefined;
    if (code === TOP_SHOT) {
      // 상판 컷: 폰에서 먼저 라벨(QR·바코드)을 읽어 서버에 함께 보낸다(FR-045).
      // 자산 번호 라벨은 사진 속 다른 바코드(제조사 바코드 등)와 폰에서 구별할 수 없어서, 우리 라벨인지는 서버가
      // 등록된 번호로 판단한다. 폰은 예전 NR1: QR 스티커끼리만 미리 비교한다.
      decodedQrValues = await readQr(processed.working);
      const legacy = decodedQrValues.filter(isSystemQr);
      if (legacy.length > 1) {
        dispatch({ type: 'rejected', code, reasons: ['multiple_qr'] });
        return;
      }
      const scanned = request.scannedQrValue && normalizeQrValue(request.scannedQrValue);
      if (scanned && isSystemQr(scanned) && legacy.length === 1 && legacy[0] !== scanned) {
        dispatch({
          type: 'rejected',
          code,
          message: '다른 노트북의 라벨입니다. 처음 스캔한 노트북이 맞는지 확인해 주세요.',
        });
        return;
      }
    }
    try {
      const photo = await endpoints.uploadPhoto(inspection.id, {
        shotType: code,
        image: processed.working,
        originalSha256: processed.originalSha256,
        decodedQrValues,
      });
      if (photo.originalUploadUrl) {
        await queue.enqueue({
          inspectionId: inspection.id,
          photoId: photo.id,
          shotType: code,
          uploadUrl: photo.originalUploadUrl,
          blob: original,
        });
      }
      dispatch({ type: 'uploaded', code, photoId: photo.id });
    } catch (e) {
      if (e instanceof ApiError && e.resultCode === ResultCode.QUALITY_REJECTED) {
        const reasons = (e.result as { reasons?: string[] } | null)?.reasons ?? [];
        dispatch({ type: 'rejected', code, reasons, message: reasons.length ? undefined : e.message });
      } else if (e instanceof ApiError && e.resultCode === ResultCode.TOP_SHOT_QR_MISMATCH) {
        dispatch({
          type: 'rejected',
          code,
          message: '다른 노트북의 라벨입니다. 이 컷은 저장하지 않았습니다.',
        });
      } else if (e instanceof ApiError && e.resultCode === ResultCode.MULTIPLE_QR) {
        dispatch({ type: 'rejected', code, reasons: ['multiple_qr'] });
      } else {
        dispatch({
          type: 'rejected',
          code,
          message: e instanceof Error ? e.message : '업로드에 실패했습니다.',
        });
      }
    }
  }

  async function shoot() {
    const video = videoRef.current;
    if (!current || !video || !inspection) return;
    const code = current.code;
    setHeld(null);
    dispatch({ type: 'processing', code });
    try {
      const original = await (deps.captureStill ?? defaultCaptureStill)(video, camera.stream);
      const processed = await processShot(original);
      if (processed.reasons.length > 0) {
        // 폰의 1차 검사에서 걸렸다. 다시 찍게 하되, 판단이 애매하면 서버에 맡길 수 있게 남겨 둔다.
        setHeld({ code, original, processed });
        dispatch({ type: 'rejected', code, reasons: processed.reasons });
        return;
      }
      await upload(code, original, processed);
    } catch (e) {
      dispatch({ type: 'rejected', code, message: e instanceof Error ? e.message : '촬영에 실패했습니다.' });
    }
  }

  async function submit() {
    if (!inspection) return;
    setPhase('submitting');
    setNotice(null);
    try {
      await endpoints.submitInspection(inspection.id);
      setPhase(isCheckin ? 'analyzing' : 'done');
      if (isCheckin) endpoints.getInspection(inspection.id).then(applyInspection, () => undefined);
    } catch (e) {
      setPhase('capturing');
      if (e instanceof ApiError && e.resultCode === ResultCode.MISSING_SHOTS) {
        const missing = (e.result as { missingShots?: string[] } | null)?.missingShots ?? [];
        dispatch({ type: 'missing', codes: missing });
        setNotice(`빠진 컷이 있어요: ${missing.map((m) => shotGuide(m).name).join(', ')}`);
      } else {
        setNotice(e instanceof Error ? e.message : '제출하지 못했습니다.');
      }
    }
  }

  const pendingOriginals = inspection ? snapshot.items.filter((i) => i.inspectionId === inspection.id) : [];

  if (fatal) {
    return (
      <section className="screen">
        <p className="alert alert--error" role="alert">
          {fatal}
        </p>
        <Link to="/" className="btn">
          스캔 화면으로
        </Link>
      </section>
    );
  }

  if (phase !== 'capturing' && phase !== 'submitting') {
    return (
      <SubmittedView
        kind={request.kind}
        phase={phase}
        shots={state.shots}
        pendingOriginals={pendingOriginals.length}
        failedOriginals={pendingOriginals.filter((i) => i.failed).length}
        onRetryOriginals={() => void queue.retryFailed()}
        onReview={() => inspection && navigate(`/review/${inspection.id}`)}
      />
    );
  }

  const guide = current ? shotGuide(current.code) : null;
  const doneCount = state.shots.filter((s) => s.status === 'done').length;

  return (
    <section className="screen screen--camera">
      <CameraView ref={videoRef} stream={camera.stream}>
        <div className={`shot-overlay shot-overlay--${current?.code ?? 'none'}`} aria-hidden="true" />
        <div className="shot-title">
          <span>
            {KIND_TITLE[request.kind]} · {doneCount}/{state.shots.length}
            {request.deviceLabel ? ` · ${request.deviceLabel}` : ''}
          </span>
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${(doneCount / Math.max(1, state.shots.length)) * 100}%` }} />
          </span>
        </div>
      </CameraView>
      <div className="panel panel--sheet">
        {camera.error && (
          <p className="alert alert--error" role="alert">
            {camera.error}
          </p>
        )}
        {guide && (
          <div className="guide">
            <ShotDiagram code={guide.code} />
            <strong>{guide.name}</strong>
            {guide.open && <span className="badge">노트북 열기</span>}
            <p>{guide.guide}</p>
          </div>
        )}
        {current?.status === 'rejected' && (
          <div className="alert alert--warn" role="alert">
            {current.reasons?.map((r) => (
              <p key={r}>{reasonText(r)}</p>
            ))}
            {current.message && <p>{current.message}</p>}
            {held?.code === current.code && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  const h = held;
                  setHeld(null);
                  void upload(h.code, h.original, h.processed);
                }}
              >
                그래도 올리기(서버가 다시 판단)
              </button>
            )}
          </div>
        )}
        <ol className="shot-strip" aria-label="촬영 컷">
          {state.shots.map((s) => (
            <li key={s.code}>
              <button
                type="button"
                className={`shot-chip shot-chip--${s.status}${s.code === state.selected ? ' is-selected' : ''}`}
                aria-current={s.code === state.selected ? 'step' : undefined}
                onClick={() => dispatch({ type: 'select', code: s.code })}
              >
                <span>{shotGuide(s.code).name}</span>
                <small>{chipText(s, isCheckin)}</small>
              </button>
            </li>
          ))}
        </ol>
        {notice && (
          <p className="alert alert--error" role="alert">
            {notice}
          </p>
        )}
        <div className="actions">
          {allDone(state) ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={submit}
              disabled={phase === 'submitting'}
            >
              <Icon name="upload" size={20} />
              {phase === 'submitting' ? '제출 중…' : '촬영 제출'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--shutter"
              onClick={shoot}
              disabled={!inspection || !camera.stream || current?.status === 'processing'}
              aria-label={`${guide?.name ?? ''} 촬영하기`}
            >
              {current?.status === 'processing' ? '처리 중…' : '찍기'}
            </button>
          )}
        </div>
        {pendingOriginals.length > 0 && (
          <p className="hint">
            원본 {pendingOriginals.length}장을 뒤에서 올리는 중입니다. 앱을 닫아도 다음에 이어서 올립니다.
          </p>
        )}
      </div>
    </section>
  );
}

function chipText(s: ShotState, isCheckin: boolean): string {
  if (s.status === 'processing') return '처리 중';
  if (s.status === 'rejected') return '다시 찍기';
  if (s.status === 'todo') return '대기';
  if (!isCheckin) return '저장됨';
  if (!s.comparison) return '저장됨';
  if (s.comparison === 'done') return s.findingCount ? `후보 ${s.findingCount}` : '변화 없음';
  return COMPARISON_TEXT[s.comparison];
}

function SubmittedView(props: {
  kind: InspectionKind;
  phase: Phase;
  shots: ShotState[];
  pendingOriginals: number;
  failedOriginals: number;
  onRetryOriginals(): void;
  onReview(): void;
}) {
  const { kind, phase, shots, pendingOriginals, failedOriginals } = props;
  const total = shots.reduce((n, s) => n + (s.findingCount ?? 0), 0);
  return (
    <section className="screen">
      {kind === 'register' ? (
        <>
          <div className="done-mark" aria-hidden="true">
            <Icon name="check" size={36} />
          </div>
          <h1>기준 사진 촬영 완료</h1>
          <p className="muted">
            등록할 때의 상태를 8컷으로 남겼습니다. 대여할 때는 대여 촬영을 한 번 더 합니다.
          </p>
        </>
      ) : kind === 'checkout' ? (
        <>
          <div className="done-mark" aria-hidden="true">
            <Icon name="check" size={36} />
          </div>
          <h1>대여 촬영 완료</h1>
          <p className="muted">기준 사진을 저장했습니다. 노트북을 고객에게 내보내도 됩니다.</p>
        </>
      ) : (
        <>
          <h1>{phase === 'analyzing' ? '비교 중…' : '비교 완료'}</h1>
          <ul className="result-list card">
            {shots.map((s) => (
              <li key={s.code}>
                <span>{shotGuide(s.code).name}</span>
                <span>{chipText(s, true)}</span>
              </li>
            ))}
          </ul>
          {phase === 'analyzing' ? (
            <p className="hint" aria-live="polite">
              남은 컷의 비교가 끝나면 바로 검토를 시작할 수 있어요.
            </p>
          ) : (
            <>
              <p>
                {total > 0
                  ? `손상 후보 ${total}건을 찾았어요.`
                  : '변화가 없어 보여요. 확인 후 완료해 주세요.'}
              </p>
              <button type="button" className="btn btn--primary btn--big" onClick={props.onReview}>
                검토 시작
                <Icon name="arrow" size={20} />
              </button>
            </>
          )}
        </>
      )}
      {pendingOriginals > 0 && (
        <p className="hint">
          원본 {pendingOriginals}장 업로드 남음{failedOriginals > 0 ? ` (실패 ${failedOriginals})` : ''}.
          업로드가 끝나야 검사를 완료할 수 있습니다.
          {failedOriginals > 0 && (
            <button type="button" className="btn btn--ghost" onClick={props.onRetryOriginals}>
              <Icon name="retry" size={18} />
              다시 시도
            </button>
          )}
        </p>
      )}
      <Link to="/" className="btn btn--ghost">
        <Icon name="scan" size={18} />
        다음 노트북 스캔
      </Link>
    </section>
  );
}

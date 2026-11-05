import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_CODE } from '../api/client';
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
import { PhotoGallery } from './PhotoGallery';

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
  /** 끝난 등록 기준 촬영을 다시 열어 다시 찍는다(필요한 컷만 골라 다시 찍는다) */
  retake?: boolean;
}

export interface CaptureDeps {
  processShot?: (b: Blob) => Promise<ProcessedShot>;
  decoderFactory?: (k: BarcodeKind) => Promise<Decoder>;
  captureStill?: (video: HTMLVideoElement, stream: MediaStream | null) => Promise<Blob>;
  /** 인터넷 오류일 때 자동으로 다시 올리기 전에 기다리는 시간(ms). 기본 [1500, 4000, 8000] */
  retryDelays?: number[];
}

const DEFAULT_RETRY_DELAYS = [1500, 4000, 8000];
/** 제출할 때 남은 원본을 다시 올려 보는 횟수(한 번마다 큐가 여러 번 다시 시도한다) */
const FLUSH_ROUNDS = 3;

const KIND_TITLE: Record<InspectionKind, string> = {
  checkout: '대여 촬영',
  checkin: '반납 촬영',
  register: '기준 사진 촬영',
};

type Phase = 'capturing' | 'uploadingOriginals' | 'submitting' | 'analyzing' | 'reviewing' | 'done';

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
  const [flash, setFlash] = useState(0);
  const isCheckin = request.kind === 'checkin';

  const processShot = useMemo(() => deps.processShot ?? createShotProcessor(), [deps.processShot]);
  useEffect(() => () => (processShot as { dispose?: () => void }).dispose?.(), [processShot]);
  const decoderRef = useRef<Promise<Decoder> | null>(null);
  // 업로드는 한 번에 한 장씩 뒤에서 올린다(아이폰에서 여러 장을 한꺼번에 보내면 끊기기 쉽다).
  const uploadChain = useRef<Promise<void>>(Promise.resolve());
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
          ...(request.retake ? { retake: true } : {}),
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

  async function upload(code: string, original: Blob, processed: ProcessedShot, background = false) {
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
        dispatch({ type: 'rejected', background, code, reasons: ['multiple_qr'] });
        return;
      }
      const scanned = request.scannedQrValue && normalizeQrValue(request.scannedQrValue);
      if (scanned && isSystemQr(scanned) && legacy.length === 1 && legacy[0] !== scanned) {
        dispatch({
          type: 'rejected',
          background,
          code,
          message: '다른 노트북의 라벨입니다. 처음 스캔한 노트북이 맞는지 확인해 주세요.',
        });
        return;
      }
    }
    const delays = deps.retryDelays ?? DEFAULT_RETRY_DELAYS;
    const started = Date.now();
    try {
      let photo: Awaited<ReturnType<typeof endpoints.uploadPhoto>>;
      for (let attempt = 0; ; attempt++) {
        try {
          photo = await endpoints.uploadPhoto(inspection.id, {
            shotType: code,
            image: processed.working,
            originalSha256: processed.originalSha256,
            decodedQrValues,
          });
          break;
        } catch (e) {
          // 인터넷 오류면 잠깐 기다렸다 저절로 다시 올린다. 그동안 다음 컷을 계속 찍을 수 있다.
          if (!isNetworkFailure(e) || attempt >= delays.length) throw e;
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
      if (photo.originalUploadUrl) {
        try {
          await queue.enqueue({
            inspectionId: inspection.id,
            photoId: photo.id,
            shotType: code,
            uploadUrl: photo.originalUploadUrl,
            blob: original,
          });
        } catch {
          // 원본 보관함(IndexedDB)에 못 넣어도 작업본은 이미 서버에 있다. 컷은 저장된 것으로 둔다.
        }
      }
      dispatch({ type: 'uploaded', code, photoId: photo.id });
    } catch (e) {
      if (e instanceof ApiError && e.resultCode === ResultCode.QUALITY_REJECTED) {
        const reasons = (e.result as { reasons?: string[] } | null)?.reasons ?? [];
        dispatch({
          type: 'rejected',
          background,
          code,
          reasons,
          message: reasons.length ? undefined : e.message,
        });
      } else if (e instanceof ApiError && e.resultCode === ResultCode.TOP_SHOT_QR_MISMATCH) {
        dispatch({
          type: 'rejected',
          background,
          code,
          message: '다른 노트북의 라벨입니다. 이 컷은 저장하지 않았습니다.',
        });
      } else if (e instanceof ApiError && e.resultCode === ResultCode.MULTIPLE_QR) {
        dispatch({ type: 'rejected', background, code, reasons: ['multiple_qr'] });
      } else if (isNetworkFailure(e)) {
        // 사진은 그대로 두고 다시 올릴 수 있게 한다(다시 찍지 않아도 된다).
        setHeld({ code, original, processed });
        dispatch({
          type: 'rejected',
          background,
          code,
          message: `사진을 올리지 못했어요. 인터넷을 확인하고 "다시 올리기"를 눌러 주세요. (${failureDetail(e, processed.working, started)})`,
        });
      } else {
        dispatch({
          type: 'rejected',
          background,
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
    let original: Blob;
    try {
      original = await (deps.captureStill ?? defaultCaptureStill)(video, camera.stream);
    } catch (e) {
      dispatch({ type: 'rejected', code, message: e instanceof Error ? e.message : '촬영에 실패했습니다.' });
      return;
    }
    setFlash((n) => n + 1);
    navigator.vibrate?.(30);
    await handleOriginal(code, original);
  }

  /** 폰 카메라 앱으로 찍은 사진(선택 기능). 처리·업로드는 화면 안 카메라와 같다. */
  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !current || !inspection) return;
    setHeld(null);
    dispatch({ type: 'processing', code: current.code });
    await handleOriginal(current.code, file);
  }

  async function handleOriginal(code: string, original: Blob) {
    try {
      const processed = await processShot(original);
      if (processed.reasons.length > 0) {
        // 폰의 1차 검사에서 걸렸다. 다시 찍게 하되, 판단이 애매하면 서버에 맡길 수 있게 남겨 둔다.
        setHeld({ code, original, processed });
        dispatch({ type: 'rejected', code, reasons: processed.reasons });
        return;
      }
      // 폰 검사를 통과하면 바로 다음 컷으로 넘기고, 업로드는 뒤에서 한 장씩 한다.
      dispatch({ type: 'captured', code });
      const job = uploadChain.current.then(() => upload(code, original, processed, true));
      uploadChain.current = job.catch(() => undefined);
      await job;
    } catch (e) {
      dispatch({ type: 'rejected', code, message: e instanceof Error ? e.message : '촬영에 실패했습니다.' });
    }
  }

  /** 이 검사의 원본이 다 올라갈 때까지 기다린다. 실패로 멈춘 것은 다시 시도한다. 남은 장 수를 돌려준다. */
  async function flushOriginals(id: number): Promise<number> {
    const left = async () => (await queue.snapshot(id)).pending + (await queue.snapshot(id)).failed;
    if ((await left()) === 0) return 0;
    setPhase('uploadingOriginals');
    // 잠깐 끊겨 실패한 원본은 몇 번이고 다시 올린다. 제출을 여러 번 누르지 않아도 되게 여기서 되풀이한다.
    for (let round = 0; round < FLUSH_ROUNDS; round++) {
      await queue.retryFailed();
      if ((await left()) === 0) return 0;
    }
    return left();
  }

  async function submit() {
    if (!inspection) return;
    setNotice(null);
    try {
      // 원본이 남았으면 먼저 다 올린다(서버는 원본이 다 와야 제출을 받는다).
      if ((await flushOriginals(inspection.id)) > 0) throw originalsLeft(await queue.snapshot(inspection.id));
      setPhase('submitting');
      try {
        await endpoints.submitInspection(inspection.id);
      } catch (e) {
        if (!(e instanceof ApiError && e.resultCode === ResultCode.ORIGINALS_PENDING)) throw e;
        // 서버 기록과 폰이 어긋난 경우: 한 번 더 올려 보고 다시 제출한다.
        if ((await flushOriginals(inspection.id)) > 0)
          throw originalsLeft(await queue.snapshot(inspection.id));
        setPhase('submitting');
        await endpoints.submitInspection(inspection.id);
      }
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

  /** 촬영을 마치고 그 노트북 화면으로 돌아간다(최신 상태로 다시 조회한다). */
  async function backToDevice() {
    try {
      const scan = request.scannedQrValue
        ? await endpoints.scan(request.scannedQrValue)
        : await endpoints.findByAsset(request.deviceLabel!);
      navigate('/device', {
        state: { scan, identifiedBy: request.identifiedBy, scannedQrValue: request.scannedQrValue },
      });
    } catch {
      navigate('/');
    }
  }

  if (phase !== 'capturing' && phase !== 'submitting' && phase !== 'uploadingOriginals') {
    return (
      <SubmittedView
        kind={request.kind}
        phase={phase}
        shots={state.shots}
        pendingOriginals={pendingOriginals.length}
        failedOriginals={pendingOriginals.filter((i) => i.failed).length}
        onRetryOriginals={() => void queue.retryFailed()}
        onReview={() => inspection && navigate(`/review/${inspection.id}`)}
        inspectionId={inspection?.id}
        onDevice={request.deviceLabel ? () => void backToDevice() : undefined}
      />
    );
  }

  const guide = current ? shotGuide(current.code) : null;
  // 뒤에서 올리다 실패한 컷. 지금 다른 컷을 찍는 중이면 화면을 빼앗지 않고 여기서 알려 준다.
  const redo = state.shots.filter((s) => s.status === 'rejected' && s.code !== state.selected);
  const doneCount = state.shots.filter((s) => s.status === 'done').length;
  // 이미 저장된 컷을 골랐으면 다시 찍을 수 있다(새 사진이 그 컷의 사진이 되고 예전 사진은 기록으로 남는다).
  const retaking = current?.status === 'done';
  const canShoot = !allDone(state) || retaking;

  return (
    <section className="screen screen--camera">
      <div className="capture-view">
        <CameraView ref={videoRef} stream={camera.stream} fit="contain">
          <div className={`shot-overlay shot-overlay--${current?.code ?? 'none'}`} aria-hidden="true" />
          {/* 팔을 들고 있을 때 아래 셔터까지 손이 가지 않아도 되게, 화면 어디를 눌러도 찍힌다 */}
          {canShoot && (
            <button
              type="button"
              className="camera__tap"
              onClick={shoot}
              disabled={!inspection || !camera.stream || current?.status === 'processing'}
              aria-label="화면을 눌러 찍기"
            />
          )}
          {flash > 0 && <div key={flash} className="camera__flash" aria-hidden="true" />}
        </CameraView>
        <div className="shot-title">
          <button
            type="button"
            className="shot-title__close"
            onClick={() => navigate(-1)}
            aria-label="촬영 나가기"
          >
            <Icon name="arrow" size={20} />
          </button>
          <span>
            {KIND_TITLE[request.kind]} · {doneCount}/{state.shots.length}
            {request.deviceLabel ? ` · ${request.deviceLabel}` : ''}
          </span>
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${(doneCount / Math.max(1, state.shots.length)) * 100}%` }} />
          </span>
        </div>
      </div>
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
            <p className="hint--portrait">폰을 가로로 돌리면 더 가까이서 찍을 수 있어요.</p>
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
                  const job = uploadChain.current.then(() => upload(h.code, h.original, h.processed));
                  uploadChain.current = job.catch(() => undefined);
                }}
              >
                {current.reasons?.length ? '그래도 올리기(서버가 다시 판단)' : '다시 올리기'}
              </button>
            )}
          </div>
        )}
        {redo.length > 0 && (
          <p className="redo-hint">
            다시 볼 컷:
            {redo.map((s) => (
              <button
                key={s.code}
                type="button"
                className="redo-hint__item"
                aria-label={`${shotGuide(s.code).name} 컷 보기`}
                onClick={() => dispatch({ type: 'select', code: s.code })}
              >
                {shotGuide(s.code).name}
              </button>
            ))}
          </p>
        )}
        <ol className="shot-strip" aria-label="촬영 컷">
          {state.shots.map((s) => (
            <li key={s.code}>
              <button
                type="button"
                className={`shot-chip shot-chip--${s.status}${s.code === state.selected ? ' is-selected' : ''}`}
                aria-current={s.code === state.selected ? 'step' : undefined}
                ref={s.code === state.selected ? scrollIntoViewIfNeeded : undefined}
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
        {allDone(state) && !retaking && (
          <p className="hint">다시 찍을 컷이 있으면 위에서 그 컷을 눌러 주세요.</p>
        )}
        <div className="actions">
          {!canShoot ? (
            <SubmitButton phase={phase} left={pendingOriginals.length} onSubmit={submit} />
          ) : (
            <>
              <span className="actions__side" aria-hidden="true" />
              <button
                type="button"
                className="btn btn--shutter"
                onClick={shoot}
                disabled={!inspection || !camera.stream || current?.status === 'processing'}
                aria-label={`${guide?.name ?? ''} 촬영하기`}
              >
                {current?.status === 'processing' ? '처리 중…' : retaking ? '다시 찍기' : '찍기'}
              </button>
              {/* 선택 기능: 폰의 카메라 앱으로 찍는다(줌·초점을 기본 카메라로 맞추고 싶을 때) */}
              <label className={`actions__side btn btn--ghost btn--sm${!inspection ? ' is-disabled' : ''}`}>
                <Icon name="camera" size={18} />
                폰 카메라
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="visually-hidden"
                  aria-label={`${guide?.name ?? ''} 폰 카메라 앱으로 찍기`}
                  disabled={!inspection || current?.status === 'processing'}
                  onChange={(e) => void pickFile(e)}
                />
              </label>
            </>
          )}
        </div>
        {retaking && allDone(state) && (
          <div className="actions">
            <SubmitButton phase={phase} left={pendingOriginals.length} onSubmit={submit} />
          </div>
        )}
        {pendingOriginals.length > 0 && (
          <p className="hint">
            원본 {pendingOriginals.length}장을 뒤에서 올리는 중입니다. 앱을 닫아도 다음에 이어서 올립니다.
          </p>
        )}
      </div>
    </section>
  );
}

function SubmitButton({ phase, left, onSubmit }: { phase: Phase; left: number; onSubmit(): void }) {
  return (
    <button
      type="button"
      className="btn btn--primary"
      onClick={onSubmit}
      disabled={phase === 'submitting' || phase === 'uploadingOriginals'}
    >
      <Icon name="upload" size={20} />
      {phase === 'uploadingOriginals'
        ? `원본 올리는 중… (남은 ${left}장)`
        : phase === 'submitting'
          ? '제출 중…'
          : '촬영 제출'}
    </button>
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

/** 한 줄로 넘겨 보는 컷 목록에서 지금 찍을 컷이 보이게 한다. */
function isNetworkFailure(e: unknown): boolean {
  if (e instanceof ApiError) return e.resultCode === NETWORK_ERROR_CODE;
  // Safari는 fetch가 끊기면 "Load failed", Chrome은 "Failed to fetch"라고만 한다.
  return (
    e instanceof TypeError || (e instanceof Error && /load failed|failed to fetch|network/i.test(e.message))
  );
}

function originalsLeft(s: { failed: number; pending: number; items: { lastError?: string }[] }): Error {
  const why = s.items.find((i) => i.lastError)?.lastError;
  return new Error(
    `원본 사진 ${s.pending + s.failed}장을 아직 올리지 못했어요. 인터넷을 확인하고 "촬영 제출"을 다시 눌러 주세요.${why ? ` (${why})` : ''}`,
  );
}

/** 실패 원인을 짧게 적는다(오류 이름·내용, 사진 크기, 걸린 시간). 원인을 찾는 데 쓴다. */
function failureDetail(e: unknown, image: Blob, started: number): string {
  const cause = e instanceof ApiError && e.cause instanceof Error ? e.cause : e;
  const what = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  const mb = (image.size / 1024 / 1024).toFixed(2);
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  return `${what} · ${mb}MB · ${sec}초`;
}

function scrollIntoViewIfNeeded(el: HTMLElement | null) {
  el?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function SubmittedView(props: {
  kind: InspectionKind;
  phase: Phase;
  shots: ShotState[];
  pendingOriginals: number;
  failedOriginals: number;
  onRetryOriginals(): void;
  onReview(): void;
  inspectionId?: number;
  onDevice?: () => void;
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
      {kind !== 'checkin' && props.inspectionId && (
        <PhotoGallery
          inspectionId={props.inspectionId}
          title={kind === 'register' ? '찍은 기준 사진' : '찍은 대여 사진'}
        />
      )}
      {props.onDevice && (
        <button type="button" className="btn" onClick={props.onDevice}>
          <Icon name="laptop" size={18} />
          노트북 화면으로
        </button>
      )}
      <Link to="/" className="btn btn--ghost">
        <Icon name="scan" size={18} />
        다음 노트북 스캔
      </Link>
    </section>
  );
}

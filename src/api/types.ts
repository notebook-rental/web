// 업무 API와 주고받는 데이터 모양.
// 기준: notebook-rental/docs specs/001-return-damage-inspection/contracts/openapi.yaml
// openapi.yaml에 아직 없는 필드는 "계약 보완" 주석으로 표시한다(api 스레드와 합의, 2026-11-04).

export type Role = 'staff' | 'admin';

export interface ResponseHeader {
  isSuccessful: boolean;
  resultCode: number;
  resultMessage: string;
}

export interface ApiEnvelope<T> {
  header: ResponseHeader;
  result: T;
  totalCount?: number;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  roles: Role[];
}

export type DamageType =
  | 'scratch'
  | 'dent'
  | 'crack'
  | 'sticker'
  | 'stain'
  | 'missing_part'
  | 'qr_tampered'
  | 'other';

export type Severity = 'minor' | 'moderate' | 'severe';

export type Geometry =
  | { type: 'box'; coords: [number, number, number, number] }
  | { type: 'polygon'; coords: [number, number][] };

export type DeviceStatus = 'available' | 'rented' | 'inspecting' | 'repair' | 'retired';

export interface Device {
  id: number;
  assetNo: string;
  serialNo?: string | null;
  qrValue: string;
  status: DeviceStatus;
  // 계약 보완: 목록(GET /devices)과 스캔 결과에서 모델 이름을 보여 준다
  model?: Pick<DeviceModel, 'id' | 'manufacturer' | 'name'>;
}

/** 계약 보완: GET /devices 목록 한 줄 */
export interface DeviceSummary extends Omit<Device, 'qrValue'> {
  /** QR이 아직 없거나 폐기된 노트북은 null */
  qrValue: string | null;
  lastInspectedAt?: string | null;
}

export interface DeviceModel {
  // 계약 보완: GET /device-models
  id: number;
  manufacturer: string;
  name: string;
  shots?: ShotGuideInfo[];
}

/** 모델별 촬영 컷 안내(GET /device-models 의 shots) */
export interface ShotGuideInfo {
  shotType: string;
  name: string;
  sortOrder: number;
  guide?: string;
}

export interface DeviceModelCreate {
  manufacturer: string;
  name: string;
  /** 비우면 서버가 기본 8컷을 쓴다 */
  shots?: string[];
}

export interface DeviceCreate {
  /** 스캔한 라벨 값(자산 번호, 또는 예전 NR1: QR) */
  qrValue: string;
  deviceModelId: number;
  /** 예전 NR1: QR로 등록할 때만 쓴다. 자산 번호 라벨이면 라벨 값이 곧 자산 번호다 */
  assetNo?: string;
  /** 선택 항목 */
  serialNo?: string;
}

export interface DeviceDamage {
  id: number;
  rentalId: number;
  shotType: string;
  damageType: DamageType;
  severity: Severity;
  geometry: Geometry;
  reviewedBy?: string;
  beforePhotoUrl?: string;
  afterPhotoUrl?: string;
}

export type NextAction = 'register' | 'checkout' | 'checkin' | 'none' | 'blocked';

export interface ScanResult {
  qrValue?: string;
  /** 발급한 라벨이 아닌 외부 자산 번호를 처음 스캔하면 없다 */
  qrStatus?: 'unassigned' | 'assigned' | 'void';
  nextAction: NextAction;
  device?: Device;
  rentalId?: number;
  inspectionId?: number;
  requiredShots?: string[];
  existingDamages?: DeviceDamage[];
  /** 등록 기준 사진(spec 002 US5): 아직 안 찍음 / 찍는 중 / 다 찍음 */
  registerPhotos?: RegisterPhotos | null;
  /** 찍는 중인 등록 기준 촬영 검사(이어 찍기) */
  registerInspectionId?: number | null;
}

export type RegisterPhotos = 'none' | 'capturing' | 'completed';

export interface QrBatch {
  id: number;
  count: number;
  labelsPdfUrl?: string;
  // 계약 보완: GET /qr-batches 목록
  createdAt?: string;
  /** 이 묶음에서 매긴 첫·끝 자산 번호(예: NB26110001 ~ NB26110020) */
  firstAssetNo?: string;
  lastAssetNo?: string;
}

/** 라벨 출력 형식. 값(자산 번호)은 같고 모양만 다르다 */
export type LabelFormat = 'qr' | 'barcode';

/** register = 새 노트북을 등록하고 대여 건 없이 찍어 두는 기준 사진(spec 002 US5) */
export type InspectionKind = 'checkout' | 'checkin' | 'register';
export type InspectionStatus = 'capturing' | 'analyzing' | 'reviewing' | 'completed' | 'blocked';

export interface Photo {
  id: number;
  shotType: string;
  sha256?: string;
  url?: string;
  quality?: Record<string, unknown>;
  // 계약 보완: 좌표계를 맞추기 위한 원본 크기
  width?: number;
  height?: number;
  originalConfirmed?: boolean;
}

export interface PhotoUploaded extends Photo {
  originalUploadUrl?: string;
}

export interface Inspection {
  id: number;
  /** 등록 기준 촬영이면 없다 */
  rentalId?: number | null;
  kind: InspectionKind;
  status: InspectionStatus;
  requiredShots: string[];
  capturedShots: string[];
  result?: 'no_change' | 'new_damage' | null;
  pendingFindings?: number;
  // 계약 보완
  deviceId?: number;
  photos?: Photo[];
  /** 반납 검사의 컷별 비교 상태(대여·등록 검사는 빈 목록) */
  comparisons?: ShotComparison[];
}

/** 컷 하나의 자동 비교 상태(GET /inspections/{id} 의 comparisons) */
export interface ShotComparison {
  shotType: string;
  /** 아직 비교를 시작하지 않았으면 null */
  status: ComparisonStatus | null;
  /** 자동 비교 불가(not_comparable)일 때 그 이유 코드(예: too_few_matches) */
  reason?: string | null;
  /** 비교 기준이 된 대여 때 사진. 후보가 없는 컷도 대여 때 사진을 보여 주려고 받는다 */
  baselinePhotoUrl?: string | null;
}

export type VerdictValue = 'new_damage' | 'existing_damage' | 'false_positive';

export interface Finding {
  id: number;
  shotType: string;
  source: 'auto' | 'manual';
  geometry: Geometry;
  predictedType?: DamageType;
  confidence?: number;
  overlapsExistingDamage?: boolean;
  verdict?: VerdictValue | null;
  baselinePhotoUrl?: string;
  targetPhotoUrl?: string;
  alignedTargetUrl?: string;
}

export interface Verdict {
  verdict: VerdictValue;
  damageType?: DamageType;
  severity?: Severity;
}

export interface ManualFinding {
  photoId: number;
  geometry: Geometry;
  damageType: DamageType;
  severity: Severity;
}

export type QualityReason =
  | 'blurry'
  | 'too_dark'
  | 'too_bright'
  | 'out_of_frame'
  | 'qr_not_found'
  | 'multiple_qr';

// SSE 이벤트(계약 보완: GET /inspections/{id}/events)
export type ComparisonStatus = 'queued' | 'running' | 'done' | 'not_comparable' | 'failed';

export interface ComparisonEvent {
  shotType: string;
  status: ComparisonStatus;
  findingCount?: number;
  findings?: Finding[];
}

export interface InspectionEvent {
  status: InspectionStatus;
  pendingFindings?: number;
}

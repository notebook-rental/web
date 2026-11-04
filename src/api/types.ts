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
  serialNo: string;
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
  qrValue: string;
  deviceModelId: number;
  assetNo: string;
  serialNo: string;
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
  qrStatus: 'unassigned' | 'assigned' | 'void';
  nextAction: NextAction;
  device?: Device;
  rentalId?: number;
  inspectionId?: number;
  requiredShots?: string[];
  existingDamages?: DeviceDamage[];
}

export interface QrBatch {
  id: number;
  count: number;
  labelsPdfUrl?: string;
  // 계약 보완: GET /qr-batches 목록
  createdAt?: string;
}

export type InspectionKind = 'checkout' | 'checkin';
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
  rentalId: number;
  kind: InspectionKind;
  status: InspectionStatus;
  requiredShots: string[];
  capturedShots: string[];
  result?: 'no_change' | 'new_damage' | null;
  pendingFindings?: number;
  // 계약 보완
  deviceId?: number;
  photos?: Photo[];
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

import type { ApiClient } from './client';
import type {
  Device,
  DeviceCreate,
  DeviceModel,
  DeviceModelCreate,
  DeviceSummary,
  Finding,
  Inspection,
  InspectionKind,
  LabelFormat,
  ManualFinding,
  PhotoUploaded,
  QrBatch,
  ScanResult,
  TokenPair,
  Verdict,
} from './types';

/** 화면에서 쓰는 업무 API 목록. 경로는 openapi.yaml과 같다(기준 경로 /api/v1). */
export function createEndpoints(api: ApiClient) {
  const enc = encodeURIComponent;
  return {
    login: (loginId: string, password: string) =>
      api.request<TokenPair>('POST', '/auth/login', { json: { loginId, password }, anonymous: true }),
    refresh: (refreshToken: string) =>
      api.request<TokenPair>('POST', '/auth/refresh', { json: { refreshToken }, anonymous: true }),
    logout: () => api.request<null>('POST', '/auth/logout'),

    scan: (qrValue: string) => api.request<ScanResult>('GET', `/scan/${enc(qrValue)}`),
    findByAsset: (assetNo: string) => api.request<ScanResult>('GET', `/devices/by-asset/${enc(assetNo)}`),

    listDeviceModels: () => api.list<DeviceModel>('/device-models'),
    createDeviceModel: (body: DeviceModelCreate) =>
      api.request<DeviceModel>('POST', '/device-models', { json: body }),
    listDevices: (query: { q?: string; page?: number; size?: number } = {}) => {
      const params = new URLSearchParams();
      if (query.q) params.set('q', query.q);
      params.set('page', String(query.page ?? 0));
      params.set('size', String(query.size ?? 20));
      return api.list<DeviceSummary>(`/devices?${params.toString()}`);
    },
    createDevice: (body: DeviceCreate) => api.request<Device>('POST', '/devices', { json: body }),
    deviceLabelPdf: (deviceId: number, format: LabelFormat) =>
      api.blob(`/devices/${deviceId}/label.pdf?format=${format}`),
    createRental: (deviceId: number, customerRef: string) =>
      api.request<{ id: number }>('POST', '/rentals', { json: { deviceId, customerRef } }),

    createQrBatch: (count: number) => api.request<QrBatch>('POST', '/qr-batches', { json: { count } }),
    listQrBatches: (page = 0, size = 20) => api.list<QrBatch>(`/qr-batches?page=${page}&size=${size}`),
    qrBatchPdf: (batchId: number, format: LabelFormat = 'qr') =>
      api.blob(`/qr-batches/${batchId}/labels.pdf?format=${format}`),
    voidQr: (qrValue: string) => api.request<null>('POST', `/qr-tags/${enc(qrValue)}/void`),

    createInspection: (body: {
      /** 대여·반납 검사 */
      rentalId?: number;
      /** 등록 기준 촬영(kind=register) */
      deviceId?: number;
      kind: InspectionKind;
      identifiedBy: 'qr' | 'manual';
      scannedQrValue?: string;
    }) => api.request<Inspection>('POST', '/inspections', { json: body }),
    getInspection: (id: number) => api.request<Inspection>('GET', `/inspections/${id}`),
    uploadPhoto: (
      inspectionId: number,
      input: { shotType: string; image: Blob; originalSha256: string; decodedQrValues?: string[] },
    ) => {
      const form = new FormData();
      form.append('shotType', input.shotType);
      form.append('image', input.image, `${input.shotType}.jpg`);
      form.append('originalSha256', input.originalSha256);
      if (input.decodedQrValues?.length) form.append('decodedQrValues', input.decodedQrValues.join(','));
      return api.request<PhotoUploaded>('POST', `/inspections/${inspectionId}/photos`, { form });
    },
    /** 원본을 서버를 거쳐 올린다. 서버가 sha256을 대조해 저장하고 확인까지 끝낸다. */
    uploadOriginal: (inspectionId: number, photoId: number, blob: Blob) => {
      const form = new FormData();
      form.append('file', blob, 'original.jpg');
      return api.request<null>('POST', `/inspections/${inspectionId}/photos/${photoId}/original/content`, {
        form,
      });
    },
    confirmOriginal: (inspectionId: number, photoId: number) =>
      api.request<null>('POST', `/inspections/${inspectionId}/photos/${photoId}/original`),
    submitInspection: (id: number) => api.request<null>('POST', `/inspections/${id}/submit`),

    listFindings: (inspectionId: number) => api.list<Finding>(`/inspections/${inspectionId}/findings`),
    addManualFinding: (inspectionId: number, body: ManualFinding) =>
      api.request<Finding>('POST', `/inspections/${inspectionId}/findings`, { json: body }),
    setVerdict: (findingId: number, body: Verdict) =>
      api.request<Finding>('PUT', `/findings/${findingId}/verdict`, { json: body }),
    completeInspection: (id: number) => api.request<Inspection>('POST', `/inspections/${id}/complete`),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;

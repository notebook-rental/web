// contracts/api-response.md 3절의 resultCode 중 화면이 따로 처리하는 것.
export const ResultCode = {
  NOT_FOUND: -1002,
  QR_NOT_ISSUED: -2001,
  MULTIPLE_QR: -2002,
  QR_ALREADY_ASSIGNED: -2003,
  QR_VOID: -2004,
  TOP_SHOT_QR_MISMATCH: -2005,
  QUALITY_REJECTED: -3001,
  MISSING_SHOTS: -3002,
  DEVICE_RENTAL_MISMATCH: -3003,
  PENDING_FINDINGS: -4001,
} as const;

/** 카메라 요청 조건과 오류 메시지 */

export const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    // 폰 카메라 센서는 대부분 4:3이다. 16:9로 받으면 위아래(세로로 들면 좌우)가 잘려 화각이 25% 좁아지고,
    // 그만큼 폰을 높이 들어야 노트북 전체가 들어온다.
    aspectRatio: { ideal: 4 / 3 },
    width: { ideal: 4032 },
    height: { ideal: 3024 },
  },
};

export function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return '카메라 권한이 필요합니다. 브라우저 설정에서 이 사이트의 카메라를 허용해 주세요.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return '사용할 수 있는 카메라를 찾지 못했습니다.';
  if (name === 'NotReadableError')
    return '다른 앱이 카메라를 쓰고 있습니다. 다른 앱을 닫고 다시 시도해 주세요.';
  return '카메라를 켜지 못했습니다. 페이지를 새로 고쳐 다시 시도해 주세요.';
}

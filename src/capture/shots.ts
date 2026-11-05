/**
 * 기본 8컷(FR-001, data-model shot_type). 서버가 노트북 모델별 필수 컷(requiredShots)을 주면 그 순서를 따른다.
 * 여기에는 화면에 보여 줄 이름과 구도 안내만 둔다.
 */
export interface ShotGuide {
  code: string;
  name: string;
  guide: string;
  /** 노트북을 연 상태에서 찍는 컷 */
  open: boolean;
}

export const SHOT_GUIDES: ShotGuide[] = [
  {
    code: 'top',
    name: '상판',
    guide: '노트북을 닫고 상판 전체가 틀 안에 들어오게 위에서 찍어요. QR도 함께 읽어요.',
    open: false,
  },
  {
    code: 'bottom',
    name: '하판',
    guide: '뒤집어서 바닥면 전체를 찍어요. 시리얼 라벨이 보이게 해 주세요.',
    open: false,
  },
  {
    code: 'left',
    name: '좌측면',
    guide: '닫은 상태로 왼쪽 옆면을 정면에서 찍어요. 모서리까지 들어오게 해 주세요.',
    open: false,
  },
  {
    code: 'right',
    name: '우측면',
    guide: '닫은 상태로 오른쪽 옆면을 정면에서 찍어요. 모서리까지 들어오게 해 주세요.',
    open: false,
  },
  { code: 'hinge', name: '힌지 면', guide: '닫은 상태로 힌지(접히는 쪽) 면을 정면에서 찍어요.', open: false },
  { code: 'front', name: '앞면', guide: '닫은 상태로 열리는 쪽(앞) 면을 정면에서 찍어요.', open: false },
  {
    code: 'keyboard',
    name: '키보드·팜레스트',
    guide: '노트북을 열고 키보드와 손목 받침 전체를 위에서 찍어요.',
    open: true,
  },
  {
    code: 'screen_off',
    name: '꺼진 화면',
    guide: '전원을 끈 화면을 정면에서 찍어요. 조명이 비치지 않게 각도를 살짝 바꿔 주세요.',
    open: true,
  },
];

export const DEFAULT_SHOTS = SHOT_GUIDES.map((s) => s.code);

export function shotGuide(code: string): ShotGuide {
  return (
    SHOT_GUIDES.find((s) => s.code === code) ?? {
      code,
      name: code,
      guide: '안내에 맞춰 찍어 주세요.',
      open: false,
    }
  );
}

export const QUALITY_REASON_TEXT: Record<string, string> = {
  blurry: '사진이 흔들렸어요. 폰을 고정하고 다시 찍어 주세요.',
  too_dark: '너무 어두워요. 조명을 켜거나 밝은 곳에서 찍어 주세요.',
  too_bright: '빛이 너무 강해요. 반사가 덜한 각도로 찍어 주세요.',
  out_of_frame: '노트북이 틀을 벗어났어요. 전체가 틀 안에 들어오게 해 주세요.',
  qr_not_found: '상판 자산 번호 라벨이 보이지 않아요. 라벨이 가려지지 않게 찍어 주세요.',
  multiple_qr: '라벨이 여러 개 찍혔어요. 다른 노트북이 함께 찍히지 않게 해 주세요.',
};

export function reasonText(reason: string): string {
  return QUALITY_REASON_TEXT[reason] ?? `다시 찍어 주세요. (${reason})`;
}

export const DAMAGE_TYPE_TEXT: Record<string, string> = {
  scratch: '스크래치',
  dent: '찍힘',
  crack: '깨짐',
  sticker: '스티커',
  stain: '오염',
  missing_part: '부품 누락',
  qr_tampered: 'QR 훼손',
  other: '기타',
};

export const SEVERITY_TEXT: Record<string, string> = { minor: '경미', moderate: '보통', severe: '심각' };

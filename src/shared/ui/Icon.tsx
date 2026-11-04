/**
 * 화면에서 쓰는 선 아이콘 모음(24px 격자, 외부 라이브러리 없이 SVG 경로만).
 * 장식용이라 기본으로 스크린 리더에서 숨긴다. 뜻이 필요한 곳은 옆에 글자를 함께 둔다.
 */
const PATHS = {
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10',
  laptop: 'M5 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v9H5zM2.5 18.5h19l-1.5-3.5H4z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18v2h2M18 18h2v2',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  camera:
    'M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 10a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  printer:
    'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
  shield: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  keyboard:
    'M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM7 10h.01M11 10h.01M15 10h.01M8 14h8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

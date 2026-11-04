/**
 * 직접 그린 SVG 일러스트. 색은 CSS 변수(--primary 등)를 따라가서 다크 모드에서도 자연스럽다.
 * 모두 장식이라 스크린 리더에서는 숨기거나(aria-hidden), 뜻이 있는 그림(촬영 컷)은 role="img"로 이름을 준다.
 */

/** 로그인 화면 그림: 반납 노트북 위에 휴대폰으로 QR을 비추고, 화면에는 비교 결과가 뜬다. */
export function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 220" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hero-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.16" />
          <stop offset="1" stopColor="#6a5cff" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="hero-phone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2335" />
          <stop offset="1" stopColor="#0b1020" />
        </linearGradient>
      </defs>
      {/* 바닥 그림자 */}
      <ellipse cx="170" cy="200" rx="150" ry="10" fill="var(--text)" opacity="0.06" />
      {/* 노트북 화면 */}
      <rect
        x="52"
        y="22"
        width="236"
        height="150"
        rx="12"
        fill="var(--surface)"
        stroke="var(--border)"
        strokeWidth="2"
      />
      <rect x="62" y="32" width="216" height="130" rx="6" fill="url(#hero-screen)" />
      {/* 화면 속 비교 사진 두 장 */}
      <rect x="74" y="46" width="92" height="66" rx="5" fill="var(--surface)" stroke="var(--border)" />
      <rect x="174" y="46" width="92" height="66" rx="5" fill="var(--surface)" stroke="var(--border)" />
      <rect x="84" y="56" width="72" height="46" rx="6" fill="var(--surface-2)" />
      <rect x="184" y="56" width="72" height="46" rx="6" fill="var(--surface-2)" />
      <path d="M200 70 L222 82" stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" />
      <rect
        x="194"
        y="64"
        width="34"
        height="24"
        rx="3"
        fill="none"
        stroke="var(--danger)"
        strokeWidth="2.5"
      />
      {/* 화면 속 진행 막대 */}
      <rect x="74" y="124" width="192" height="8" rx="4" fill="var(--surface)" />
      <rect x="74" y="124" width="132" height="8" rx="4" fill="var(--ok)" />
      <rect x="74" y="140" width="80" height="8" rx="4" fill="var(--surface)" />
      {/* 노트북 받침 */}
      <path
        d="M30 176 H310 L298 190 H42 Z"
        fill="var(--surface-2)"
        stroke="var(--border)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="146" y="176" width="48" height="5" rx="2.5" fill="var(--border)" />
      {/* 휴대폰 */}
      <g transform="translate(262 70) rotate(8)">
        <rect width="74" height="132" rx="14" fill="url(#hero-phone)" />
        <rect x="6" y="10" width="62" height="112" rx="8" fill="#121a2b" />
        {/* QR 조준틀 */}
        <g stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M18 40 v-8 h8" />
          <path d="M48 32 h8 v8" />
          <path d="M56 62 v8 h-8" />
          <path d="M26 70 h-8 v-8" />
        </g>
        <g fill="#fff">
          <rect x="24" y="38" width="9" height="9" rx="1" />
          <rect x="41" y="38" width="9" height="9" rx="1" />
          <rect x="24" y="55" width="9" height="9" rx="1" />
          <rect x="41" y="55" width="4" height="4" />
          <rect x="46" y="60" width="4" height="4" />
        </g>
        <rect x="14" y="84" width="46" height="8" rx="4" fill="var(--primary)" />
        <rect x="20" y="98" width="34" height="6" rx="3" fill="#2a3450" />
      </g>
      {/* 확인 배지 */}
      <circle cx="262" cy="64" r="17" fill="var(--ok)" />
      <path
        d="M254 64 l6 6 l11 -12"
        stroke="#fff"
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const HIGHLIGHT = { fill: 'var(--primary-soft)', stroke: 'var(--primary)' };
const NEUTRAL = { fill: 'var(--surface-2)', stroke: 'var(--muted)' };

/** 위에서 본 닫힌 노트북. side로 정한 면(가장자리)을 굵게 칠하고 카메라 방향 화살표를 그린다. */
function ClosedTopView({ side }: { side?: 'left' | 'right' | 'hinge' | 'front' }) {
  const edge = {
    left: 'M30 16 V64',
    right: 'M90 16 V64',
    hinge: 'M32 14 H88',
    front: 'M32 66 H88',
  } as const;
  const arrow = {
    left: 'M6 40 H22 M16 34 l6 6 -6 6',
    right: 'M114 40 H98 M104 34 l-6 6 6 6',
    hinge: 'M60 0 V8 M54 3 l6 6 6 -6',
    front: 'M60 80 V72 M54 77 l6 -6 6 6',
  } as const;
  return (
    <>
      <rect x="30" y="14" width="60" height="52" rx="6" {...NEUTRAL} strokeWidth="1.5" />
      {side && (
        <>
          <path d={edge[side]} stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" />
          <path
            d={arrow[side]}
            stroke="var(--primary)"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </>
  );
}

/** 열린 노트북(앞에서). part로 정한 부분을 칠한다. */
function OpenFrontView({ part }: { part: 'keyboard' | 'screen' }) {
  const screen = part === 'screen' ? { fill: '#1b2335', stroke: 'var(--primary)' } : NEUTRAL;
  const base = part === 'keyboard' ? HIGHLIGHT : NEUTRAL;
  return (
    <>
      <rect
        x="28"
        y="6"
        width="64"
        height="42"
        rx="4"
        {...screen}
        strokeWidth={part === 'screen' ? 2.5 : 1.5}
      />
      <path
        d="M22 52 H98 L108 72 H12 Z"
        {...base}
        strokeWidth={part === 'keyboard' ? 2.5 : 1.5}
        strokeLinejoin="round"
      />
      {part === 'keyboard' && (
        <g fill="var(--primary)" opacity="0.55">
          {[0, 1, 2].map((row) =>
            Array.from({ length: 8 - row }, (_, i) => (
              <rect
                key={`${row}-${i}`}
                x={30 + row * 3 + i * 8}
                y={55 + row * 5}
                width="6"
                height="3"
                rx="1"
              />
            )),
          )}
          <rect x="48" y="66" width="24" height="3.5" rx="1" />
        </g>
      )}
    </>
  );
}

const SHOT_LABEL: Record<string, string> = {
  top: '닫은 노트북을 위에서 본 모습, 상판 전체',
  bottom: '노트북을 뒤집어 본 바닥면',
  left: '닫은 노트북의 왼쪽 옆면',
  right: '닫은 노트북의 오른쪽 옆면',
  hinge: '닫은 노트북의 힌지 쪽 면',
  front: '닫은 노트북의 앞쪽 면',
  keyboard: '열린 노트북의 키보드와 팜레스트',
  screen_off: '열린 노트북의 꺼진 화면',
};

/** 촬영 컷 안내 그림: 지금 노트북의 어느 면을 찍는지 한눈에 보여 준다. */
export function ShotDiagram({ code, className }: { code: string; className?: string }) {
  let body;
  switch (code) {
    case 'top':
      body = (
        <>
          <rect x="30" y="14" width="60" height="52" rx="6" {...HIGHLIGHT} strokeWidth="2.5" />
          <circle cx="60" cy="40" r="7" fill="none" stroke="var(--primary)" strokeWidth="1.5" opacity="0.6" />
          <rect x="52" y="54" width="16" height="7" rx="1.5" fill="var(--primary)" />
        </>
      );
      break;
    case 'bottom':
      body = (
        <>
          <rect x="30" y="14" width="60" height="52" rx="6" {...HIGHLIGHT} strokeWidth="2.5" />
          {[
            [37, 21],
            [83, 21],
            [37, 59],
            [83, 59],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.8" fill="var(--primary)" />
          ))}
          <rect
            x="46"
            y="36"
            width="28"
            height="9"
            rx="1.5"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
          />
          <path d="M50 40.5 h20" stroke="var(--primary)" strokeWidth="1.2" strokeDasharray="2 1.5" />
        </>
      );
      break;
    case 'left':
    case 'right':
    case 'hinge':
    case 'front':
      body = <ClosedTopView side={code} />;
      break;
    case 'keyboard':
      body = <OpenFrontView part="keyboard" />;
      break;
    case 'screen_off':
      body = <OpenFrontView part="screen" />;
      break;
    default:
      body = <ClosedTopView />;
  }
  return (
    <svg
      className={className ? `shot-diagram ${className}` : 'shot-diagram'}
      viewBox="0 0 120 80"
      role="img"
      aria-label={SHOT_LABEL[code] ?? '노트북'}
    >
      {body}
    </svg>
  );
}

/** 빈 목록 그림: 점선 상자 안의 노트북. */
export function EmptyIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 84" aria-hidden="true" focusable="false">
      <rect
        x="6"
        y="6"
        width="108"
        height="72"
        rx="14"
        fill="none"
        stroke="var(--border)"
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      <rect
        x="36"
        y="22"
        width="48"
        height="30"
        rx="4"
        fill="var(--surface-2)"
        stroke="var(--muted)"
        strokeWidth="1.8"
      />
      <path
        d="M28 56 H92 L86 63 H34 Z"
        fill="var(--surface-2)"
        stroke="var(--muted)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="90" cy="24" r="9" fill="var(--primary)" />
      <path d="M90 19.5 v9 M85.5 24 h9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

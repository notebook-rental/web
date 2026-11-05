import {
  ArrowRight,
  Ban,
  Barcode,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Columns2,
  Download,
  House,
  Images,
  Keyboard,
  Laptop,
  Layers,
  LogOut,
  PencilLine,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  ScanLine,
  ScanQrCode,
  Search,
  ShieldCheck,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from 'lucide-react';

/**
 * 화면에서 쓰는 아이콘(lucide, ISC 라이선스). 이름으로 골라 쓰고, 필요한 아이콘만 묶음에 들어간다.
 * 장식용이라 스크린 리더에서 숨긴다. 뜻이 필요한 곳은 옆에 글자를 함께 두거나 버튼에 aria-label을 준다.
 */
const ICONS = {
  scan: ScanLine,
  scanQr: ScanQrCode,
  laptop: Laptop,
  qr: QrCode,
  barcode: Barcode,
  layers: Layers,
  plus: Plus,
  search: Search,
  logout: LogOut,
  back: ChevronLeft,
  next: ChevronRight,
  arrow: ArrowRight,
  camera: Camera,
  check: Check,
  checkCircle: CircleCheck,
  alert: TriangleAlert,
  upload: Upload,
  download: Download,
  printer: Printer,
  shield: ShieldCheck,
  home: House,
  keyboard: Keyboard,
  ban: Ban,
  retry: RotateCcw,
  sideBySide: Columns2,
  overlay: Images,
  draw: PencilLine,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const C = ICONS[name];
  return (
    <C
      className={className ? `icon ${className}` : 'icon'}
      size={size}
      strokeWidth={1.9}
      aria-hidden="true"
      focusable="false"
    />
  );
}

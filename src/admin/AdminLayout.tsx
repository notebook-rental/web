import { NavLink, Outlet } from 'react-router-dom';
import { Icon, type IconName } from '../shared/ui/Icon';

const MENU: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/admin', label: '관리 홈', icon: 'home', end: true },
  { to: '/admin/devices', label: '노트북', icon: 'laptop' },
  { to: '/admin/models', label: '모델·촬영 컷', icon: 'layers' },
  { to: '/admin/qr', label: 'QR 스티커', icon: 'qr' },
];

/** 관리자 화면 틀. 넓은 화면에서는 왼쪽 메뉴, 휴대폰에서는 위쪽 가로 메뉴로 보인다. */
export function AdminLayout() {
  return (
    <div className="admin">
      <nav className="admin__nav" aria-label="관리 메뉴">
        {MENU.map((m) => (
          <NavLink key={m.to} to={m.to} end={m.end} className="admin__link">
            <Icon name={m.icon} size={18} />
            <span>{m.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin__body">
        <Outlet />
      </div>
    </div>
  );
}

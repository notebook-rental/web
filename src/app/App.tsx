import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '../api/types';
import { AdminHome } from '../admin/AdminHome';
import { AdminLayout } from '../admin/AdminLayout';
import { DeviceListPage } from '../admin/DeviceListPage';
import { ModelsPage } from '../admin/ModelsPage';
import { LoginPage } from '../auth/LoginPage';
import { CameraProvider } from '../camera/CameraProvider';
import { CaptureScreen } from '../capture/CaptureScreen';
import { UploadQueueProvider, useUploadQueue } from '../capture/UploadQueueProvider';
import { DevicePage } from '../devices/DevicePage';
import { QrBatchPage } from '../devices/QrBatchPage';
import { RegisterPage } from '../devices/RegisterPage';
import { ReviewPage } from '../review/ReviewPage';
import { ManualIdentify } from '../scan/ManualIdentify';
import { ScanScreen } from '../scan/ScanScreen';
import { Icon } from '../shared/ui/Icon';
import { ServicesProvider, useServices, type ServicesProviderProps } from './services';

function RequireAuth({ role, children }: { role?: Role; children: ReactNode }) {
  const { session, hasRole } = useServices();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (role && !hasRole(role))
    return (
      <section className="screen">
        <p className="alert alert--error" role="alert">
          관리자만 쓸 수 있는 화면입니다.
        </p>
      </section>
    );
  return <>{children}</>;
}

function Layout() {
  const { hasRole, logout } = useServices();
  const { snapshot } = useUploadQueue();
  const { pathname } = useLocation();
  // 카메라를 쓰는 화면은 어두운 배경으로 꽉 채운다.
  const camera = pathname === '/' || pathname === '/capture';
  return (
    <div className={camera ? 'app app--camera' : 'app'}>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="반납 검사 홈">
          <span className="brand__mark" aria-hidden="true">
            <Icon name="laptop" size={18} />
          </span>
          <span className="brand__name">반납 검사</span>
        </Link>
        {snapshot.pending > 0 && (
          <span className="badge badge--upload" title="뒤에서 올리는 원본 사진">
            <Icon name="upload" size={14} />
            원본 {snapshot.pending}
          </span>
        )}
        <nav className="topbar__nav" aria-label="주 메뉴">
          <NavLink to="/" end className="navlink">
            <Icon name="scan" size={18} />
            <span>스캔</span>
          </NavLink>
          {hasRole('admin') && (
            <NavLink to="/admin" className="navlink">
              <Icon name="shield" size={18} />
              <span>관리</span>
            </NavLink>
          )}
          <button type="button" className="navlink" onClick={() => void logout()} aria-label="로그아웃">
            <Icon name="logout" size={18} />
            <span className="navlink__text--wide">로그아웃</span>
          </button>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<ScanScreen />} />
        <Route path="manual" element={<ManualIdentify />} />
        <Route path="device" element={<DevicePage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="capture" element={<CaptureScreen />} />
        <Route path="review/:inspectionId" element={<ReviewPage />} />
        <Route
          path="admin"
          element={
            <RequireAuth role="admin">
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<AdminHome />} />
          <Route path="devices" element={<DeviceListPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="qr" element={<QrBatchPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** 앱 전체 조립. 테스트에서는 Router와 서비스 설정을 바꿔 끼운다. */
export function AppProviders({
  children,
  services,
}: {
  children: ReactNode;
  services?: Omit<ServicesProviderProps, 'children'>;
}) {
  return (
    <ServicesProvider {...services}>
      <CameraProvider>
        <UploadQueueProvider>{children}</UploadQueueProvider>
      </CameraProvider>
    </ServicesProvider>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}

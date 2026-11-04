import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '../api/types';
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
import { ServicesProvider, useServices, type ServicesProviderProps } from './services';

function RequireAuth({ role, children }: { role?: Role; children: ReactNode }) {
  const { session, hasRole } = useServices();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (role && !hasRole(role))
    return (
      <p className="screen alert alert--error" role="alert">
        관리자만 쓸 수 있는 화면입니다.
      </p>
    );
  return <>{children}</>;
}

function Layout() {
  const { hasRole, logout } = useServices();
  const { snapshot } = useUploadQueue();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="topbar__home">
          반납 검사
        </Link>
        {snapshot.pending > 0 && (
          <span className="badge" title="뒤에서 올리는 원본 사진">
            원본 {snapshot.pending}
          </span>
        )}
        <nav>
          {hasRole('admin') && <Link to="/admin/qr">QR 출력</Link>}
          <button type="button" className="link" onClick={() => void logout()}>
            로그아웃
          </button>
        </nav>
      </header>
      <main>
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
          path="admin/qr"
          element={
            <RequireAuth role="admin">
              <QrBatchPage />
            </RequireAuth>
          }
        />
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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { saveSession } from '../auth/tokenStore';
import { installFakeCamera } from '../test/fakeCamera';
import { pretendVideoReady } from '../test/fakeDecoder';
import { createFakeServer, fail, ok } from '../test/fakeServer';
import { adminSession, staffSession } from '../test/render';
import { App, AppProviders, AppRoutes } from './App';
import { ServicesProvider, useServices } from './services';

beforeEach(() => {
  pretendVideoReady();
  installFakeCamera();
});

function renderApp(
  path: string,
  server: ReturnType<typeof createFakeServer>,
  session = staffSession as typeof staffSession | null,
) {
  return render(
    <AppProviders services={{ fetchFn: server.fetchFn, initialSession: session }}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('App 라우팅과 로그인', () => {
  it('로그인하지 않았으면 로그인 화면으로 보내고, 로그인하면 원래 화면으로 간다', async () => {
    const server = createFakeServer().on('POST', '/auth/login', {
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresIn: 1800,
      roles: ['staff'],
    });
    renderApp('/manual', server, null);
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: ' kim ' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('heading', { name: '자산 번호로 찾기' })).toBeInTheDocument();
    expect(server.callsTo('POST', '/auth/login')[0].body).toEqual({ loginId: 'kim', password: 'pw' });
    expect(JSON.parse(localStorage.getItem('nr.session')!).accessToken).toBe('a');
  });

  it('데모 계정 admin / admin이 미리 채워져 있어 버튼만 누르면 로그인된다', async () => {
    const server = createFakeServer().on('POST', '/auth/login', {
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresIn: 1800,
      roles: ['staff', 'admin'],
    });
    renderApp('/login', server, null);
    expect(screen.getByLabelText('아이디')).toHaveValue('admin');
    expect(screen.getByLabelText('비밀번호')).toHaveValue('admin');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('link', { name: '관리' })).toBeInTheDocument();
    expect(server.callsTo('POST', '/auth/login')[0].body).toEqual({ loginId: 'admin', password: 'admin' });
  });

  it('로그인 실패 메시지를 보여 준다', async () => {
    const server = createFakeServer().on(
      'POST',
      '/auth/login',
      fail(401, -1004, '아이디 또는 비밀번호가 틀렸습니다.'),
    );
    renderApp('/login', server, null);
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'kim' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByText('아이디 또는 비밀번호가 틀렸습니다.')).toBeInTheDocument();
  });

  it('직원은 관리자 화면을 볼 수 없고 메뉴에도 없다', async () => {
    renderApp('/admin/qr', createFakeServer());
    expect(await screen.findByText('관리자만 쓸 수 있는 화면입니다.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '관리' })).toBeNull();
  });

  it('관리자는 관리 메뉴에서 각 관리 화면으로 들어갈 수 있다', async () => {
    renderApp('/', createFakeServer(), adminSession);
    fireEvent.click(await screen.findByRole('link', { name: '관리' }));
    expect(await screen.findByRole('heading', { name: '관리 홈' })).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: '관리 메뉴' });
    fireEvent.click(within(menu).getByRole('link', { name: '자산 번호 라벨' }));
    expect(await screen.findByRole('heading', { name: '자산 번호 라벨' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('link', { name: '노트북' }));
    expect(await screen.findByRole('heading', { name: '노트북' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('link', { name: '모델·촬영 컷' }));
    expect(await screen.findByRole('heading', { name: '모델·촬영 컷' })).toBeInTheDocument();
  });

  it('모르는 주소는 첫 화면으로 보내고, 로그아웃하면 로그인 화면으로 간다', async () => {
    const server = createFakeServer().on('POST', '/auth/logout', fail(500, -1099, 'x'));
    renderApp('/nowhere', server);
    expect(await screen.findByText(/자산 번호 라벨을 화면 안에 비춰/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument();
    expect(localStorage.getItem('nr.session')).toBeNull();
  });

  it('App은 저장된 세션을 읽어 BrowserRouter로 시작한다', async () => {
    saveSession(staffSession);
    window.history.pushState({}, '', '/manual');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '자산 번호로 찾기' })).toBeInTheDocument();
  });

  it('원본 업로드가 남아 있으면 상단에 개수를 보여 준다', async () => {
    const { testQueue } = await import('../test/render');
    const queue = testQueue({ put: () => new Promise(() => undefined) });
    const { UploadQueueProvider } = await import('../capture/UploadQueueProvider');
    const { CameraProvider } = await import('../camera/CameraProvider');
    render(
      <ServicesProvider fetchFn={createFakeServer().fetchFn} initialSession={staffSession}>
        <CameraProvider>
          <UploadQueueProvider queue={queue}>
            <MemoryRouter initialEntries={['/manual']}>
              <AppRoutes />
            </MemoryRouter>
          </UploadQueueProvider>
        </CameraProvider>
      </ServicesProvider>,
    );
    await queue.enqueue({ inspectionId: 1, photoId: 2, shotType: 'top', uploadUrl: 'u', blob: new Blob() });
    expect(await screen.findByText('원본 1')).toBeInTheDocument();
  });
});

describe('ServicesProvider 토큰 재발급', () => {
  function Probe() {
    const { endpoints, session, hasRole } = useServices();
    return (
      <div>
        <span data-testid="token">{session?.accessToken ?? 'none'}</span>
        <span data-testid="admin">{String(hasRole('admin'))}</span>
        <button
          onClick={() => void Promise.all([endpoints.scan('A'), endpoints.scan('B')]).catch(() => undefined)}
        >
          call
        </button>
      </div>
    );
  }

  it('동시에 401을 받아도 재발급은 한 번만 하고 새 토큰을 저장한다', async () => {
    const server = createFakeServer()
      .on('POST', '/auth/refresh', () =>
        ok({ accessToken: 'fresh', refreshToken: 'r2', accessTokenExpiresIn: 1800, roles: ['admin'] }),
      )
      .on('GET', '/scan/A', (c) =>
        c.headers.get('Authorization') === 'Bearer fresh' ? ok({}) : fail(401, -1005, '만료'),
      )
      .on('GET', '/scan/B', (c) =>
        c.headers.get('Authorization') === 'Bearer fresh' ? ok({}) : fail(401, -1005, '만료'),
      );
    render(
      <ServicesProvider fetchFn={server.fetchFn} initialSession={staffSession}>
        <Probe />
      </ServicesProvider>,
    );
    expect(screen.getByTestId('admin')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'call' }));
    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('fresh'));
    expect(server.callsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(server.callsTo('POST', '/auth/refresh')[0].body).toEqual({ refreshToken: 'refresh-1' });
    expect(screen.getByTestId('admin')).toHaveTextContent('true');
  });

  it('재발급이 실패하면 로그아웃 상태가 된다', async () => {
    const server = createFakeServer()
      .on('POST', '/auth/refresh', fail(401, -1004, 'x'))
      .on('GET', '/scan/A', fail(401, -1005, '만료'))
      .on('GET', '/scan/B', fail(401, -1005, '만료'));
    render(
      <ServicesProvider fetchFn={server.fetchFn} initialSession={staffSession}>
        <Probe />
      </ServicesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'call' }));
    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('none'));
  });

  it('세션이 없으면 재발급하지 않는다', async () => {
    const server = createFakeServer()
      .on('GET', '/scan/A', fail(401, -1004, 'x'))
      .on('GET', '/scan/B', fail(401, -1004, 'x'));
    render(
      <ServicesProvider fetchFn={server.fetchFn} initialSession={null}>
        <Probe />
      </ServicesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'call' }));
    await waitFor(() => expect(server.calls).toHaveLength(2));
    expect(server.callsTo('POST', '/auth/refresh')).toHaveLength(0);
  });

  it('Provider 밖에서 쓰면 오류', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('ServicesProvider');
    spy.mockRestore();
  });
});

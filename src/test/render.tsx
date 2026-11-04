import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppProviders } from '../app/App';
import type { Session } from '../auth/tokenStore';
import { OriginalUploadQueue, type PendingOriginal } from '../capture/uploadQueue';
import { memoryKvStore } from '../capture/kvStore';
import { UploadQueueProvider } from '../capture/UploadQueueProvider';
import { ServicesProvider } from '../app/services';
import { CameraProvider } from '../camera/CameraProvider';

export const staffSession: Session = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  roles: ['staff'],
  expiresAt: Date.now() + 1_800_000,
};
export const adminSession: Session = { ...staffSession, roles: ['staff', 'admin'] };

/** 지금 주소와 state를 화면에 찍어 두는 도우미. 이동 결과를 확인할 때 쓴다. */
export function LocationProbe() {
  const loc = useLocation();
  return (
    <pre data-testid="location">
      {JSON.stringify({ path: loc.pathname + loc.search, state: loc.state ?? null })}
    </pre>
  );
}

export function readLocation(container: HTMLElement): { path: string; state: unknown } {
  const el = container.querySelector('[data-testid="location"]');
  return JSON.parse(el?.textContent ?? '{}');
}

export interface RenderOptions {
  fetchFn: typeof fetch;
  session?: Session | null;
  path?: string;
  routePath?: string;
  state?: unknown;
  queue?: OriginalUploadQueue;
}

export function testQueue(overrides: Partial<ConstructorParameters<typeof OriginalUploadQueue>[0]> = {}) {
  return new OriginalUploadQueue({
    store: memoryKvStore<PendingOriginal>(),
    put: async () => new Response(null, { status: 200 }),
    confirm: async () => null,
    sleep: async () => undefined,
    ...overrides,
  });
}

/** 화면 하나를 앱과 같은 Provider 안에서 그린다. */
export function renderScreen(ui: ReactNode, opts: RenderOptions) {
  const path = opts.path ?? '/';
  return render(
    <ServicesProvider
      fetchFn={opts.fetchFn}
      initialSession={opts.session === undefined ? staffSession : opts.session}
    >
      <CameraProvider>
        <UploadQueueProvider queue={opts.queue ?? testQueue()}>
          <MemoryRouter
            initialEntries={[
              {
                pathname: path.split('?')[0],
                search: path.includes('?') ? '?' + path.split('?')[1] : '',
                state: opts.state,
              },
            ]}
          >
            <Routes>
              <Route path={opts.routePath ?? path.split('?')[0]} element={ui} />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </UploadQueueProvider>
      </CameraProvider>
    </ServicesProvider>,
  );
}

export { AppProviders };

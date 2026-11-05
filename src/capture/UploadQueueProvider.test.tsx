import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../app/services';
import { sessionFromTokens } from '../auth/tokenStore';
import { createFakeServer, ok } from '../test/fakeServer';
import { UploadQueueProvider, useUploadQueue } from './UploadQueueProvider';

const session = sessionFromTokens({
  accessToken: 'a',
  refreshToken: 'r',
  accessTokenExpiresIn: 1800,
  roles: ['staff'],
});

function Probe() {
  const { queue, snapshot } = useUploadQueue();
  return (
    <div>
      <span data-testid="pending">{snapshot.pending}</span>
      <button
        onClick={() =>
          void queue.enqueue({
            inspectionId: 1,
            photoId: 2,
            shotType: 'top',
            uploadUrl: 'https://storage.test/put',
            blob: new Blob(['original']),
          })
        }
      >
        add
      </button>
    </div>
  );
}

function renderWith(server: ReturnType<typeof createFakeServer>) {
  // jsdom의 Blob은 fake-indexeddb를 거치면 Blob이 아니게 되어, 여기서는 메모리 보관함을 쓴다.
  vi.stubGlobal('indexedDB', undefined);
  render(
    <ServicesProvider fetchFn={server.fetchFn} initialSession={session}>
      <UploadQueueProvider>
        <Probe />
      </UploadQueueProvider>
    </ServicesProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('UploadQueueProvider', () => {
  it('원본은 서버를 거쳐 올린다(저장소 주소로 바로 PUT하지 않는다)', async () => {
    const direct = vi.fn();
    vi.stubGlobal('fetch', direct);
    const server = createFakeServer()
      .on('POST', '/inspections/1/photos/2/original/content', ok(null))
      .on('POST', '/inspections/1/photos/2/original', ok(null));
    renderWith(server);
    screen.getByRole('button', { name: 'add' }).click();
    await waitFor(() => expect(server.callsTo('POST', '/inspections/1/photos/2/original')).toHaveLength(1), {
      timeout: 8000,
    });
    const call = server.callsTo('POST', '/inspections/1/photos/2/original/content')[0];
    expect((call.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(direct).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('0'));
  });

  it('서버가 아직 이 기능을 모르면(404) 예전처럼 서명 URL로 PUT한다', async () => {
    const direct = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', direct);
    const server = createFakeServer().on('POST', '/inspections/1/photos/2/original', ok(null));
    renderWith(server);
    screen.getByRole('button', { name: 'add' }).click();
    await waitFor(() => expect(server.callsTo('POST', '/inspections/1/photos/2/original')).toHaveLength(1), {
      timeout: 8000,
    });
    expect(direct).toHaveBeenCalledWith(
      'https://storage.test/put',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('그 밖의 오류는 큐에 남겨 다시 시도한다', async () => {
    const server = createFakeServer().on('POST', '/inspections/1/photos/2/original/content', () => {
      throw new TypeError('Load failed');
    });
    renderWith(server);
    screen.getByRole('button', { name: 'add' }).click();
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('1'));
  });
});

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer, fail } from '../test/fakeServer';
import { renderScreen } from '../test/render';
import { PhotoGallery } from './PhotoGallery';

const jpeg = () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' }), { status: 200 });

beforeEach(() => {
  let n = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() }),
  );
});
afterEach(() => vi.restoreAllMocks());

describe('PhotoGallery', () => {
  function serverWith(photos: object[]) {
    return createFakeServer().on('GET', '/inspections/31', {
      id: 31,
      kind: 'register',
      status: 'completed',
      requiredShots: ['top', 'hinge', 'screen_off'],
      capturedShots: ['top', 'hinge'],
      photos,
    });
  }

  it('컷 순서대로 작은 사진을 서버를 거쳐 받아 보여 주고, 없는 컷은 없음으로 둔다', async () => {
    const server = serverWith([
      { id: 1, shotType: 'top', originalConfirmed: true },
      { id: 2, shotType: 'hinge', originalConfirmed: false },
    ])
      .on('GET', '/inspections/31/photos/1/image', jpeg)
      .on('GET', '/inspections/31/photos/2/image', jpeg);
    renderScreen(<PhotoGallery inspectionId={31} title="기준 사진" />, { fetchFn: server.fetchFn });

    expect(await screen.findByRole('button', { name: '상판 사진 크게 보기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '힌지 면 사진 크게 보기' })).toBeInTheDocument();
    expect(screen.getByText('없음')).toBeInTheDocument();
    await waitFor(() => expect(server.callsTo('GET', '/inspections/31/photos/2/image')).toHaveLength(1));
    // 저장소 주소가 아니라 서버(인증 헤더)를 거친다
    expect(server.callsTo('GET', '/inspections/31/photos/1/image')[0].headers.get('Authorization')).toBe(
      'Bearer access-1',
    );
  });

  it('누르면 크게 보고, 원본이 도착한 사진은 원본으로 바꿔 볼 수 있다. Esc로 닫는다', async () => {
    const server = serverWith([
      { id: 1, shotType: 'top', originalConfirmed: true },
      { id: 2, shotType: 'hinge', originalConfirmed: false },
    ])
      .on('GET', '/inspections/31/photos/1/image', jpeg)
      .on('GET', '/inspections/31/photos/1/image?variant=original', jpeg)
      .on('GET', '/inspections/31/photos/2/image', jpeg);
    renderScreen(<PhotoGallery inspectionId={31} title="기준 사진" />, { fetchFn: server.fetchFn });

    fireEvent.click(await screen.findByRole('button', { name: '상판 사진 크게 보기' }));
    const dialog = screen.getByRole('dialog', { name: '상판 사진' });
    expect(await screen.findByAltText('상판 사진')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '원본 보기' }));
    await waitFor(() =>
      expect(server.callsTo('GET', '/inspections/31/photos/1/image?variant=original')).toHaveLength(1),
    );
    expect(screen.getByRole('button', { name: '작은 사진 보기' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog).not.toBeInTheDocument();

    // 원본이 아직 없으면 원본 보기 버튼이 없다. 닫기 버튼으로 닫는다
    fireEvent.click(screen.getByRole('button', { name: '힌지 면 사진 크게 보기' }));
    expect(screen.queryByRole('button', { name: '원본 보기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('사진을 못 받으면 그 자리에 알리고, 검사를 못 읽으면 오류를 보여 준다', async () => {
    const server = serverWith([{ id: 1, shotType: 'top' }]).on(
      'GET',
      '/inspections/31/photos/1/image',
      fail(404, -1002, '사진 파일을 찾을 수 없습니다.'),
    );
    const r = renderScreen(<PhotoGallery inspectionId={31} title="기준 사진" />, { fetchFn: server.fetchFn });
    expect(await screen.findByText('사진을 못 불러왔어요')).toBeInTheDocument();
    r.unmount();

    renderScreen(<PhotoGallery inspectionId={99} title="기준 사진" />, { fetchFn: server.fetchFn });
    expect(await screen.findByRole('alert')).toHaveTextContent('테스트 핸들러 없음');
  });
});

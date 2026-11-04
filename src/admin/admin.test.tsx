import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer, fail, list, ok } from '../test/fakeServer';
import { adminSession, readLocation, renderScreen } from '../test/render';
import { QrBatchPage } from '../devices/QrBatchPage';
import { AdminHome } from './AdminHome';
import { DeviceListPage } from './DeviceListPage';
import { formatDate } from './format';
import { ModelsPage } from './ModelsPage';

const QR = 'NR1:7K3M9QX2TD';
const enc = encodeURIComponent(QR);
const model = { id: 1, manufacturer: 'LG', name: 'gram 16' };

function summary(id: number, assetNo: string, extra: object = {}) {
  return {
    id,
    assetNo,
    serialNo: `SN${id}`,
    qrValue: QR,
    status: 'available',
    model,
    lastInspectedAt: '2026-11-04T05:30:00Z',
    ...extra,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('AdminHome', () => {
  function open(server = createFakeServer()) {
    return {
      server,
      ...renderScreen(<AdminHome />, { fetchFn: server.fetchFn, session: adminSession, path: '/admin' }),
    };
  }

  it('노트북·모델·QR 묶음 수를 보여 주고, 못 불러온 숫자는 – 로 둔다', async () => {
    const server = createFakeServer()
      .on('GET', '/devices?page=0&size=1', ok([summary(1, 'A-1')], 200, 42))
      .on('GET', '/device-models', list([model, { ...model, id: 2 }]));
    open(server);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
    const tile = screen.getByRole('link', { name: /QR 스티커 묶음/ });
    expect(tile).toHaveTextContent('–');
    expect(screen.getByRole('link', { name: /등록된 노트북/ })).toHaveAttribute('href', '/admin/devices');
  });

  it('QR 값을 직접 넣어 등록을 시작하면 등록 화면으로 간다', async () => {
    const server = createFakeServer().on('GET', `/scan/${enc}`, {
      qrValue: QR,
      qrStatus: 'unassigned',
      nextAction: 'register',
    });
    const { container } = open(server);
    const input = screen.getByLabelText(/QR 값을 직접 입력/);
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: '등록 시작' }));
    expect(await screen.findByText(/형식이 올바르지 않습니다/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: ` ${QR.toLowerCase()} ` } });
    fireEvent.click(screen.getByRole('button', { name: '등록 시작' }));
    await waitFor(() => expect(readLocation(container).path).toBe(`/register?qr=${enc}`));
  });

  it('폐기된 QR, 발급하지 않은 QR, 그 밖의 오류를 알려 준다', async () => {
    let n = 0;
    const server = createFakeServer().on('GET', `/scan/${enc}`, () => {
      n += 1;
      if (n === 1) return ok({ qrValue: QR, qrStatus: 'void', nextAction: 'blocked' });
      if (n === 2) return fail(404, -2001, '없음');
      return fail(500, -1099, '서버 오류');
    });
    open(server);
    fireEvent.change(screen.getByLabelText(/QR 값을 직접 입력/), { target: { value: QR } });
    const go = screen.getByRole('button', { name: '등록 시작' });
    fireEvent.click(go);
    expect(await screen.findByText('폐기된 QR입니다. 새 QR을 붙여 주세요.')).toBeInTheDocument();
    fireEvent.click(go);
    expect(await screen.findByText('이 시스템에서 발급한 QR이 아닙니다.')).toBeInTheDocument();
    fireEvent.click(go);
    expect(await screen.findByText('서버 오류')).toBeInTheDocument();
  });
});

describe('DeviceListPage', () => {
  function open(server: ReturnType<typeof createFakeServer>) {
    return renderScreen(<DeviceListPage />, {
      fetchFn: server.fetchFn,
      session: adminSession,
      path: '/admin/devices',
    });
  }

  it('목록을 보여 주고 검색어로 다시 찾는다', async () => {
    const server = createFakeServer()
      .on(
        'GET',
        '/devices?page=0&size=20',
        ok(
          [
            summary(1, 'A-1'),
            summary(2, 'A-2', { status: 'rented', model: undefined, lastInspectedAt: null }),
          ],
          200,
          2,
        ),
      )
      .on('GET', '/devices?q=gram&page=0&size=20', ok([], 200, 0));
    open(server);
    const rows = await screen.findByRole('list', { name: '노트북 목록' });
    expect(within(rows).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('총 2대')).toBeInTheDocument();
    expect(screen.getByText('LG gram 16 · SN1')).toBeInTheDocument();
    expect(screen.getByText('모델 정보 없음 · SN2')).toBeInTheDocument();
    expect(screen.getByText('대여 중')).toBeInTheDocument();
    expect(screen.getByText('최근 검사 –')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('노트북 검색'), { target: { value: ' gram ' } });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    expect(await screen.findByText('"gram"에 맞는 노트북이 없습니다.')).toBeInTheDocument();
  });

  it('여러 쪽이면 이전·다음으로 넘긴다', async () => {
    const page0 = Array.from({ length: 20 }, (_, i) => summary(i + 1, `A-${i + 1}`));
    const server = createFakeServer()
      .on('GET', '/devices?page=0&size=20', ok(page0, 200, 25))
      .on('GET', '/devices?page=1&size=20', ok([summary(21, 'A-21')], 200, 25));
    open(server);
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '이전' }));
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
  });

  it('한 줄을 누르면 자산 번호로 조회해 노트북 화면으로 간다', async () => {
    const scan = { qrStatus: 'assigned', nextAction: 'none', device: summary(1, 'A-1') };
    const server = createFakeServer()
      .on('GET', '/devices?page=0&size=20', ok([summary(1, 'A-1')], 200, 1))
      .on('GET', '/devices/by-asset/A-1', scan);
    const { container } = open(server);
    fireEvent.click(await screen.findByRole('button', { name: /A-1/ }));
    await waitFor(() => expect(readLocation(container).path).toBe('/device'));
    expect(readLocation(container).state).toMatchObject({ identifiedBy: 'manual', scan });
  });

  it('노트북을 열지 못하면 오류를 보여 준다', async () => {
    const server = createFakeServer()
      .on('GET', '/devices?page=0&size=20', ok([summary(1, 'A-1')], 200, 1))
      .on('GET', '/devices/by-asset/A-1', fail(500, -1099, '조회 실패'));
    open(server);
    fireEvent.click(await screen.findByRole('button', { name: /A-1/ }));
    expect(await screen.findByText('조회 실패')).toBeInTheDocument();
  });

  it('서버에 목록 기능이 아직 없으면 안내하고, 다른 오류는 그대로 보여 준다', async () => {
    open(createFakeServer());
    expect(await screen.findByText(/아직 노트북 목록 기능이 없습니다/)).toBeInTheDocument();
  });

  it('목록 오류 메시지를 보여 주고, 비어 있으면 빈 화면 안내를 한다', async () => {
    const server = createFakeServer().on('GET', '/devices?page=0&size=20', fail(500, -1099, '목록 오류'));
    open(server);
    expect(await screen.findByText('목록 오류')).toBeInTheDocument();

    const empty = createFakeServer().on('GET', '/devices?page=0&size=20', ok([], 200, 0));
    open(empty);
    expect(await screen.findByText('아직 등록된 노트북이 없습니다.')).toBeInTheDocument();
  });
});

describe('ModelsPage', () => {
  function open(server: ReturnType<typeof createFakeServer>) {
    return renderScreen(<ModelsPage />, {
      fetchFn: server.fetchFn,
      session: adminSession,
      path: '/admin/models',
    });
  }

  it('모델과 모델별 촬영 컷을 보여 준다', async () => {
    const server = createFakeServer().on(
      'GET',
      '/device-models',
      list([
        {
          ...model,
          shots: [
            { shotType: 'bottom', name: '하판', sortOrder: 2 },
            { shotType: 'top', name: '', sortOrder: 1 },
          ],
        },
        { id: 2, manufacturer: 'Samsung', name: 'Book4' },
      ]),
    );
    open(server);
    const chips = await screen.findByRole('list', { name: 'gram 16 촬영 컷' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['상판', '하판']);
    expect(
      within(screen.getByRole('list', { name: 'Book4 촬영 컷' })).getByText('기본 8컷'),
    ).toBeInTheDocument();
    expect(screen.getByText('등록된 모델 2종')).toBeInTheDocument();
  });

  it('컷을 골라 새 모델을 추가하면 목록에 붙는다', async () => {
    const server = createFakeServer()
      .on('GET', '/device-models', list([]))
      .on('POST', '/device-models', (call) => ok({ id: 9, ...(call.body as object) }, 201));
    open(server);
    expect(await screen.findByText(/첫 모델을 추가하세요/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('제조사'), { target: { value: ' LG ' } });
    fireEvent.change(screen.getByLabelText('모델 이름'), { target: { value: 'gram 14' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '키보드·팜레스트' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '꺼진 화면' }));
    expect(screen.getByText('촬영 컷 (6/8)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '꺼진 화면' }));
    fireEvent.click(screen.getByRole('button', { name: '모델 추가' }));
    expect(await screen.findByText('LG gram 14 모델을 추가했습니다.')).toBeInTheDocument();
    expect(server.callsTo('POST', '/device-models')[0].body).toEqual({
      manufacturer: 'LG',
      name: 'gram 14',
      shots: ['top', 'bottom', 'left', 'right', 'hinge', 'front', 'screen_off'],
    });
    expect(screen.getByText('gram 14')).toBeInTheDocument();
    expect(screen.getByLabelText('제조사')).toHaveValue('');
  });

  it('추가 실패와 목록 실패를 알려 준다', async () => {
    const server = createFakeServer()
      .on('GET', '/device-models', fail(500, -1099, '목록 실패'))
      .on('POST', '/device-models', fail(409, -1005, '같은 이름의 노트북 모델이 이미 있습니다.'));
    open(server);
    expect(await screen.findByText('목록 실패')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('제조사'), { target: { value: 'LG' } });
    fireEvent.change(screen.getByLabelText('모델 이름'), { target: { value: 'gram' } });
    fireEvent.click(screen.getByRole('button', { name: '모델 추가' }));
    expect(await screen.findByText('같은 이름의 노트북 모델이 이미 있습니다.')).toBeInTheDocument();
  });
});

describe('QrBatchPage 지난 묶음', () => {
  it('지난 묶음을 보여 주고 PDF를 다시 받는다. 새로 발급한 묶음은 맨 위에 붙는다', async () => {
    const server = createFakeServer()
      .on(
        'GET',
        '/qr-batches?page=0&size=20',
        list([{ id: 1, count: 10, createdAt: '2026-11-01T01:00:00Z' }]),
      )
      .on('POST', '/qr-batches', { id: 2, count: 5 })
      .on('GET', '/qr-batches/1/labels.pdf', () => new Response('%PDF', { status: 200 }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderScreen(<QrBatchPage />, { fetchFn: server.fetchFn, session: adminSession, path: '/admin/qr' });
    const history = await screen.findByRole('list', { name: '지난 QR 묶음' });
    expect(within(history).getByText('묶음 #1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '묶음 #1 PDF' }));
    await waitFor(() => expect(click).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '빈 QR 발급' }));
    await screen.findByText('묶음 #2: 5장 발급됨');
    const names = within(history)
      .getAllByText(/^묶음 #/)
      .map((e) => e.textContent);
    expect(names).toEqual(['묶음 #2', '묶음 #1']);
  });
});

describe('formatDate', () => {
  it('값이 없거나 날짜가 아니면 – 를 돌려준다', () => {
    expect(formatDate(null)).toBe('–');
    expect(formatDate('nope')).toBe('–');
    expect(formatDate('2026-11-04T05:30:00')).toBe('2026.11.04 05:30');
  });
});

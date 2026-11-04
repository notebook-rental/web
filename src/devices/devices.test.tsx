import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeCamera } from '../test/fakeCamera';
import { fakeDecoderFactory, pretendVideoReady } from '../test/fakeDecoder';
import { createFakeServer, fail, list } from '../test/fakeServer';
import { adminSession, readLocation, renderScreen } from '../test/render';
import { DevicePage } from './DevicePage';
import { QrBatchPage } from './QrBatchPage';
import { RegisterPage } from './RegisterPage';

const QR = 'NR1:7K3M9QX2TD';
const enc = encodeURIComponent(QR);
const device = { id: 5, assetNo: 'A-001', serialNo: 'S1', qrValue: QR, status: 'available' as const };

beforeEach(() => {
  pretendVideoReady();
  installFakeCamera();
});
afterEach(() => vi.restoreAllMocks());

describe('DevicePage', () => {
  function open(scan: object, extra: object = {}) {
    const server = createFakeServer();
    const r = renderScreen(<DevicePage />, {
      fetchFn: server.fetchFn,
      path: '/device',
      state: { scan, identifiedBy: 'qr', scannedQrValue: QR, ...extra },
    });
    return { server, ...r };
  }

  it('스캔 결과 없이 들어오면 첫 화면으로 돌려보낸다', () => {
    const { container } = renderScreen(<DevicePage />, {
      fetchFn: createFakeServer().fetchFn,
      path: '/device',
    });
    expect(readLocation(container).path).toBe('/');
  });

  it('대여 대기 건이면 대여 촬영 시작 → 촬영 화면으로 필요한 정보를 넘긴다', () => {
    const { container } = open({
      nextAction: 'checkout',
      qrStatus: 'assigned',
      device,
      rentalId: 9,
      requiredShots: ['top', 'bottom'],
      existingDamages: [],
    });
    expect(screen.getByText('대여 가능')).toBeInTheDocument();
    expect(screen.getByText('확정된 손상이 없습니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '대여 촬영 시작' }));
    expect(readLocation(container)).toEqual({
      path: '/capture',
      state: {
        kind: 'checkout',
        rentalId: 9,
        identifiedBy: 'qr',
        scannedQrValue: QR,
        requiredShots: ['top', 'bottom'],
        deviceLabel: 'A-001',
      },
    });
  });

  it('진행 중인 반납 검사가 있으면 이어서 하기, 기존 손상을 보여 준다', () => {
    open({
      nextAction: 'checkin',
      qrStatus: 'assigned',
      device: { ...device, status: 'rented' },
      rentalId: 9,
      inspectionId: 77,
      existingDamages: [
        {
          id: 1,
          rentalId: 2,
          shotType: 'top',
          damageType: 'scratch',
          severity: 'minor',
          geometry: { type: 'box', coords: [0, 0, 1, 1] },
          afterPhotoUrl: 'https://img/1.jpg',
        },
      ],
    });
    expect(screen.getByRole('button', { name: '반납 촬영 이어서 하기' })).toBeInTheDocument();
    expect(screen.getByText('기존 손상 1건')).toBeInTheDocument();
    expect(screen.getByText(/상판 · 스크래치 · 경미/)).toBeInTheDocument();
  });

  it('진행할 일이 없고 대여 가능하면 대여 대기 건을 만들고 다시 조회한다', async () => {
    const { server } = open({ nextAction: 'none', qrStatus: 'assigned', device });
    server.on('POST', '/rentals', { id: 1 });
    server.on('GET', `/scan/${enc}`, { nextAction: 'checkout', qrStatus: 'assigned', device, rentalId: 1 });
    expect(screen.getByText(/진행할 대여·반납이 없습니다/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/고객 참조 번호/), { target: { value: 'C-1' } });
    fireEvent.click(screen.getByRole('button', { name: '대여 대기 건 만들기' }));
    expect(await screen.findByRole('button', { name: '대여 촬영 시작' })).toBeInTheDocument();
    expect(server.callsTo('POST', '/rentals')[0].body).toEqual({ deviceId: 5, customerRef: 'C-1' });
  });

  it('자산 번호로 찾은 경우 다시 조회도 자산 번호로 하고, 실패를 알린다', async () => {
    const { server } = open(
      { nextAction: 'none', qrStatus: 'assigned', device },
      { identifiedBy: 'manual', scannedQrValue: undefined },
    );
    expect(screen.getByText('자산 번호 직접 입력')).toBeInTheDocument();
    server.on('POST', '/rentals', fail(409, -1, '이미 대여 대기 건이 있습니다.'));
    fireEvent.change(screen.getByLabelText(/고객 참조 번호/), { target: { value: 'C-1' } });
    fireEvent.click(screen.getByRole('button', { name: '대여 대기 건 만들기' }));
    expect(await screen.findByText('이미 대여 대기 건이 있습니다.')).toBeInTheDocument();
    server.on('POST', '/rentals', { id: 2 });
    server.on('GET', '/devices/by-asset/A-001', {
      nextAction: 'checkout',
      qrStatus: 'assigned',
      device,
      rentalId: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: '대여 대기 건 만들기' }));
    expect(await screen.findByRole('button', { name: '대여 촬영 시작' })).toBeInTheDocument();
  });

  it('대여 중이 아닌 다른 상태에서는 대여 건 만들기를 보이지 않는다', () => {
    open({ nextAction: 'none', qrStatus: 'assigned', device: { ...device, status: 'repair' } });
    expect(screen.getByText('수리 중')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '대여 대기 건 만들기' })).toBeNull();
  });
});

describe('RegisterPage', () => {
  const models = [
    { id: 1, manufacturer: 'LG', name: 'gram 16' },
    { id: 2, manufacturer: 'Apple', name: 'MacBook Air' },
  ];

  it('QR 값이 잘못되면 안내한다', () => {
    renderScreen(<RegisterPage />, {
      fetchFn: createFakeServer().fetchFn,
      path: '/register?qr=bad',
      routePath: '/register',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('QR 값이 올바르지 않습니다');
  });

  it('모델을 고르고 저장하면 등록 후 노트북 화면으로 간다', async () => {
    const server = createFakeServer()
      .on('GET', '/device-models', list(models))
      .on('POST', '/devices', device)
      .on('GET', `/scan/${enc}`, { nextAction: 'none', qrStatus: 'assigned', device });
    const { container } = renderScreen(<RegisterPage />, {
      fetchFn: server.fetchFn,
      path: `/register?qr=${enc}`,
      routePath: '/register',
    });
    expect(screen.getByText(QR)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull(); // 직원은 QR 교체 탭이 없다
    await screen.findByRole('option', { name: 'LG gram 16' });
    fireEvent.change(screen.getByLabelText('노트북 모델'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('자산 번호'), { target: { value: 'A-9' } });
    fireEvent.change(screen.getByLabelText('시리얼 번호'), { target: { value: 'SN9' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(readLocation(container).path).toBe('/device'));
    expect(server.callsTo('POST', '/devices')[0].body).toEqual({
      qrValue: QR,
      deviceModelId: 2,
      assetNo: 'A-9',
      serialNo: 'SN9',
    });
  });

  it('모델이 하나면 자동 선택하고, 등록됨·폐기 QR 오류를 보여 준다', async () => {
    let n = 0;
    const server = createFakeServer()
      .on('GET', '/device-models', list([models[0]]))
      .on(
        'POST',
        '/devices',
        () =>
          [
            fail(409, -2003, 'x'),
            fail(409, -2004, 'x'),
            fail(400, -1001, '입력값 오류'),
            new Response('x', { status: 500 }),
          ][n++],
      );
    renderScreen(<RegisterPage />, {
      fetchFn: server.fetchFn,
      path: `/register?qr=${enc}`,
      routePath: '/register',
    });
    await waitFor(() => expect(screen.getByLabelText('노트북 모델')).toHaveValue('1'));
    fireEvent.change(screen.getByLabelText('자산 번호'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('시리얼 번호'), { target: { value: 'S' } });
    const save = () => fireEvent.click(screen.getByRole('button', { name: '등록' }));
    save();
    expect(await screen.findByText('이미 다른 노트북에 등록된 QR입니다.')).toBeInTheDocument();
    save();
    expect(await screen.findByText('폐기된 QR입니다. 새 QR을 붙여 주세요.')).toBeInTheDocument();
    save();
    expect(await screen.findByText('입력값 오류')).toBeInTheDocument();
    save();
    expect(await screen.findByText(/HTTP 500/)).toBeInTheDocument();
  });

  it('모델 목록을 못 불러오면 알린다', async () => {
    const server = createFakeServer().on('GET', '/device-models', fail(500, -1099, '목록 오류'));
    renderScreen(<RegisterPage />, {
      fetchFn: server.fetchFn,
      path: `/register?qr=${enc}`,
      routePath: '/register',
    });
    expect(await screen.findByText('목록 오류')).toBeInTheDocument();
  });

  it('시리얼 바코드를 읽어 채운다(QR 값은 건너뛴다)', async () => {
    const server = createFakeServer().on('GET', '/device-models', list(models));
    const { factory } = fakeDecoderFactory([[QR], [QR, ' SN-777 ']]);
    renderScreen(<RegisterPage decoderFactory={factory} />, {
      fetchFn: server.fetchFn,
      path: `/register?qr=${enc}`,
      routePath: '/register',
    });
    fireEvent.click(screen.getByRole('button', { name: '바코드로 읽기' }));
    expect(screen.getByRole('dialog', { name: '시리얼 바코드 스캔' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('시리얼 번호')).toHaveValue('SN-777'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '바코드로 읽기' }));
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('관리자는 기존 노트북에 새 QR을 다시 붙일 수 있다(FR-048)', async () => {
    const server = createFakeServer()
      .on('GET', '/device-models', list(models))
      .on('GET', '/devices/by-asset/A-001', {
        nextAction: 'none',
        qrStatus: 'assigned',
        device: { ...device, qrValue: 'NR1:OLD0000000' },
      })
      .on('PUT', '/devices/5/qr', device)
      .on('GET', `/scan/${enc}`, { nextAction: 'none', qrStatus: 'assigned', device });
    const { container } = renderScreen(<RegisterPage />, {
      fetchFn: server.fetchFn,
      session: adminSession,
      path: `/register?qr=${enc}`,
      routePath: '/register',
    });
    fireEvent.click(screen.getByRole('tab', { name: '기존 노트북에 다시 붙이기' }));
    fireEvent.change(screen.getByLabelText(/자산 번호/), { target: { value: 'A-001' } });
    fireEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByText(/NR1:OLD0000000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '이 노트북에 새 QR 붙이기' }));
    await waitFor(() => expect(readLocation(container).path).toBe('/device'));
    expect(server.callsTo('PUT', '/devices/5/qr')[0].body).toEqual({ qrValue: QR });
  });

  it('QR 교체: 없는 자산 번호, 교체 실패를 알리고 신규 탭으로 돌아갈 수 있다', async () => {
    let n = 0;
    const server = createFakeServer()
      .on('GET', '/device-models', list(models))
      .on('GET', '/devices/by-asset/Z', () =>
        ++n === 1 ? fail(404, -1002, 'x') : fail(403, -1003, '권한 없음'),
      )
      .on('GET', '/devices/by-asset/A-001', { nextAction: 'none', qrStatus: 'assigned', device })
      .on('PUT', '/devices/5/qr', fail(409, -2003, 'x'));
    renderScreen(<RegisterPage />, {
      fetchFn: server.fetchFn,
      session: adminSession,
      path: `/register?qr=${enc}`,
      routePath: '/register',
    });
    fireEvent.click(screen.getByRole('tab', { name: '기존 노트북에 다시 붙이기' }));
    const input = screen.getByLabelText(/자산 번호/);
    fireEvent.change(input, { target: { value: 'Z' } });
    fireEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByText('그 자산 번호의 노트북이 없습니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByText('권한 없음')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'A-001' } });
    fireEvent.click(screen.getByRole('button', { name: '찾기' }));
    fireEvent.click(await screen.findByRole('button', { name: '이 노트북에 새 QR 붙이기' }));
    expect(await screen.findByText('이미 다른 노트북에 등록된 QR입니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '신규 노트북' }));
    expect(screen.getByLabelText('노트북 모델')).toBeInTheDocument();
  });
});

describe('QrBatchPage', () => {
  it('묶음을 발급하고 PDF를 내려받는다', async () => {
    const server = createFakeServer()
      .on('POST', '/qr-batches', { id: 3, count: 40 })
      .on('GET', '/qr-batches/3/labels.pdf', () => new Response('%PDF', { status: 200 }));
    const createObjectURL = vi.fn(() => 'blob:1');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderScreen(<QrBatchPage />, { fetchFn: server.fetchFn, session: adminSession });
    fireEvent.change(screen.getByLabelText(/장 수/), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: '빈 QR 발급' }));
    expect(await screen.findByText('묶음 #3: 40장 발급됨')).toBeInTheDocument();
    expect(server.callsTo('POST', '/qr-batches')[0].body).toEqual({ count: 40 });
    fireEvent.click(screen.getByRole('button', { name: '스티커 PDF 내려받기' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('발급·다운로드 실패를 알린다', async () => {
    let n = 0;
    const server = createFakeServer()
      .on('POST', '/qr-batches', () =>
        ++n === 1
          ? fail(400, -1001, '최대 500장')
          : new Response(
              JSON.stringify({
                header: { isSuccessful: true, resultCode: 0, resultMessage: '' },
                result: { id: 4, count: 1 },
              }),
            ),
      )
      .on('GET', '/qr-batches/4/labels.pdf', fail(404, -1002, 'PDF 없음'));
    renderScreen(<QrBatchPage />, { fetchFn: server.fetchFn, session: adminSession });
    fireEvent.click(screen.getByRole('button', { name: '빈 QR 발급' }));
    expect(await screen.findByText('최대 500장')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '빈 QR 발급' }));
    fireEvent.click(await screen.findByRole('button', { name: '스티커 PDF 내려받기' }));
    expect(await screen.findByText('PDF 없음')).toBeInTheDocument();
  });

  it('QR을 폐기하고, 형식이 틀리거나 실패하면 알린다', async () => {
    let n = 0;
    const server = createFakeServer().on('POST', `/qr-tags/${enc}/void`, () =>
      ++n === 1
        ? new Response(
            JSON.stringify({
              header: { isSuccessful: true, resultCode: 0, resultMessage: '' },
              result: null,
            }),
          )
        : fail(404, -2001, '발급한 QR이 아닙니다.'),
    );
    renderScreen(<QrBatchPage />, { fetchFn: server.fetchFn, session: adminSession });
    const input = screen.getByLabelText('QR 값');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '폐기' }));
    expect(await screen.findByRole('status')).toHaveTextContent('형식이 올바르지 않습니다');
    fireEvent.change(input, { target: { value: QR.toLowerCase() } });
    fireEvent.click(screen.getByRole('button', { name: '폐기' }));
    expect(await screen.findByText(`${QR}을(를) 폐기했습니다.`)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: QR } });
    fireEvent.click(screen.getByRole('button', { name: '폐기' }));
    expect(await screen.findByText('발급한 QR이 아닙니다.')).toBeInTheDocument();
  });
});

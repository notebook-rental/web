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

  it('기준 사진을 아직 안 찍었으면 기준 사진 촬영으로 넘긴다(spec 002 US5)', () => {
    const { container } = open({ nextAction: 'none', qrStatus: 'assigned', device, registerPhotos: 'none' });
    expect(screen.getByText('아직 안 찍음')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /기준 사진 촬영 \(8컷\)/ }));
    expect(readLocation(container)).toEqual({
      path: '/capture',
      state: { kind: 'register', deviceId: 5, identifiedBy: 'qr', scannedQrValue: QR, deviceLabel: 'A-001' },
    });
  });

  it('찍는 중이면 이어서 찍고, 다 찍었거나 대여 중이면 버튼이 없다', () => {
    const { container, unmount } = open({
      nextAction: 'none',
      qrStatus: 'assigned',
      device,
      registerPhotos: 'capturing',
      registerInspectionId: 31,
    });
    expect(screen.getByText('찍는 중')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /기준 사진 이어서 찍기/ }));
    expect(readLocation(container).state).toMatchObject({ kind: 'register', inspectionId: 31 });
    unmount();

    const done = open({ nextAction: 'none', qrStatus: 'assigned', device, registerPhotos: 'completed' });
    expect(screen.getByText('찍음')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /기준 사진 (촬영|이어서)/ })).toBeNull();
    // 다 찍었으면 다시 찍을 수 있다(같은 검사를 다시 연다)
    fireEvent.click(screen.getByRole('button', { name: '기준 사진 다시 찍기' }));
    expect(readLocation(done.container)).toEqual({
      path: '/capture',
      state: {
        kind: 'register',
        deviceId: 5,
        identifiedBy: 'qr',
        scannedQrValue: QR,
        retake: true,
        deviceLabel: 'A-001',
      },
    });
    done.unmount();

    open({
      nextAction: 'checkin',
      qrStatus: 'assigned',
      device: { ...device, status: 'rented' },
      rentalId: 9,
      registerPhotos: 'none',
    });
    expect(screen.queryByRole('button', { name: /기준 사진/ })).toBeNull();
  });
});

describe('RegisterPage', () => {
  const models = [
    { id: 1, manufacturer: 'LG', name: 'gram 16' },
    { id: 2, manufacturer: 'Apple', name: 'MacBook Air' },
  ];

  it('라벨 값이 잘못되면 안내한다', () => {
    renderScreen(<RegisterPage />, {
      fetchFn: createFakeServer().fetchFn,
      path: '/register?qr=-bad',
      routePath: '/register',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('라벨 값이 올바르지 않습니다');
  });

  it('자산 번호 라벨이면 모델만 고르면 등록된다. 시리얼은 접혀 있고 비우면 보내지 않는다(spec 002)', async () => {
    const asset = 'NB26110001';
    const server = createFakeServer()
      .on('GET', '/device-models', list(models))
      .on('POST', '/devices', { ...device, assetNo: asset, serialNo: null })
      .on('GET', `/scan/${asset}`, { nextAction: 'none', qrStatus: 'assigned', device });
    const { container } = renderScreen(<RegisterPage />, {
      fetchFn: server.fetchFn,
      path: `/register?qr=${asset}`,
      routePath: '/register',
    });
    expect(screen.getByLabelText('자산 번호')).toHaveTextContent(asset);
    expect(screen.queryByRole('textbox', { name: '자산 번호' })).toBeNull();
    expect(screen.getByText('시리얼 번호 (선택)').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('tab')).toBeNull(); // QR 교체 탭은 없어졌다
    await screen.findByRole('option', { name: 'LG gram 16' });
    fireEvent.change(screen.getByLabelText('노트북 모델'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('시리얼 번호'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    // 등록하면 바로 기준 사진 8컷 촬영으로 넘어간다(spec 002 US5)
    await waitFor(() =>
      expect(readLocation(container)).toEqual({
        path: '/capture',
        state: {
          kind: 'register',
          deviceId: 5,
          identifiedBy: 'qr',
          scannedQrValue: asset,
          deviceLabel: 'A-001',
        },
      }),
    );
    expect(server.callsTo('POST', '/devices')[0].body).toEqual({ qrValue: asset, deviceModelId: 2 });
  });

  it('예전 QR 스티커면 자산 번호를 직접 넣고, 시리얼을 넣으면 함께 보낸다', async () => {
    const server = createFakeServer()
      .on('GET', '/device-models', list(models))
      .on('POST', '/devices', device)
      // 기준 사진을 이미 찍은 노트북이면 노트북 화면에 머문다
      .on('GET', `/scan/${enc}`, {
        nextAction: 'none',
        qrStatus: 'assigned',
        device,
        registerPhotos: 'completed',
      });
    const { container } = renderScreen(<RegisterPage />, {
      fetchFn: server.fetchFn,
      path: `/register?qr=${enc}`,
      routePath: '/register',
    });
    expect(screen.getByText(QR)).toBeInTheDocument();
    await screen.findByRole('option', { name: 'LG gram 16' });
    fireEvent.change(screen.getByLabelText('노트북 모델'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('자산 번호'), { target: { value: ' A-9 ' } });
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

  it('모델이 하나면 자동 선택하고, 등록됨·폐기·중복 오류를 보여 준다', async () => {
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
            fail(409, -2007, 'x'),
            fail(400, -1001, '입력값 오류'),
            new Response('x', { status: 500 }),
          ][n++],
      );
    renderScreen(<RegisterPage />, {
      fetchFn: server.fetchFn,
      path: '/register?qr=A-1',
      routePath: '/register',
    });
    await waitFor(() => expect(screen.getByLabelText('노트북 모델')).toHaveValue('1'));
    const save = () => fireEvent.click(screen.getByRole('button', { name: '등록' }));
    save();
    expect(await screen.findByText('이미 다른 노트북에 등록된 라벨입니다.')).toBeInTheDocument();
    save();
    expect(await screen.findByText(/폐기된 라벨입니다/)).toBeInTheDocument();
    save();
    expect(await screen.findByText('이미 등록된 자산 번호 또는 시리얼 번호입니다.')).toBeInTheDocument();
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

  it('시리얼 바코드를 읽어 채운다(예전 QR 값은 건너뛴다)', async () => {
    const server = createFakeServer().on('GET', '/device-models', list(models));
    const { factory } = fakeDecoderFactory([[QR], [QR, ' SN-777 ']]);
    renderScreen(<RegisterPage decoderFactory={factory} />, {
      fetchFn: server.fetchFn,
      path: '/register?qr=NB26110001',
      routePath: '/register',
    });
    fireEvent.click(screen.getByRole('button', { name: '바코드로 읽기' }));
    expect(screen.getByRole('dialog', { name: '시리얼 바코드 스캔' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('시리얼 번호')).toHaveValue('SN-777'));
    expect(factory).toHaveBeenCalledWith('auto');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '바코드로 읽기' }));
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('QrBatchPage', () => {
  function stubDownload() {
    const createObjectURL = vi.fn(() => 'blob:1');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    return { createObjectURL, click };
  }

  it('자산 번호를 발급하고 고른 형식(QR/바코드)으로 PDF를 내려받는다', async () => {
    const server = createFakeServer()
      .on('POST', '/qr-batches', { id: 3, count: 40, firstAssetNo: 'NB26110001', lastAssetNo: 'NB26110040' })
      .on('GET', '/qr-batches/3/labels.pdf?format=qr', () => new Response('%PDF', { status: 200 }))
      .on('GET', '/qr-batches/3/labels.pdf?format=barcode', () => new Response('%PDF', { status: 200 }));
    const { click, createObjectURL } = stubDownload();
    renderScreen(<QrBatchPage />, { fetchFn: server.fetchFn, session: adminSession });
    fireEvent.change(screen.getByLabelText(/장 수/), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: '자산 번호 발급' }));
    expect(await screen.findByText('묶음 #3: 40장 발급됨 (NB26110001 ~ NB26110040)')).toBeInTheDocument();
    expect(server.callsTo('POST', '/qr-batches')[0].body).toEqual({ count: 40 });
    fireEvent.click(screen.getByRole('button', { name: '라벨 PDF 내려받기' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '바코드' }));
    expect(screen.getByRole('button', { name: '바코드' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('labelFormat')).toBe('barcode');
    fireEvent.click(screen.getByRole('button', { name: '라벨 PDF 내려받기' }));
    await waitFor(() =>
      expect(server.callsTo('GET', '/qr-batches/3/labels.pdf?format=barcode')).toHaveLength(1),
    );
  });

  it('기억한 출력 형식으로 시작한다', () => {
    localStorage.setItem('labelFormat', 'barcode');
    renderScreen(<QrBatchPage />, { fetchFn: createFakeServer().fetchFn, session: adminSession });
    expect(screen.getByRole('button', { name: '바코드' })).toHaveAttribute('aria-pressed', 'true');
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
                result: { id: 4, count: 1, firstAssetNo: 'NB26110001', lastAssetNo: 'NB26110001' },
              }),
            ),
      )
      .on('GET', '/qr-batches/4/labels.pdf?format=qr', fail(404, -1002, 'PDF 없음'));
    renderScreen(<QrBatchPage />, { fetchFn: server.fetchFn, session: adminSession });
    fireEvent.click(screen.getByRole('button', { name: '자산 번호 발급' }));
    expect(await screen.findByText('최대 500장')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '자산 번호 발급' }));
    expect(await screen.findByText('묶음 #4: 1장 발급됨 (NB26110001)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '라벨 PDF 내려받기' }));
    expect(await screen.findByText('PDF 없음')).toBeInTheDocument();
  });

  it('라벨을 폐기하고, 형식이 틀리거나 실패하면 알린다', async () => {
    let n = 0;
    const server = createFakeServer().on('POST', '/qr-tags/NB26110001/void', () =>
      ++n === 1
        ? new Response(
            JSON.stringify({
              header: { isSuccessful: true, resultCode: 0, resultMessage: '' },
              result: null,
            }),
          )
        : fail(404, -2001, '자산 번호로 쓸 수 없는 라벨 값입니다.'),
    );
    renderScreen(<QrBatchPage />, { fetchFn: server.fetchFn, session: adminSession });
    const input = screen.getByLabelText('자산 번호');
    fireEvent.change(input, { target: { value: 'https://x' } });
    fireEvent.click(screen.getByRole('button', { name: '폐기' }));
    expect(await screen.findByRole('status')).toHaveTextContent('형식이 올바르지 않습니다');
    fireEvent.change(input, { target: { value: ' NB26110001 ' } });
    fireEvent.click(screen.getByRole('button', { name: '폐기' }));
    expect(await screen.findByText('NB26110001을(를) 폐기했습니다.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'NB26110001' } });
    fireEvent.click(screen.getByRole('button', { name: '폐기' }));
    expect(await screen.findByText('자산 번호로 쓸 수 없는 라벨 값입니다.')).toBeInTheDocument();
  });
});

describe('DevicePage 라벨 다시 출력', () => {
  it('관리자는 같은 자산 번호 라벨을 QR이나 바코드로 다시 출력한다. 시리얼이 없으면 없음으로 보인다', async () => {
    const d = { ...device, serialNo: null, qrValue: 'A-001' };
    const server = createFakeServer()
      .on('GET', '/devices/5/label.pdf?format=qr', () => new Response('%PDF', { status: 200 }))
      .on('GET', '/devices/5/label.pdf?format=barcode', fail(500, -1099, '출력 오류'));
    const { click } = (() => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:1'), revokeObjectURL: vi.fn() });
      return { click: vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined) };
    })();
    renderScreen(<DevicePage />, {
      fetchFn: server.fetchFn,
      session: adminSession,
      path: '/device',
      state: {
        scan: { nextAction: 'none', qrStatus: 'assigned', device: d },
        identifiedBy: 'qr',
        scannedQrValue: 'A-001',
      },
    });
    expect(screen.getByText('없음')).toBeInTheDocument();
    expect(screen.queryByText('예전 QR')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 출력' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '바코드' }));
    fireEvent.click(screen.getByRole('button', { name: '라벨 다시 출력' }));
    expect(await screen.findByText('출력 오류')).toBeInTheDocument();
  });

  it('직원에게는 다시 출력 버튼이 없고, 예전 QR 스티커 값은 따로 보인다', () => {
    renderScreen(<DevicePage />, {
      fetchFn: createFakeServer().fetchFn,
      path: '/device',
      state: { scan: { nextAction: 'none', qrStatus: 'assigned', device }, identifiedBy: 'manual' },
    });
    expect(screen.queryByRole('button', { name: '라벨 다시 출력' })).toBeNull();
    expect(screen.getByText('예전 QR')).toBeInTheDocument();
    expect(screen.getByText(QR)).toBeInTheDocument();
  });
});

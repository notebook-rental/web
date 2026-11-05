import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeCamera } from '../test/fakeCamera';
import { fakeDecoderFactory, pretendVideoReady } from '../test/fakeDecoder';
import { createFakeServer, fail, ok } from '../test/fakeServer';
import { readLocation, renderScreen, testQueue } from '../test/render';
import { CaptureScreen, type CaptureDeps, type CaptureRequest } from './CaptureScreen';
import type { ProcessedShot } from './shotProcessor';

const QR = 'NR1:7K3M9QX2TD';

function processed(reasons: string[] = []): ProcessedShot {
  return {
    working: new Blob(['w']),
    originalSha256: 'f'.repeat(64),
    width: 4000,
    height: 3000,
    metrics: { sharpness: 100, brightness: 120 },
    reasons,
  };
}

function inspection(over: object = {}) {
  return {
    id: 1,
    rentalId: 9,
    kind: 'checkout',
    status: 'capturing',
    requiredShots: ['top', 'bottom'],
    capturedShots: [],
    ...over,
  };
}

function setup(
  request: Partial<CaptureRequest> = {},
  deps: CaptureDeps = {},
  qrFrames: string[][] = [[QR]],
  before: (s: ReturnType<typeof createFakeServer>) => void = () => undefined,
) {
  const server = createFakeServer()
    .on('POST', '/inspections', (c) => ok(inspection({ kind: (c.body as { kind: string }).kind }), 201))
    .on('POST', '/inspections/1/photos', (c) =>
      ok(
        {
          id: (c.body as FormData).get('shotType') === 'top' ? 101 : 102,
          shotType: 'x',
          originalUploadUrl: 'https://s3/put',
        },
        201,
      ),
    )
    .on('POST', '/inspections/1/submit', ok(null, 202));
  before(server);
  const put = vi.fn(async () => new Response(null, { status: 200 }));
  const confirm = vi.fn(async () => null);
  const queue = testQueue({ put, confirm });
  const { factory } = fakeDecoderFactory(qrFrames);
  const req: CaptureRequest = {
    kind: 'checkout',
    rentalId: 9,
    identifiedBy: 'qr',
    scannedQrValue: QR,
    requiredShots: ['top', 'bottom'],
    deviceLabel: 'A-001',
    ...request,
  };
  const view = renderScreen(
    <CaptureScreen
      deps={{
        captureStill: async () => new Blob(['original']),
        processShot: async () => processed(),
        decoderFactory: factory,
        ...deps,
      }}
    />,
    { fetchFn: server.fetchFn, path: '/capture', state: req, queue },
  );
  return { server, put, confirm, queue, ...view };
}

const shutter = () => screen.findByRole('button', { name: /촬영하기$/ });

beforeEach(() => {
  pretendVideoReady();
  installFakeCamera();
});

describe('CaptureScreen', () => {
  it('촬영 정보 없이 들어오면 첫 화면으로 돌려보낸다', () => {
    const { container } = renderScreen(<CaptureScreen />, {
      fetchFn: createFakeServer().fetchFn,
      path: '/capture',
    });
    expect(readLocation(container).path).toBe('/');
  });

  it('대여 촬영: 검사를 만들고 컷마다 작업본을 올리고 원본은 큐로 보낸 뒤 제출한다', async () => {
    const { server, put, confirm } = setup();
    await waitFor(() => expect(server.callsTo('POST', '/inspections')).toHaveLength(1));
    expect(server.callsTo('POST', '/inspections')[0].body).toEqual({
      rentalId: 9,
      kind: 'checkout',
      identifiedBy: 'qr',
      scannedQrValue: QR,
    });
    expect(screen.getByText(/대여 촬영 · 0\/2 · A-001/)).toBeInTheDocument();
    expect(screen.getByText('상판', { selector: 'strong' })).toBeInTheDocument();

    fireEvent.click(await shutter());
    await screen.findByText(/대여 촬영 · 1\/2/);
    const form = server.callsTo('POST', '/inspections/1/photos')[0].body as FormData;
    expect(form.get('shotType')).toBe('top');
    expect(form.get('originalSha256')).toBe('f'.repeat(64));
    expect(form.get('decodedQrValues')).toBe(QR);
    await waitFor(() => expect(put).toHaveBeenCalledWith('https://s3/put', expect.any(Blob)));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(1, 101));

    // 다음 컷(하판)으로 자동으로 넘어갔다.
    expect(screen.getByText('하판', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(await shutter());
    const submit = await screen.findByRole('button', { name: '촬영 제출' });
    expect(
      (server.callsTo('POST', '/inspections/1/photos')[1].body as FormData).get('decodedQrValues'),
    ).toBeNull();
    fireEvent.click(submit);
    expect(await screen.findByText('대여 촬영 완료')).toBeInTheDocument();
  });

  it('기준 사진 촬영(spec 002 US5): 대여 건 없이 노트북으로 검사를 만들고, 다 찍으면 완료를 알린다', async () => {
    const { server } = setup({ kind: 'register', rentalId: undefined, deviceId: 5 });
    await waitFor(() => expect(server.callsTo('POST', '/inspections')).toHaveLength(1));
    expect(server.callsTo('POST', '/inspections')[0].body).toEqual({
      deviceId: 5,
      kind: 'register',
      identifiedBy: 'qr',
      scannedQrValue: QR,
    });
    expect(screen.getByText(/기준 사진 촬영 · 0\/2 · A-001/)).toBeInTheDocument();
    fireEvent.click(await shutter());
    await screen.findByText(/기준 사진 촬영 · 1\/2/);
    fireEvent.click(await shutter());
    fireEvent.click(await screen.findByRole('button', { name: '촬영 제출' }));
    expect(await screen.findByText('기준 사진 촬영 완료')).toBeInTheDocument();
  });

  it('기준 사진 촬영인데 노트북이 없거나, 대여·반납인데 대여 건이 없으면 첫 화면으로', () => {
    for (const state of [
      { kind: 'register', identifiedBy: 'qr', requiredShots: [], deviceLabel: 'x' },
      { kind: 'checkout', deviceId: 5, identifiedBy: 'qr', requiredShots: [], deviceLabel: 'x' },
    ]) {
      const { container, unmount } = renderScreen(<CaptureScreen />, {
        fetchFn: createFakeServer().fetchFn,
        path: '/capture',
        state,
      });
      expect(readLocation(container).path).toBe('/');
      unmount();
    }
  });

  it('폰의 1차 품질 검사에 걸리면 사유를 보여 주고, 그래도 올리기로 서버에 맡길 수 있다', async () => {
    const { server } = setup({}, { processShot: async () => processed(['blurry', 'too_dark']) });
    fireEvent.click(await shutter());
    expect(await screen.findByText(/흔들렸어요/)).toBeInTheDocument();
    expect(screen.getByText(/너무 어두워요/)).toBeInTheDocument();
    expect(server.callsTo('POST', '/inspections/1/photos')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /그래도 올리기/ }));
    await waitFor(() => expect(server.callsTo('POST', '/inspections/1/photos')).toHaveLength(1));
  });

  it('서버 품질 미달(422), 상판 QR 불일치(-2005), QR 여러 개(-2002), 기타 오류를 컷에 표시한다', async () => {
    const { server } = setup();
    const responses = [
      fail(422, -3001, '품질 미달', { reasons: ['out_of_frame'] }),
      fail(409, -2005, 'x'),
      fail(422, -2002, 'x'),
      fail(500, -1099, '서버 오류'),
      fail(422, -3001, '사유 없는 품질 미달'),
    ];
    let n = 0;
    server.on('POST', '/inspections/1/photos', () => responses[n++]);
    const shoot = async (text: RegExp | string) => {
      fireEvent.click(await shutter());
      expect(await screen.findByText(text)).toBeInTheDocument();
    };
    await shoot(/틀을 벗어났어요/);
    await shoot('다른 노트북의 라벨입니다. 이 컷은 저장하지 않았습니다.');
    await shoot(/라벨이 여러 개 찍혔어요/);
    await shoot('서버 오류');
    await shoot('사유 없는 품질 미달');
    expect(screen.getAllByText('다시 찍기').length).toBeGreaterThan(0);
  });

  it('상판 컷에서 폰이 읽은 QR이 스캔한 것과 다르거나 여러 개면 올리지 않는다(FR-045, FR-009)', async () => {
    const { server } = setup({}, {}, [['NR1:0123456789'], [QR, 'NR1:0123456789'], ['hello']]);
    fireEvent.click(await shutter());
    expect(await screen.findByText(/다른 노트북의 라벨입니다. 처음 스캔한/)).toBeInTheDocument();
    fireEvent.click(await shutter());
    expect(await screen.findByText(/라벨이 여러 개 찍혔어요/)).toBeInTheDocument();
    expect(server.callsTo('POST', '/inspections/1/photos')).toHaveLength(0);
    // 자산 번호 모양의 값(다른 바코드일 수도 있다)은 서버가 등록된 번호로 판단하도록 함께 올린다.
    fireEvent.click(await shutter());
    await waitFor(() => expect(server.callsTo('POST', '/inspections/1/photos')).toHaveLength(1));
    const form = server.callsTo('POST', '/inspections/1/photos')[0].body as FormData;
    expect(form.get('decodedQrValues')).toBe('hello');
  });

  it('QR 해독이 실패해도 서버에 맡기고 올린다', async () => {
    const { server } = setup(
      {},
      {
        decoderFactory: async () => ({
          decode: async () => {
            throw new Error('wasm');
          },
          dispose() {},
        }),
      },
    );
    fireEvent.click(await shutter());
    await waitFor(() => expect(server.callsTo('POST', '/inspections/1/photos')).toHaveLength(1));
  });

  it('사진 처리가 실패하면 그 컷을 다시 찍게 한다', async () => {
    setup({}, { processShot: async () => Promise.reject(new Error('메모리 부족')) });
    fireEvent.click(await shutter());
    expect(await screen.findByText('메모리 부족')).toBeInTheDocument();
  });

  it('제출 시 빠진 컷(422)을 알리고 그 컷을 고른다', async () => {
    const { server } = setup();
    server.on(
      'POST',
      '/inspections/1/submit',
      fail(422, -3002, '필수 컷 누락', { missingShots: ['bottom'] }),
    );
    fireEvent.click(await shutter());
    await screen.findByText(/1\/2/);
    fireEvent.click(await shutter());
    fireEvent.click(await screen.findByRole('button', { name: '촬영 제출' }));
    expect(await screen.findByText('빠진 컷이 있어요: 하판')).toBeInTheDocument();
    expect(screen.getByText('이 컷이 빠졌어요.')).toBeInTheDocument();
  });

  it('제출이 다른 이유로 실패하면 메시지를 보여 준다', async () => {
    const { server } = setup({ requiredShots: ['bottom'] });
    server.on('POST', '/inspections/1/submit', fail(500, -1099, '제출 오류'));
    fireEvent.click(await shutter());
    fireEvent.click(await screen.findByRole('button', { name: '촬영 제출' }));
    expect(await screen.findByText('제출 오류')).toBeInTheDocument();
  });

  it('검사를 만들 수 없으면(-3003 등) 이유를 보여 준다', async () => {
    const s1 = createFakeServer().on('POST', '/inspections', fail(409, -3003, 'x'));
    renderScreen(<CaptureScreen />, {
      fetchFn: s1.fetchFn,
      path: '/capture',
      state: { kind: 'checkin', rentalId: 9, identifiedBy: 'qr' },
    });
    expect(await screen.findByText(/대여 기록의 노트북과 다릅니다/)).toBeInTheDocument();
  });

  it('검사 생성의 다른 오류도 보여 준다', async () => {
    const s1 = createFakeServer().on('POST', '/inspections', fail(500, -1099, '생성 오류'));
    renderScreen(<CaptureScreen />, {
      fetchFn: s1.fetchFn,
      path: '/capture',
      state: { kind: 'checkout', rentalId: 9, identifiedBy: 'manual' },
    });
    expect(await screen.findByText('생성 오류')).toBeInTheDocument();
  });

  it('이어서 찍기: 이미 찍은 컷은 완료로 표시하고, 다른 컷을 골라 찍을 수 있다', async () => {
    const { server } = setup({ inspectionId: 1, requiredShots: ['top', 'bottom', 'left'] }, {}, [[QR]], (s) =>
      s.on(
        'GET',
        '/inspections/1',
        inspection({ requiredShots: ['top', 'bottom', 'left'], capturedShots: ['top'] }),
      ),
    );
    await screen.findByText(/1\/3/);
    expect(server.callsTo('POST', '/inspections')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /좌측면/ }));
    expect(screen.getByText('좌측면', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(await shutter());
    await screen.findByText(/2\/3/);
    expect((server.callsTo('POST', '/inspections/1/photos')[0].body as FormData).get('shotType')).toBe(
      'left',
    );
  });

  it('반납 촬영: SSE로 컷별 결과를 표시하고, 제출 후 검토 가능해지면 검토 화면으로 간다', async () => {
    const { server, container } = setup({ kind: 'checkin', requiredShots: ['top'] });
    let streamed = false;
    server.on('GET', '/inspections/1/events', () => {
      if (streamed) return new Promise<Response>(() => undefined);
      streamed = true;
      return new Response(
        'id: 1\nevent: comparison\ndata: {"shotType":"top","status":"running"}\n\n' +
          'id: 2\nevent: comparison\ndata: {"shotType":"top","status":"done","findingCount":2}\n\n',
        { status: 200 },
      );
    });
    server.on(
      'GET',
      '/inspections/1',
      inspection({ kind: 'checkin', status: 'reviewing', capturedShots: ['top'] }),
    );
    fireEvent.click(await shutter());
    expect(await screen.findByText('후보 2')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '촬영 제출' }));
    expect(await screen.findByText('비교 완료')).toBeInTheDocument();
    expect(screen.getByText('손상 후보 2건을 찾았어요.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '검토 시작' }));
    expect(readLocation(container).path).toBe('/review/1');
  });

  it('반납 제출 후 분석 중이면 기다리는 화면, 원본 업로드 실패를 다시 시도할 수 있다', async () => {
    const put = vi.fn(async () => new Response(null, { status: 403 }));
    const server = createFakeServer()
      .on('POST', '/inspections', ok(inspection({ kind: 'checkin', requiredShots: ['top'] }), 201))
      .on('POST', '/inspections/1/photos', ok({ id: 5, originalUploadUrl: 'https://s3/x' }, 201))
      .on('POST', '/inspections/1/submit', ok(null, 202))
      .on(
        'GET',
        '/inspections/1',
        inspection({ kind: 'checkin', status: 'analyzing', requiredShots: ['top'] }),
      )
      .on('GET', '/inspections/1/events', () => new Promise<Response>(() => undefined));
    const queue = testQueue({ put, maxAttempts: 1 });
    renderScreen(
      <CaptureScreen
        deps={{
          captureStill: async () => new Blob(['o']),
          processShot: async () => processed(),
          decoderFactory: fakeDecoderFactory([[QR]]).factory,
        }}
      />,
      {
        fetchFn: server.fetchFn,
        path: '/capture',
        queue,
        state: {
          kind: 'checkin',
          rentalId: 9,
          identifiedBy: 'qr',
          scannedQrValue: QR,
          requiredShots: ['top'],
        },
      },
    );
    fireEvent.click(await shutter());
    fireEvent.click(await screen.findByRole('button', { name: '촬영 제출' }));
    expect(await screen.findByText('비교 중…')).toBeInTheDocument();
    expect(await screen.findByText(/원본 1장 업로드 남음 \(실패 1\)/)).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getByText('상판')).toBeInTheDocument();
    put.mockResolvedValue(new Response(null, { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(screen.queryByText(/업로드 남음/)).toBeNull());
  });

  it('후보가 없으면 변화 없음으로 요약한다', async () => {
    const { server } = setup({ kind: 'checkin', requiredShots: ['top'] });
    server.on(
      'GET',
      '/inspections/1/events',
      () =>
        new Response(
          'event: comparison\ndata: {"shotType":"top","status":"done","findingCount":0}\n\nevent: inspection\ndata: {"status":"reviewing"}\n\n',
        ),
    );
    server.on('GET', '/inspections/1', inspection({ kind: 'checkin', status: 'completed' }));
    fireEvent.click(await shutter());
    expect(await screen.findByText('변화 없음')).toBeInTheDocument();
  });
});

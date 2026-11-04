import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeCamera, removeCamera } from '../test/fakeCamera';
import { fakeDecoderFactory, pretendVideoReady } from '../test/fakeDecoder';
import { createFakeServer, fail } from '../test/fakeServer';
import { readLocation, renderScreen } from '../test/render';
import { ManualIdentify } from './ManualIdentify';
import { ScanScreen } from './ScanScreen';

const QR = 'NR1:7K3M9QX2TD';
const device = { id: 5, assetNo: 'A-001', serialNo: 'S1', qrValue: QR, status: 'available' };

beforeEach(() => {
  pretendVideoReady();
  installFakeCamera();
});

describe('ScanScreen', () => {
  it('같은 QR이 2프레임 연속 읽히면 조회하고 노트북 화면으로 간다', async () => {
    const server = createFakeServer().on('GET', `/scan/${encodeURIComponent(QR)}`, {
      qrValue: QR,
      qrStatus: 'assigned',
      nextAction: 'checkout',
      device,
      rentalId: 9,
    });
    const { factory } = fakeDecoderFactory([[QR], [QR]]);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const { container } = renderScreen(<ScanScreen decoderFactory={factory} />, { fetchFn: server.fetchFn });
    await waitFor(() => expect(readLocation(container).path).toBe('/device'));
    expect(readLocation(container).state).toMatchObject({ identifiedBy: 'qr', scannedQrValue: QR });
    expect(vibrate).toHaveBeenCalled();
  });

  it('미등록 QR이면 등록 화면으로 간다', async () => {
    const server = createFakeServer().on('GET', `/scan/${encodeURIComponent(QR)}`, {
      qrValue: QR,
      qrStatus: 'unassigned',
      nextAction: 'register',
    });
    const { factory } = fakeDecoderFactory([[QR]]);
    const { container } = renderScreen(<ScanScreen decoderFactory={factory} />, { fetchFn: server.fetchFn });
    await waitFor(() => expect(readLocation(container).path).toBe(`/register?qr=${encodeURIComponent(QR)}`));
  });

  it('폐기된 QR이면 안내하고 머문다', async () => {
    const server = createFakeServer().on('GET', `/scan/${encodeURIComponent(QR)}`, {
      qrStatus: 'void',
      nextAction: 'blocked',
    });
    const { factory } = fakeDecoderFactory([[QR]]);
    renderScreen(<ScanScreen decoderFactory={factory} />, { fetchFn: server.fetchFn });
    expect(await screen.findByText(/폐기된 QR/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 300));
    expect(server.calls).toHaveLength(1);
  });

  it('발급하지 않은 QR(-2001)과 그 밖의 오류를 보여 주고, 같은 QR은 3초 동안 다시 조회하지 않는다', async () => {
    let n = 0;
    const server = createFakeServer().on('GET', `/scan/${encodeURIComponent(QR)}`, () =>
      ++n === 1 ? fail(404, -2001, 'x') : fail(500, -1099, '서버 오류입니다.'),
    );
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { factory, decoder } = fakeDecoderFactory([[QR]]);
    renderScreen(<ScanScreen decoderFactory={factory} />, { fetchFn: server.fetchFn });
    expect(await screen.findByText('이 시스템에서 발급한 QR이 아닙니다.')).toBeInTheDocument();
    const framesAtError = (decoder.decode as ReturnType<typeof vi.fn>).mock.calls.length;
    await waitFor(() =>
      expect((decoder.decode as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        framesAtError + 4,
      ),
    );
    expect(server.calls).toHaveLength(1);
    now += 3500;
    expect(await screen.findByText('서버 오류입니다.')).toBeInTheDocument();
    expect(server.calls).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it('QR이 여러 개거나 다른 바코드면 안내 문구를 바꾼다', async () => {
    const server = createFakeServer();
    const { factory } = fakeDecoderFactory([[QR, 'NR1:0123456789']]);
    renderScreen(<ScanScreen decoderFactory={factory} />, { fetchFn: server.fetchFn });
    expect(await screen.findByText(/QR이 여러 개/)).toBeInTheDocument();
    const other = fakeDecoderFactory([['hello']]);
    renderScreen(<ScanScreen decoderFactory={other.factory} />, { fetchFn: server.fetchFn });
    expect(await screen.findByText(/이 서비스의 QR이 아닙니다/)).toBeInTheDocument();
  });

  it('한 프레임만 읽히면 읽는 중이라고 알린다', async () => {
    const { factory } = fakeDecoderFactory([[QR], []]);
    renderScreen(<ScanScreen decoderFactory={factory} />, { fetchFn: createFakeServer().fetchFn });
    expect(await screen.findByText(/읽는 중/)).toBeInTheDocument();
  });

  it('카메라를 쓸 수 없으면 이유와 다시 켜기 버튼을 보여 준다', async () => {
    removeCamera();
    const { factory } = fakeDecoderFactory([[]]);
    renderScreen(<ScanScreen decoderFactory={factory} />, { fetchFn: createFakeServer().fetchFn });
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS');
    const cam = installFakeCamera();
    fireEvent.click(screen.getByRole('button', { name: '카메라 다시 켜기' }));
    await waitFor(() => expect(cam.getUserMedia).toHaveBeenCalled());
  });
});

describe('ManualIdentify', () => {
  it('자산 번호로 찾으면 identifiedBy=manual로 노트북 화면에 간다', async () => {
    const server = createFakeServer().on('GET', '/devices/by-asset/A-001', {
      qrStatus: 'assigned',
      nextAction: 'checkin',
      device,
      rentalId: 3,
    });
    const { container } = renderScreen(<ManualIdentify />, { fetchFn: server.fetchFn });
    fireEvent.change(screen.getByLabelText('자산 번호'), { target: { value: ' A-001 ' } });
    fireEvent.click(screen.getByRole('button', { name: '찾기' }));
    await waitFor(() => expect(readLocation(container).path).toBe('/device'));
    expect(readLocation(container).state).toMatchObject({ identifiedBy: 'manual' });
  });

  it('없는 자산 번호와 다른 오류를 보여 준다', async () => {
    let n = 0;
    const server = createFakeServer().on('GET', '/devices/by-asset/X', () =>
      ++n === 1 ? fail(404, -1002, '없음') : fail(500, -1099, '서버 오류'),
    );
    renderScreen(<ManualIdentify />, { fetchFn: server.fetchFn });
    fireEvent.change(screen.getByLabelText('자산 번호'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByText('그 자산 번호의 노트북이 없습니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByText('서버 오류')).toBeInTheDocument();
  });

  it('빈 값이면 요청하지 않는다', () => {
    const server = createFakeServer();
    renderScreen(<ManualIdentify />, { fetchFn: server.fetchFn });
    fireEvent.submit(screen.getByRole('button', { name: '찾기' }).closest('form')!);
    expect(server.calls).toHaveLength(0);
  });
});

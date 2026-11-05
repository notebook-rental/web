import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeCamera } from '../test/fakeCamera';
import { createFakeServer, fail, list, ok } from '../test/fakeServer';
import { renderScreen } from '../test/render';
import { AnnotationCanvas } from '../shared/annotate/AnnotationCanvas';
import { CompareViewer } from './CompareViewer';
import { ReviewPage } from './ReviewPage';
import { render } from '@testing-library/react';

const inspection = {
  id: 1,
  rentalId: 9,
  kind: 'checkin',
  status: 'reviewing',
  requiredShots: ['top', 'bottom'],
  capturedShots: ['top', 'bottom'],
  photos: [
    { id: 11, shotType: 'top', url: 'https://img/top.jpg', width: 4000, height: 3000 },
    { id: 12, shotType: 'bottom', url: 'https://img/bottom.jpg' },
  ],
};

const findings = [
  {
    id: 1,
    shotType: 'top',
    source: 'auto',
    geometry: { type: 'box', coords: [10, 10, 100, 100] },
    predictedType: 'sticker',
    confidence: 0.82,
    verdict: null,
    baselinePhotoUrl: 'https://img/base.jpg',
    targetPhotoUrl: 'https://img/target.jpg',
    alignedTargetUrl: 'https://img/aligned.jpg',
  },
  {
    id: 2,
    shotType: 'top',
    source: 'auto',
    geometry: {
      type: 'polygon',
      coords: [
        [0, 0],
        [5, 0],
        [5, 5],
      ],
    },
    predictedType: 'scratch',
    confidence: 0.4,
    overlapsExistingDamage: true,
    verdict: null,
  },
];

function stubRect(el: Element) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 300,
  } as DOMRect);
}

beforeEach(() => installFakeCamera());

function setup(extra: (s: ReturnType<typeof createFakeServer>) => void = () => undefined) {
  const server = createFakeServer()
    .on('GET', '/inspections/1', inspection)
    .on('GET', '/inspections/1/findings', list(findings))
    .on('PUT', '/findings/1/verdict', (c) => ok({ ...findings[0], ...(c.body as object) }))
    .on('PUT', '/findings/2/verdict', (c) => ok({ ...findings[1], ...(c.body as object) }))
    .on('POST', '/inspections/1/complete', ok({ ...inspection, status: 'completed', result: 'new_damage' }));
  extra(server);
  const view = renderScreen(<ReviewPage />, {
    fetchFn: server.fetchFn,
    path: '/review/1',
    routePath: '/review/:inspectionId',
  });
  return { server, ...view };
}

describe('ReviewPage', () => {
  it('후보를 모두 판정해야 완료할 수 있고, 판정 내용을 서버로 보낸다', async () => {
    const { server } = setup();
    expect(await screen.findByText('후보 2건 · 미판정 2건')).toBeInTheDocument();
    const complete = screen.getByRole('button', { name: '미판정 2건 남음' });
    expect(complete).toBeDisabled();

    const card1 = screen.getByRole('listitem', { name: '후보 #1' });
    expect(within(card1).getByText('AI 확신 82%')).toBeInTheDocument();
    fireEvent.change(within(card1).getByLabelText('심각도'), { target: { value: 'moderate' } });
    fireEvent.click(within(card1).getByRole('button', { name: '새 손상' }));
    await waitFor(() =>
      expect(within(card1).getByText('새 손상', { selector: '.verdict' })).toBeInTheDocument(),
    );
    expect(server.callsTo('PUT', '/findings/1/verdict')[0].body).toEqual({
      verdict: 'new_damage',
      damageType: 'sticker',
      severity: 'moderate',
    });

    const card2 = screen.getByRole('listitem', { name: '후보 #2' });
    expect(within(card2).getByText('기존 손상과 겹침')).toBeInTheDocument();
    fireEvent.click(within(card2).getByRole('button', { name: '기존 손상' }));
    await screen.findByRole('button', { name: '검사 완료' });
    expect(server.callsTo('PUT', '/findings/2/verdict')[0].body).toEqual({ verdict: 'existing_damage' });

    fireEvent.click(screen.getByRole('button', { name: '검사 완료' }));
    expect(await screen.findByText('새 손상이 노트북 손상 이력에 등록되었습니다.')).toBeInTheDocument();
  });

  it('판정 저장 실패와 완료 거부(-4001)를 알린다', async () => {
    const { server } = setup((s) => s.on('PUT', '/findings/1/verdict', fail(500, -1099, '판정 오류')));
    const card1 = await screen.findByRole('listitem', { name: '후보 #1' });
    fireEvent.click(within(card1).getByRole('button', { name: '손상 아님' }));
    expect(await within(card1).findByText('판정 오류')).toBeInTheDocument();

    server.on('PUT', '/findings/1/verdict', (c) => ok({ ...findings[0], ...(c.body as object) }));
    fireEvent.click(within(card1).getByRole('button', { name: '손상 아님' }));
    fireEvent.click(
      within(screen.getByRole('listitem', { name: '후보 #2' })).getByRole('button', { name: '손상 아님' }),
    );
    const done = await screen.findByRole('button', { name: '검사 완료' });
    server.on('POST', '/inspections/1/complete', fail(409, -4001, 'x', { pendingFindings: 1 }));
    fireEvent.click(done);
    expect(await screen.findByText(/아직 판정하지 않은 후보/)).toBeInTheDocument();
    server.on('POST', '/inspections/1/complete', fail(409, -3004, '이미 완료된 검사입니다.'));
    fireEvent.click(done);
    expect(await screen.findByText('이미 완료된 검사입니다.')).toBeInTheDocument();
    server.on('POST', '/inspections/1/complete', ok({ ...inspection, result: 'no_change' }));
    fireEvent.click(done);
    expect(await screen.findByText('새 손상 없이 반납 검사를 마쳤습니다.')).toBeInTheDocument();
  });

  it('후보가 없는 컷으로 옮기고, 놓친 손상을 박스로 그려 추가한다', async () => {
    const { server } = setup((s) =>
      s.on('POST', '/inspections/1/findings', (c) =>
        ok(
          { id: 9, shotType: 'bottom', source: 'manual', ...(c.body as object), verdict: 'new_damage' },
          201,
        ),
      ),
    );
    await screen.findByText('후보 2건 · 미판정 2건');
    fireEvent.click(screen.getByRole('tab', { name: '하판' }));
    expect(screen.getByText('달라진 곳을 찾지 못했어요')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '놓친 손상 직접 추가' }));

    const img = screen.getByAltText('표시할 사진');
    Object.defineProperty(img, 'naturalWidth', { value: 800 });
    Object.defineProperty(img, 'naturalHeight', { value: 600 });
    fireEvent.load(img);
    const surface = screen.getByTestId('annotate-surface');
    stubRect(surface);
    fireEvent.pointerDown(surface, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.change(screen.getByLabelText('유형'), { target: { value: 'dent' } });
    fireEvent.click(screen.getByRole('button', { name: '손상 추가' }));
    await screen.findByRole('listitem', { name: '후보 #9' });
    expect(server.callsTo('POST', '/inspections/1/findings')[0].body).toEqual({
      photoId: 12,
      geometry: { type: 'box', coords: [80, 60, 400, 300] },
      damageType: 'dent',
      severity: 'minor',
    });
    expect(screen.getByText('수동 추가')).toBeInTheDocument();
  });

  it('수동 추가 실패를 알리고 취소할 수 있다', async () => {
    setup((s) => s.on('POST', '/inspections/1/findings', fail(400, -1001, '영역 오류')));
    await screen.findByText('후보 2건 · 미판정 2건');
    fireEvent.click(screen.getByRole('button', { name: '놓친 손상 직접 추가' }));
    fireEvent.click(screen.getByRole('tab', { name: '다각형' }));
    const surface = screen.getByTestId('annotate-surface'); // 상판은 width/height가 있어 바로 그릴 수 있다
    stubRect(surface);
    for (const [x, y] of [
      [0, 0],
      [100, 0],
      [100, 100],
    ])
      fireEvent.pointerDown(surface, { clientX: x, clientY: y });
    fireEvent.click(screen.getByRole('button', { name: '다각형 닫기 (3점)' }));
    fireEvent.click(screen.getByRole('button', { name: '손상 추가' }));
    expect(await screen.findByText('영역 오류')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByRole('listitem', { name: '후보 #1' })).toBeInTheDocument();
  });

  it('자동 비교를 못 한 컷은 이유와 함께 직접 보라고 안내하고, 후보가 없어도 대여 때 사진을 보여 준다', async () => {
    setup((s) =>
      s.on('GET', '/inspections/1', {
        ...inspection,
        comparisons: [
          { shotType: 'top', status: 'done', baselinePhotoUrl: 'https://img/base-top.jpg' },
          {
            shotType: 'bottom',
            status: 'not_comparable',
            reason: 'too_few_matches',
            baselinePhotoUrl: 'https://img/base-bottom.jpg',
          },
        ],
      }),
    );
    expect(await screen.findByText('직접 볼 컷 1개: 하판')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /하판/ }));
    expect(screen.getByText('이 컷은 자동으로 비교하지 못했어요')).toBeInTheDocument();
    expect(screen.getByText(/같은 곳\(모서리, 로고 등\)을 충분히 찾지 못했어요/)).toBeInTheDocument();
    expect(screen.getByAltText('대여 시 사진')).toHaveAttribute('src', 'https://img/base-bottom.jpg');
    expect(screen.getByRole('tab', { name: '겹쳐 보기' })).toBeEnabled();
    // 판정이 남은 상판으로 바로 가는 버튼
    fireEvent.click(screen.getByRole('button', { name: /다음 컷: 상판/ }));
    expect(screen.getByRole('tab', { name: /상판/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('영역끼리만 맞춘 비교(patch)는 겹쳐 보기를 막고, ml 이 고른 기준 사진을 보여 준다', async () => {
    setup((s) =>
      s.on('GET', '/inspections/1', {
        ...inspection,
        comparisons: [
          { shotType: 'top', status: 'done', method: 'patch', baselinePhotoUrl: 'https://img/matched.jpg' },
          { shotType: 'bottom', status: 'not_comparable', reason: 'laptop_not_found' },
        ],
      }),
    );
    await screen.findByText('후보 2건 · 미판정 2건');
    expect(screen.getByAltText('대여 시 사진')).toHaveAttribute('src', 'https://img/matched.jpg');
    expect(screen.getByRole('tab', { name: '겹쳐 보기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: /하판/ }));
    expect(screen.getByText(/반납 사진에서 노트북을 찾지 못했어요/)).toBeInTheDocument();
  });

  it('새 손상으로 판정한 뒤 유형·심각도를 바꾸면 다시 저장한다', async () => {
    const { server } = setup();
    const card1 = await screen.findByRole('listitem', { name: '후보 #1' });
    fireEvent.click(within(card1).getByRole('button', { name: '새 손상' }));
    await within(card1).findByText('새 손상', { selector: '.verdict' });
    fireEvent.change(within(card1).getByLabelText('심각도'), { target: { value: 'severe' } });
    await waitFor(() => expect(server.callsTo('PUT', '/findings/1/verdict')).toHaveLength(2));
    expect(server.callsTo('PUT', '/findings/1/verdict')[1].body).toEqual({
      verdict: 'new_damage',
      damageType: 'sticker',
      severity: 'severe',
    });
    // 손상 아님이면 유형·심각도 칸을 감춘다
    fireEvent.click(within(card1).getByRole('button', { name: '손상 아님' }));
    await within(card1).findByText('손상 아님', { selector: '.verdict' });
    expect(within(card1).queryByLabelText('심각도')).toBeNull();
  });

  it('검사를 불러오지 못하면 알린다', async () => {
    const server = createFakeServer()
      .on('GET', '/inspections/1', fail(404, -1002, '검사가 없습니다.'))
      .on('GET', '/inspections/1/findings', list([]));
    renderScreen(<ReviewPage />, {
      fetchFn: server.fetchFn,
      path: '/review/1',
      routePath: '/review/:inspectionId',
    });
    expect(await screen.findByText('검사가 없습니다.')).toBeInTheDocument();
  });
});

describe('CompareViewer', () => {
  it('나란히 보기에서 후보를 눌러 고르고, 겹쳐 보기에서 경계를 옮긴다', () => {
    const onSelect = vi.fn();
    render(
      <CompareViewer
        baselineUrl="b.jpg"
        targetUrl="t.jpg"
        alignedTargetUrl="a.jpg"
        findings={findings as never}
        selectedId={1}
        onSelect={onSelect}
      />,
    );
    const target = screen.getByAltText('반납 시 사진');
    Object.defineProperty(target, 'naturalWidth', { value: 200 });
    Object.defineProperty(target, 'naturalHeight', { value: 100 });
    fireEvent.load(target);
    expect(screen.getByTestId('finding-shape-1')).toHaveClass('is-selected');
    fireEvent.click(screen.getByTestId('finding-shape-2'));
    expect(onSelect).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('tab', { name: '겹쳐 보기' }));
    const top = screen.getByAltText('반납 시 사진(정렬)');
    expect(top).toHaveAttribute('src', 'a.jpg');
    fireEvent.change(screen.getByLabelText('경계 위치'), { target: { value: '30' } });
    expect(top.style.clipPath).toBe('inset(0 0 0 30%)');
    fireEvent.click(screen.getByRole('tab', { name: '나란히' }));
    expect(screen.getByAltText('대여 시 사진')).toBeInTheDocument();
  });

  it('사진을 누르면 크게 보고, 대여 시/반납 시를 번갈아 본다', () => {
    render(
      <CompareViewer
        baselineUrl="b.jpg"
        targetUrl="t.jpg"
        targetSize={{ width: 200, height: 100 }}
        findings={findings as never}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '반납 시 사진 크게 보기' }));
    const dialog = screen.getByRole('dialog', { name: '사진 크게 보기' });
    expect(within(dialog).getByAltText('반납 시 사진(크게)')).toHaveAttribute('src', 't.jpg');
    fireEvent.click(within(dialog).getByRole('tab', { name: '대여 시' }));
    expect(within(dialog).getByAltText('대여 시 사진(크게)')).toHaveAttribute('src', 'b.jpg');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('사진이 없으면 안내하고 겹쳐 보기를 막는다', () => {
    render(<CompareViewer findings={[]} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByText('대여 때 사진이 없어요')).toBeInTheDocument();
    expect(screen.getByText('반납 사진이 없어요')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '겹쳐 보기' })).toBeDisabled();
  });
});

describe('AnnotationCanvas', () => {
  it('너무 작은 박스는 버리고, 지우기로 초기화한다', () => {
    const onChange = vi.fn();
    render(
      <AnnotationCanvas
        src="x.jpg"
        size={{ width: 400, height: 300 }}
        mode="box"
        value={null}
        onChange={onChange}
      />,
    );
    const surface = screen.getByTestId('annotate-surface');
    stubRect(surface);
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(surface, { clientX: 11, clientY: 11 });
    expect(onChange).toHaveBeenLastCalledWith(null);
    // 끌지 않은 상태의 move/up은 무시한다.
    fireEvent.pointerMove(surface, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(surface, { clientX: 50, clientY: 50 });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('폴리곤 모드에서는 3점 전에 닫을 수 없고 끌기는 무시한다', () => {
    const onChange = vi.fn();
    render(
      <AnnotationCanvas
        src="x.jpg"
        size={{ width: 400, height: 300 }}
        mode="polygon"
        value={{ type: 'box', coords: [1, 1, 50, 50] }}
        onChange={onChange}
      />,
    );
    const surface = screen.getByTestId('annotate-surface');
    stubRect(surface);
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(surface, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(surface, { clientX: 20, clientY: 20 });
    expect(screen.getByRole('button', { name: '다각형 닫기 (1점)' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('사진 크기를 모르면 그리기 면을 띄우지 않는다', () => {
    render(<AnnotationCanvas src="x.jpg" mode="box" value={null} onChange={() => undefined} />);
    expect(screen.queryByTestId('annotate-surface')).toBeNull();
  });
});

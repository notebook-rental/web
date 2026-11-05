import { describe, expect, it } from 'vitest';
import { allDone, captureReducer, initialCaptureState, nextShot } from './captureState';

const codes = ['top', 'bottom', 'left'];

describe('captureReducer', () => {
  it('처음에는 첫 컷이 선택되고 모두 todo', () => {
    const s = initialCaptureState(codes);
    expect(s.selected).toBe('top');
    expect(s.shots.every((x) => x.status === 'todo')).toBe(true);
    expect(initialCaptureState([]).selected).toBeNull();
  });

  it('업로드되면 done이 되고 다음 컷으로 넘어간다', () => {
    let s = initialCaptureState(codes);
    s = captureReducer(s, { type: 'processing', code: 'top' });
    expect(s.shots[0].status).toBe('processing');
    s = captureReducer(s, { type: 'uploaded', code: 'top', photoId: 11 });
    expect(s.shots[0]).toMatchObject({ status: 'done', photoId: 11 });
    expect(s.selected).toBe('bottom');
  });

  it('다른 컷을 보고 있었으면 선택을 바꾸지 않는다', () => {
    let s = initialCaptureState(codes);
    s = captureReducer(s, { type: 'processing', code: 'top' });
    s = captureReducer(s, { type: 'select', code: 'left' });
    s = captureReducer(s, { type: 'uploaded', code: 'top', photoId: 1 });
    expect(s.selected).toBe('left');
  });

  it('폰 검사를 통과하면(captured) 업로드를 기다리지 않고 다음 컷으로 넘어간다', () => {
    let s = initialCaptureState(codes);
    s = captureReducer(s, { type: 'captured', code: 'top' });
    expect(s.shots[0].status).toBe('processing');
    expect(s.selected).toBe('bottom');
    // 다른 컷을 보고 있었으면 그대로
    s = captureReducer(s, { type: 'captured', code: 'left' });
    expect(s.selected).toBe('bottom');
    // 남은 컷이 없으면 지금 컷에 머문다
    let t = initialCaptureState(['top']);
    t = captureReducer(t, { type: 'captured', code: 'top' });
    expect(t.selected).toBe('top');
  });

  it('뒤에서 실패하면, 다른 컷을 찍는 중에는 화면을 빼앗지 않는다', () => {
    let s = initialCaptureState(codes);
    s = captureReducer(s, { type: 'captured', code: 'top' }); // 지금 bottom(todo)
    s = captureReducer(s, { type: 'rejected', code: 'top', message: 'x', background: true });
    expect(s.selected).toBe('bottom');
    expect(s.shots[0].status).toBe('rejected');
    // 보고 있던 컷이 이미 올리는 중이면 실패한 컷을 보여 준다
    s = captureReducer(s, { type: 'captured', code: 'bottom' }); // → 다음은 left
    s = captureReducer(s, { type: 'select', code: 'bottom' });
    s = captureReducer(s, { type: 'rejected', code: 'top', message: 'y', background: true });
    expect(s.selected).toBe('top');
  });

  it('거부되면 사유를 남기고 그 컷을 선택한다', () => {
    let s = initialCaptureState(codes);
    s = captureReducer(s, { type: 'select', code: 'left' });
    s = captureReducer(s, { type: 'rejected', code: 'top', reasons: ['blurry'] });
    expect(s.selected).toBe('top');
    expect(s.shots[0]).toMatchObject({ status: 'rejected', reasons: ['blurry'] });
    s = captureReducer(s, { type: 'processing', code: 'top' });
    expect(s.shots[0].reasons).toBeUndefined();
  });

  it('이미 찍은 컷을 반영하고, 선택된 컷이 끝났으면 남은 컷으로 옮긴다', () => {
    let s = initialCaptureState(codes);
    s = captureReducer(s, { type: 'alreadyCaptured', codes: ['top', 'bottom'] });
    expect(s.selected).toBe('left');
    let t = captureReducer(initialCaptureState(codes), { type: 'select', code: 'left' });
    t = captureReducer(t, { type: 'alreadyCaptured', codes: ['top'] });
    expect(t.selected).toBe('left');
  });

  it('빠진 컷을 표시한다', () => {
    const s = captureReducer(initialCaptureState(codes), { type: 'missing', codes: ['left'] });
    expect(s.selected).toBe('left');
    expect(s.shots[2]).toMatchObject({ status: 'rejected', message: '이 컷이 빠졌어요.' });
    expect(captureReducer(s, { type: 'missing', codes: [] }).selected).toBe('left');
  });

  it('비교 이벤트로 상태와 후보 수를 갱신한다', () => {
    let s = initialCaptureState(codes);
    s = captureReducer(s, { type: 'comparison', event: { shotType: 'top', status: 'running' } });
    expect(s.shots[0].comparison).toBe('running');
    s = captureReducer(s, {
      type: 'comparison',
      event: { shotType: 'top', status: 'done', findingCount: 2 },
    });
    expect(s.shots[0]).toMatchObject({ comparison: 'done', findingCount: 2 });
    s = captureReducer(s, {
      type: 'comparison',
      event: { shotType: 'bottom', status: 'done', findings: [{ id: 1 } as never] },
    });
    expect(s.shots[1].findingCount).toBe(1);
  });

  it('allDone과 nextShot', () => {
    let s = initialCaptureState(codes);
    expect(allDone(s)).toBe(false);
    for (const c of codes) s = captureReducer(s, { type: 'uploaded', code: c, photoId: 1 });
    expect(allDone(s)).toBe(true);
    expect(s.selected).toBeNull();
    expect(allDone(initialCaptureState([]))).toBe(false);
    const shots = initialCaptureState(codes).shots;
    expect(nextShot(shots, 'left')).toBe('top');
    expect(nextShot(shots, null)).toBe('top');
  });
});

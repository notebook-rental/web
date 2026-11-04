import type { ComparisonEvent, ComparisonStatus } from '../api/types';

/**
 * 촬영 화면의 컷별 상태. 화면 코드와 떼어 순수 함수(reducer)로 두고 단위 테스트한다.
 *
 * todo → processing(폰에서 처리·업로드 중) → done(서버 저장)
 *                                         ↘ rejected(품질 미달, QR 불일치 등 → 다시 찍기)
 * 반납(checkin)이면 done 뒤에 비교 상태(comparison)가 SSE로 따라온다.
 */

export type ShotStatus = 'todo' | 'processing' | 'rejected' | 'done';

export interface ShotState {
  code: string;
  status: ShotStatus;
  reasons?: string[];
  message?: string;
  photoId?: number;
  comparison?: ComparisonStatus;
  findingCount?: number;
}

export interface CaptureState {
  shots: ShotState[];
  selected: string | null;
}

export type CaptureAction =
  | { type: 'select'; code: string }
  | { type: 'processing'; code: string }
  | { type: 'rejected'; code: string; reasons?: string[]; message?: string }
  | { type: 'uploaded'; code: string; photoId: number }
  | { type: 'alreadyCaptured'; codes: string[] }
  | { type: 'missing'; codes: string[] }
  | { type: 'comparison'; event: ComparisonEvent };

export function initialCaptureState(codes: string[]): CaptureState {
  return { shots: codes.map((code) => ({ code, status: 'todo' })), selected: codes[0] ?? null };
}

function update(state: CaptureState, code: string, patch: (s: ShotState) => ShotState): ShotState[] {
  return state.shots.map((s) => (s.code === code ? patch(s) : s));
}

/** 다음에 찍을 컷: 지금 컷 뒤에서 먼저, 없으면 앞에서 아직 안 끝난 컷 */
export function nextShot(shots: ShotState[], after: string | null): string | null {
  const idx = shots.findIndex((s) => s.code === after);
  const ordered = [...shots.slice(idx + 1), ...shots.slice(0, Math.max(idx, 0) + (idx < 0 ? 0 : 1))];
  return ordered.find((s) => s.status !== 'done' && s.status !== 'processing')?.code ?? null;
}

export function captureReducer(state: CaptureState, action: CaptureAction): CaptureState {
  switch (action.type) {
    case 'select':
      return { ...state, selected: action.code };
    case 'processing':
      return {
        ...state,
        shots: update(state, action.code, (s) => ({
          ...s,
          status: 'processing',
          reasons: undefined,
          message: undefined,
        })),
      };
    case 'rejected':
      return {
        ...state,
        selected: action.code,
        shots: update(state, action.code, (s) => ({
          ...s,
          status: 'rejected',
          reasons: action.reasons,
          message: action.message,
        })),
      };
    case 'uploaded': {
      const shots = update(state, action.code, (s) => ({
        ...s,
        status: 'done' as const,
        photoId: action.photoId,
      }));
      // 사용자가 그새 다른 컷을 골랐으면 그대로 두고, 방금 찍은 컷을 보고 있었으면 다음 컷으로 넘긴다.
      const selected = state.selected === action.code ? nextShot(shots, action.code) : state.selected;
      return { shots, selected };
    }
    case 'alreadyCaptured': {
      const shots = state.shots.map((s) =>
        action.codes.includes(s.code) ? { ...s, status: 'done' as const } : s,
      );
      const sel = shots.find((s) => s.code === state.selected);
      return { shots, selected: sel && sel.status !== 'done' ? state.selected : nextShot(shots, null) };
    }
    case 'missing':
      return {
        selected: action.codes[0] ?? state.selected,
        shots: state.shots.map((s) =>
          action.codes.includes(s.code) ? { ...s, status: 'rejected', message: '이 컷이 빠졌어요.' } : s,
        ),
      };
    case 'comparison':
      return {
        ...state,
        shots: update(state, action.event.shotType, (s) => ({
          ...s,
          comparison: action.event.status,
          findingCount: action.event.findingCount ?? action.event.findings?.length ?? s.findingCount,
        })),
      };
  }
}

export function allDone(state: CaptureState): boolean {
  return state.shots.length > 0 && state.shots.every((s) => s.status === 'done');
}

export const COMPARISON_TEXT: Record<ComparisonStatus, string> = {
  queued: '비교 대기',
  running: '비교 중',
  done: '비교 완료',
  not_comparable: '자동 비교 불가',
  failed: '비교 실패',
};

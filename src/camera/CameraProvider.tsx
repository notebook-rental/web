import { VIDEO_CONSTRAINTS, cameraErrorMessage } from './cameraErrors';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 후면 카메라 스트림을 앱 전체에서 하나만 연다.
 * 스캔 화면에서 연 스트림을 노트북 화면, 촬영 화면까지 그대로 이어 써서
 * "촬영 시작"을 눌렀을 때 카메라를 다시 켜는 1~2초를 없앤다(research R15).
 */

export interface CameraState {
  stream: MediaStream | null;
  error: string | null;
  start(): Promise<MediaStream | null>;
  stop(): void;
}

const CameraContext = createContext<CameraState | null>(null);

export function CameraProvider({ children }: { children: ReactNode }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pending = useRef<Promise<MediaStream | null> | null>(null);

  const start = useCallback(async () => {
    const current = streamRef.current;
    if (current && current.getVideoTracks().some((t) => t.readyState === 'live')) return current;
    if (pending.current) return pending.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      // getUserMedia는 HTTPS(또는 localhost)에서만 열린다.
      setError('카메라는 HTTPS 주소에서만 쓸 수 있습니다. https:// 로 접속해 주세요.');
      return null;
    }
    pending.current = navigator.mediaDevices
      .getUserMedia(VIDEO_CONSTRAINTS)
      .then((s) => {
        streamRef.current = s;
        setStream(s);
        setError(null);
        return s;
      })
      .catch((e: unknown) => {
        setError(cameraErrorMessage(e));
        return null;
      })
      .finally(() => {
        pending.current = null;
      });
    return pending.current;
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return <CameraContext.Provider value={{ stream, error, start, stop }}>{children}</CameraContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCamera(): CameraState {
  const c = useContext(CameraContext);
  if (!c) throw new Error('CameraProvider 안에서만 쓸 수 있습니다.');
  return c;
}

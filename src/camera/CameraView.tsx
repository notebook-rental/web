import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';

/** 카메라 스트림을 화면에 보여 주는 video. 위에 구도 오버레이 등을 겹칠 수 있다. */
export const CameraView = forwardRef<
  HTMLVideoElement | null,
  { stream: MediaStream | null; children?: ReactNode }
>(function CameraView({ stream, children }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle<HTMLVideoElement | null, HTMLVideoElement | null>(ref, () => videoRef.current, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play?.()?.catch?.(() => undefined);
  }, [stream]);

  return (
    <div className="camera">
      <video ref={videoRef} className="camera__video" autoPlay playsInline muted data-testid="camera-video" />
      {children}
    </div>
  );
});

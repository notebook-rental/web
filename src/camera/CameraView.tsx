import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * 카메라 스트림을 화면에 보여 주는 video. 위에 구도 오버레이 등을 겹칠 수 있다.
 *
 * fit="contain"(촬영 화면)이면 영상을 자르지 않고 전부 보여 주고, 겹치는 틀도 영상 위에만 놓는다.
 * 미리보기를 자르면(cover) 실제 사진보다 좁게 보여서, 직원이 노트북 전체를 넣으려고 필요 이상으로
 * 폰을 높이 들게 된다(2026-11-05 매장 의견).
 */
export const CameraView = forwardRef<
  HTMLVideoElement | null,
  { stream: MediaStream | null; fit?: 'cover' | 'contain'; children?: ReactNode }
>(function CameraView({ stream, fit = 'cover', children }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  useImperativeHandle<HTMLVideoElement | null, HTMLVideoElement | null>(ref, () => videoRef.current, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play?.()?.catch?.(() => undefined);
  }, [stream]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || fit !== 'contain') return;
    // 폰을 돌리면 영상의 가로세로가 바뀌므로 resize 때마다 다시 잰다.
    const measure = () => setAspect(v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : null);
    measure();
    v.addEventListener('loadedmetadata', measure);
    v.addEventListener('resize', measure);
    return () => {
      v.removeEventListener('loadedmetadata', measure);
      v.removeEventListener('resize', measure);
    };
  }, [fit, stream]);

  const video = (
    <video ref={videoRef} className="camera__video" autoPlay playsInline muted data-testid="camera-video" />
  );
  if (fit === 'cover') {
    return (
      <div className="camera">
        {video}
        {children}
      </div>
    );
  }
  return (
    <ContainStage aspect={aspect}>
      {video}
      {children}
    </ContainStage>
  );
});

/**
 * 영상 비율 그대로 칸 안에 가장 크게 놓는다. CSS 컨테이너 단위(cqh)는 flex로 늘어난 높이를
 * 0으로 보는 브라우저가 있어 크기를 직접 잰다.
 */
function ContainStage({ aspect, children }: { aspect: number | null; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ar = aspect ?? 3 / 4;
  let style: CSSProperties | undefined;
  if (box && box.w > 0 && box.h > 0) {
    const w = Math.min(box.w, box.h * ar);
    style = { width: Math.round(w), height: Math.round(w / ar) };
  }
  return (
    <div ref={boxRef} className="camera camera--contain">
      <div className="camera__stage" style={style} data-aspect={aspect ?? undefined}>
        {children}
      </div>
    </div>
  );
}

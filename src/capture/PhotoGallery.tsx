import { useEffect, useState } from 'react';
import type { Inspection, Photo } from '../api/types';
import { useServices } from '../app/services';
import { Icon } from '../shared/ui/Icon';
import { shotGuide } from './shots';

/**
 * 검사 한 건의 컷 사진을 작은 사진으로 보여 주고, 누르면 크게 본다.
 * 사진은 저장소 주소(서명 URL) 대신 서버를 거쳐 받는다. 저장소가 http 주소면 HTTPS 화면에서 막히기 때문이다.
 */
export function PhotoGallery({ inspectionId, title }: { inspectionId: number; title: string }) {
  const { endpoints } = useServices();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);

  useEffect(() => {
    let cancelled = false;
    endpoints.getInspection(inspectionId).then(
      (i) => !cancelled && setInspection(i),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : '사진을 불러오지 못했습니다.'),
    );
    return () => {
      cancelled = true;
    };
  }, [endpoints, inspectionId]);

  if (error) {
    return (
      <p className="alert alert--error" role="alert">
        {error}
      </p>
    );
  }
  if (!inspection) return <p className="hint">사진을 불러오는 중…</p>;

  const byShot = new Map((inspection.photos ?? []).map((p) => [p.shotType, p]));
  const order = inspection.requiredShots?.length ? inspection.requiredShots : [...byShot.keys()];

  return (
    <section className="gallery" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <ul className="gallery__grid">
        {order.map((code) => {
          const photo = byShot.get(code);
          const name = shotGuide(code).name;
          return (
            <li key={code}>
              {photo ? (
                <button
                  type="button"
                  className="gallery__item"
                  onClick={() => setOpen(photo)}
                  aria-label={`${name} 사진 크게 보기`}
                >
                  <PhotoImage inspectionId={inspectionId} photoId={photo.id} alt="" />
                  <span>{name}</span>
                </button>
              ) : (
                <div className="gallery__item gallery__item--empty">
                  <span className="gallery__blank">없음</span>
                  <span>{name}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {open && <PhotoDialog inspectionId={inspectionId} photo={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function PhotoDialog({
  inspectionId,
  photo,
  onClose,
}: {
  inspectionId: number;
  photo: Photo;
  onClose(): void;
}) {
  const [original, setOriginal] = useState(false);
  const name = shotGuide(photo.shotType).name;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="photo-dialog" role="dialog" aria-modal="true" aria-label={`${name} 사진`}>
      <div className="photo-dialog__bar">
        <strong>{name}</strong>
        {photo.originalConfirmed && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOriginal((v) => !v)}>
            {original ? '작은 사진 보기' : '원본 보기'}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="닫기">
          <Icon name="close" size={20} />
        </button>
      </div>
      <PhotoImage
        key={original ? 'original' : 'work'}
        inspectionId={inspectionId}
        photoId={photo.id}
        variant={original ? 'original' : 'work'}
        alt={`${name} 사진`}
        className="photo-dialog__img"
      />
    </div>
  );
}

/** 인증이 필요한 사진을 받아 화면에 붙인다. 화면을 떠나면 메모리를 돌려준다. */
export function PhotoImage({
  inspectionId,
  photoId,
  variant = 'work',
  alt,
  className,
}: {
  inspectionId: number;
  photoId: number;
  variant?: 'work' | 'original';
  alt: string;
  className?: string;
}) {
  const { endpoints } = useServices();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    endpoints.photoImage(inspectionId, photoId, variant).then(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [endpoints, inspectionId, photoId, variant]);

  if (failed)
    return <span className={`photo-img photo-img--failed ${className ?? ''}`}>사진을 못 불러왔어요</span>;
  if (!src) return <span className={`photo-img photo-img--loading ${className ?? ''}`} aria-hidden="true" />;
  return <img className={`photo-img ${className ?? ''}`} src={src} alt={alt} />;
}

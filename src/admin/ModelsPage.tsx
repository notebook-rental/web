import { useEffect, useState, type FormEvent } from 'react';
import type { DeviceModel } from '../api/types';
import { useServices } from '../app/services';
import { DEFAULT_SHOTS, shotGuide } from '../capture/shots';
import { Icon } from '../shared/ui/Icon';
import { EmptyIllustration } from '../shared/ui/Illustrations';

/**
 * 관리자: 노트북 모델과 모델별 촬영 컷(FR-002). 새 모델을 만들 때 찍을 컷을 고른다(기본은 8컷 전부).
 */
export function ModelsPage() {
  const { endpoints } = useServices();
  const [models, setModels] = useState<DeviceModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    endpoints.listDeviceModels().then(
      (r) => alive && setModels(r.items),
      (e: unknown) => {
        if (!alive) return;
        setModels([]);
        setError(e instanceof Error ? e.message : '모델 목록을 불러오지 못했습니다.');
      },
    );
    return () => {
      alive = false;
    };
  }, [endpoints]);

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>모델·촬영 컷</h1>
        </div>
      </header>

      <NewModelForm onCreated={(m) => setModels((all) => [...(all ?? []), m])} />

      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
      <h2>등록된 모델 {models ? `${models.length}종` : ''}</h2>
      {models === null ? (
        <p className="hint">불러오는 중…</p>
      ) : models.length === 0 ? (
        !error && (
          <div className="empty">
            <EmptyIllustration className="empty__art" />
            <p>아직 등록된 모델이 없습니다. 위에서 첫 모델을 추가하세요.</p>
          </div>
        )
      ) : (
        <ul className="model-grid" aria-label="모델 목록">
          {models.map((m) => (
            <li key={m.id} className="card card--compact">
              <p className="eyebrow">{m.manufacturer}</p>
              <strong className="model-name">{m.name}</strong>
              <ul className="chips" aria-label={`${m.name} 촬영 컷`}>
                {(m.shots?.length ? [...m.shots].sort((a, b) => a.sortOrder - b.sortOrder) : null)?.map(
                  (s) => (
                    <li key={s.shotType} className="chip">
                      {s.name || shotGuide(s.shotType).name}
                    </li>
                  ),
                ) ?? <li className="chip chip--muted">기본 8컷</li>}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewModelForm({ onCreated }: { onCreated(m: DeviceModel): void }) {
  const { endpoints } = useServices();
  const [manufacturer, setManufacturer] = useState('');
  const [name, setName] = useState('');
  const [shots, setShots] = useState<string[]>(DEFAULT_SHOTS);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(code: string) {
    // 순서는 항상 기본 순서를 따른다.
    setShots((cur) => DEFAULT_SHOTS.filter((c) => (c === code ? !cur.includes(c) : cur.includes(c))));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const created = await endpoints.createDeviceModel({
        manufacturer: manufacturer.trim(),
        name: name.trim(),
        shots,
      });
      onCreated(created);
      setDone(`${created.manufacturer} ${created.name} 모델을 추가했습니다.`);
      setManufacturer('');
      setName('');
      setShots(DEFAULT_SHOTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : '모델을 추가하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit} aria-label="새 모델 추가">
      <h2 className="card__title">새 모델 추가</h2>
      <div className="grid-2">
        <label>
          제조사
          <input
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            placeholder="예: LG"
            maxLength={50}
            required
          />
        </label>
        <label>
          모델 이름
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: gram 16 (16Z90S)"
            maxLength={100}
            required
          />
        </label>
      </div>
      <fieldset className="shot-picker">
        <legend>
          촬영 컷 ({shots.length}/{DEFAULT_SHOTS.length})
        </legend>
        {DEFAULT_SHOTS.map((code) => (
          <label key={code} className="check">
            <input type="checkbox" checked={shots.includes(code)} onChange={() => toggle(code)} />
            <span>{shotGuide(code).name}</span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="alert alert--ok" role="status">
          {done}
        </p>
      )}
      <button className="btn btn--primary" disabled={busy || shots.length === 0}>
        <Icon name="plus" size={18} />
        {busy ? '추가 중…' : '모델 추가'}
      </button>
    </form>
  );
}

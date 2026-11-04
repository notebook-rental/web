import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import type { DeviceSummary } from '../api/types';
import { useServices } from '../app/services';
import { STATUS_TEXT } from '../devices/labels';
import { goToScanResult } from '../scan/navigation';
import { Icon } from '../shared/ui/Icon';
import { EmptyIllustration } from '../shared/ui/Illustrations';
import { formatDate } from './format';

const PAGE_SIZE = 20;

/** 관리자: 등록된 노트북 목록과 검색(자산 번호, 시리얼, 모델 이름). 한 줄을 누르면 노트북 화면으로 간다. */
export function DeviceListPage() {
  const { endpoints } = useServices();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: DeviceSummary[]; totalCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    endpoints.listDevices({ q: query || undefined, page, size: PAGE_SIZE }).then(
      (r) => {
        if (!alive) return;
        setError(null);
        setData(r);
      },
      (e: unknown) => {
        if (!alive) return;
        setData({ items: [], totalCount: 0 });
        setError(
          e instanceof ApiError && e.status === 404
            ? '서버에 아직 노트북 목록 기능이 없습니다. 백엔드가 업데이트되면 여기에 목록이 보입니다.'
            : e instanceof Error
              ? e.message
              : '목록을 불러오지 못했습니다.',
        );
      },
    );
    return () => {
      alive = false;
    };
  }, [endpoints, query, page]);

  function search(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    setQuery(input.trim());
  }

  async function open(d: DeviceSummary) {
    setOpening(d.id);
    try {
      const scan = await endpoints.findByAsset(d.assetNo);
      goToScanResult(navigate, scan, 'manual');
    } catch (e) {
      setError(e instanceof Error ? e.message : '노트북을 열지 못했습니다.');
      setOpening(null);
    }
  }

  const total = data?.totalCount ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>노트북</h1>
        </div>
        <Link to="/admin" className="btn btn--sm">
          <Icon name="plus" size={16} />새 노트북 등록
        </Link>
      </header>

      <form className="searchbar" role="search" onSubmit={search}>
        <Icon name="search" size={18} />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="자산 번호, 시리얼, 모델 이름"
          aria-label="노트북 검색"
        />
        <button className="btn btn--sm btn--primary">검색</button>
      </form>

      {error && (
        <p className="alert alert--warn" role="alert">
          {error}
        </p>
      )}

      {data === null ? (
        <p className="hint">불러오는 중…</p>
      ) : data.items.length === 0 ? (
        !error && (
          <div className="empty">
            <EmptyIllustration className="empty__art" />
            <p>{query ? `"${query}"에 맞는 노트북이 없습니다.` : '아직 등록된 노트북이 없습니다.'}</p>
          </div>
        )
      ) : (
        <>
          <p className="hint">총 {total}대</p>
          <ul className="rows" aria-label="노트북 목록">
            {data.items.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="row"
                  onClick={() => void open(d)}
                  disabled={opening !== null}
                >
                  <span className="row__main">
                    <strong>{d.assetNo}</strong>
                    <span className="muted">
                      {d.model ? `${d.model.manufacturer} ${d.model.name}` : '모델 정보 없음'} · {d.serialNo}
                    </span>
                  </span>
                  <span className="row__meta">
                    <span className={`status status--${d.status}`}>{STATUS_TEXT[d.status] ?? d.status}</span>
                    <small className="muted">최근 검사 {formatDate(d.lastInspectedAt)}</small>
                  </span>
                  <Icon name="next" size={18} className="row__chevron" />
                </button>
              </li>
            ))}
          </ul>
          {lastPage > 0 && (
            <div className="pager">
              <button
                type="button"
                className="btn btn--sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                이전
              </button>
              <span>
                {page + 1} / {lastPage + 1}
              </span>
              <button
                type="button"
                className="btn btn--sm"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => p + 1)}
              >
                다음
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calculator, FileText } from 'lucide-react';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import { PM_PRO_PDF_PATH, pmPathWithPitching } from '@/content/bwaPm';
import {
  formatListDate,
  formatListMoney,
  pitchingStatusBadgeClass,
  pitchingStatusLabel,
} from '@/lib/listTableUtils';

function money(value: number | string | null | undefined): string {
  const text = formatListMoney(value);
  return text === 'N/A' ? '未填' : `HK$ ${text}`;
}

export function PmQuickView() {
  const [params, setParams] = useSearchParams();
  const selectedId = (params.get('pmsPitchingId') || '').trim();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<PmsPitchingListItem[]>([]);
  const [selected, setSelected] = useState<PmsPitchingListItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchPmsPitchings({ search: debounced, limit: 40 }).then((pitchings) => {
      if (cancelled) return;
      setRows(pitchings);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const inList = rows.find((row) => row.id === selectedId);
    if (inList) {
      setSelected(inList);
      return;
    }
    let cancelled = false;
    void fetchPmsPitchings({ ids: [selectedId], limit: 1 }).then((found) => {
      if (!cancelled) setSelected(found[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [rows, selectedId]);

  const choose = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('pmsPitchingId', id);
    setParams(next, { replace: true });
  };

  const stage = selected ? pitchingStatusLabel(selected.pitching_stages) : '—';

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-5 md:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            PM報價 · BWA
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <Calculator className="h-5 w-5 text-primary" />
            快速報價
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            選一個 PMS Pitching 查看預算。此頁不建立傢俬報價單。
          </p>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜尋 Pitching"
            placeholder="搜尋編號、客戶或名稱"
            className="mt-4 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
          />
          {loading && <p className="mt-4 text-sm text-muted-foreground">載入 Pitching…</p>}
          {!loading && rows.length === 0 && (
            <p className="mt-6 text-sm text-muted-foreground">沒有符合的 Pitching</p>
          )}
          <ul className="mt-4 divide-y divide-border">
            {rows.map((row) => {
              const active = row.id === selectedId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => choose(row.id)}
                    className={`flex w-full items-start justify-between gap-3 py-3 text-left ${active ? 'text-primary' : ''}`}
                  >
                    <span>
                      <span className="block text-sm font-semibold">{pitchingDisplayTitle(row)}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {row.pitching_code || '無編號'}
                        {row.customer_name ? ` · ${row.customer_name}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold">{money(row.estimated_income)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          {!selected && (
            <p className="text-sm text-muted-foreground">選擇左側 Pitching 後，這裡顯示預算。</p>
          )}
          {selected && (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-bold">{pitchingDisplayTitle(selected)}</h2>
                {stage !== '—' && (
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pitchingStatusBadgeClass(selected.pitching_stages)}`}>
                    {stage}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {selected.pitching_code || '無編號'}
                {selected.main_pm_name ? ` · PM ${selected.main_pm_name}` : ''}
              </p>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">預計收入</dt>
                  <dd className="font-semibold">{money(selected.estimated_income)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">預計支出</dt>
                  <dd className="font-semibold">{money(selected.estimated_expense)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">預計毛利</dt>
                  <dd className="font-semibold">{money(selected.estimated_gross_profit)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">查詢日期</dt>
                  <dd>{formatListDate(selected.enquiry_date)}</dd>
                </div>
              </dl>
              <Link
                to={pmPathWithPitching(PM_PRO_PDF_PATH, selected.id)}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
              >
                <FileText className="mr-1.5 h-4 w-4" />
                做專業說明
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

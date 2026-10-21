import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, FileText } from 'lucide-react';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import { PM_PRO_PDF_PATH, PM_QUICK_PATH, pmPathWithPitching } from '@/content/bwaPm';
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

export function PmBudgetView() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<PmsPitchingListItem[]>([]);
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

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                PM報價 · BWA
              </p>
              <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
                <CircleDollarSign className="h-5 w-5 text-primary" />
                報價預算
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                預算來自 PMS Pitching 的預計收入、支出與毛利。此頁不讀傢俬報價，也不會開啟傢俬報價單。
              </p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="搜尋 Pitching"
              placeholder="搜尋編號、客戶或名稱"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm sm:max-w-xs"
            />
          </div>
          {!loading && (
            <p className="mt-4 text-xs text-muted-foreground">{rows.length} 個 Pitching</p>
          )}
        </section>

        {loading && <p className="px-2 text-sm text-muted-foreground">載入 Pitching…</p>}
        {!loading && rows.length === 0 && (
          <section className="rounded-2xl border border-border/80 bg-card px-6 py-12 text-center text-sm text-muted-foreground shadow-sm">
            沒有符合的 Pitching
          </section>
        )}

        <div className="grid gap-3">
          {rows.map((row) => {
            const stage = pitchingStatusLabel(row.pitching_stages);
            return (
              <article
                key={row.id}
                className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold">{pitchingDisplayTitle(row)}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {row.pitching_code || '無編號'}
                      {row.customer_name ? ` · ${row.customer_name}` : ''}
                      {row.main_pm_name ? ` · PM ${row.main_pm_name}` : ''}
                    </p>
                  </div>
                  {stage !== '—' && (
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pitchingStatusBadgeClass(row.pitching_stages)}`}>
                      {stage}
                    </span>
                  )}
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-background">
                    <dt className="text-[11px] text-muted-foreground">預計收入</dt>
                    <dd className="mt-1 text-lg font-bold">{money(row.estimated_income)}</dd>
                    <dd className="text-xs text-muted-foreground">查詢 {formatListDate(row.enquiry_date)}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-background">
                    <dt className="text-[11px] text-muted-foreground">預計支出</dt>
                    <dd className="mt-1 text-lg font-bold">{money(row.estimated_expense)}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-background">
                    <dt className="text-[11px] text-muted-foreground">預計毛利</dt>
                    <dd className="mt-1 text-lg font-bold">{money(row.estimated_gross_profit)}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    to={pmPathWithPitching(PM_QUICK_PATH, row.id)}
                    className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
                  >
                    在 PM 快速報價查看
                  </Link>
                  <Link
                    to={pmPathWithPitching(PM_PRO_PDF_PATH, row.id)}
                    className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-semibold"
                  >
                    <FileText className="mr-1.5 h-4 w-4" />
                    專業說明
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

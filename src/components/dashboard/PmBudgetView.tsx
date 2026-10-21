import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import { buildQuoteEditorPath, QUOTE_QUICK_PATH } from '@/lib/quoteRoutes';
import {
  formatListDate,
  formatListMoney,
  pitchingStatusBadgeClass,
  pitchingStatusLabel,
} from '@/lib/listTableUtils';

type LinkedQuote = {
  id: string;
  quoteId: string;
  version: string;
  totalAmount: number;
  createdAt: string | null;
};

const TRASH_STATUS = '回收桶';

function money(value: number | string | null | undefined): string {
  const text = formatListMoney(value);
  return text === 'N/A' ? '未填預算' : `HK$ ${text}`;
}

export function PmBudgetView() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<PmsPitchingListItem[]>([]);
  const [quotes, setQuotes] = useState<Map<string, LinkedQuote>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const pitchings = await fetchPmsPitchings({ search: debounced, limit: 40 });
        if (cancelled) return;
        const ids = pitchings.map((row) => row.id).filter(Boolean);
        const linked = new Map<string, LinkedQuote>();
        if (ids.length > 0) {
          const { data, error: quoteError } = await supabase
            .from('bwf_quote')
            .select('id, quote_id, version, total_amount, status, bwf_pitching_id, created_at')
            .in('bwf_pitching_id', ids)
            .neq('status', TRASH_STATUS)
            .order('created_at', { ascending: false });
          if (quoteError) throw quoteError;
          for (const row of data || []) {
            const pitchingId = String(row.bwf_pitching_id || '');
            if (!pitchingId || linked.has(pitchingId)) continue;
            linked.set(pitchingId, {
              id: String(row.id),
              quoteId: String(row.quote_id || ''),
              version: String(row.version || ''),
              totalAmount: Number(row.total_amount) || 0,
              createdAt: row.created_at ? String(row.created_at) : null,
            });
          }
        }
        if (cancelled) return;
        setRows(pitchings);
        setQuotes(linked);
      } catch (err: unknown) {
        if (cancelled) return;
        setRows([]);
        setQuotes(new Map());
        setError(err instanceof Error ? err.message : '無法載入報價預算');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const summary = useMemo(() => {
    const withQuote = rows.filter((row) => quotes.has(row.id)).length;
    return { total: rows.length, withQuote };
  }, [quotes, rows]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                PM報價
              </p>
              <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
                <CircleDollarSign className="h-5 w-5 text-primary" />
                報價預算
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                PMS Pitching 的預計收入是預算。已在 FDS 開出的報價單另列合約金額，兩者並列，不互相覆蓋。
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
          {!loading && !error && (
            <p className="mt-4 text-xs text-muted-foreground">
              {summary.total} 個 Pitching · {summary.withQuote} 個已有報價單
            </p>
          )}
        </section>

        {loading && <p className="px-2 text-sm text-muted-foreground">載入 Pitching 與報價單…</p>}
        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}
        {!loading && !error && rows.length === 0 && (
          <section className="rounded-2xl border border-border/80 bg-card px-6 py-12 text-center text-sm text-muted-foreground shadow-sm">
            沒有符合的 Pitching
          </section>
        )}

        <div className="grid gap-3">
          {rows.map((row) => {
            const quote = quotes.get(row.id);
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
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-background">
                    <dt className="text-[11px] text-muted-foreground">PMS 預算（預計收入）</dt>
                    <dd className="mt-1 text-lg font-bold">{money(row.estimated_income)}</dd>
                    <dd className="text-xs text-muted-foreground">查詢 {formatListDate(row.enquiry_date)}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-background">
                    <dt className="text-[11px] text-muted-foreground">FDS 報價金額</dt>
                    <dd className="mt-1 text-lg font-bold">
                      {quote ? `HK$ ${formatListMoney(quote.totalAmount)}` : '尚未開報價'}
                    </dd>
                    <dd className="truncate text-xs text-muted-foreground">
                      {quote ? `${quote.quoteId} · ${quote.version || 'v1'}` : '快速報價會沿用這個 Pitching'}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    to={`${QUOTE_QUICK_PATH}?pmsPitchingId=${encodeURIComponent(row.id)}`}
                    className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
                  >
                    開快速報價
                  </Link>
                  {quote?.quoteId && (
                    <Link
                      to={buildQuoteEditorPath(quote.quoteId)}
                      className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-semibold"
                    >
                      <FileText className="mr-1.5 h-4 w-4" />
                      打開報價單
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

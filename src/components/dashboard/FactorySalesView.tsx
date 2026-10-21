import { useEffect, useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import {
  fetchFactoryCatalogCounts,
  fetchQuoteUsageRankings,
  type FactoryCatalogCountRow,
  type QuoteFactoryUsageRow,
} from '@/lib/quoteUsageReports';

export function FactorySalesView() {
  const [rows, setRows] = useState<QuoteFactoryUsageRow[]>([]);
  const [catalog, setCatalog] = useState<FactoryCatalogCountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchQuoteUsageRankings(), fetchFactoryCatalogCounts()])
      .then(([usage, counts]) => {
        if (cancelled) return;
        setRows(usage.factories);
        setCatalog(counts);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '無法載入銷售表現');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogByName = useMemo(
    () => new Map(catalog.map((row) => [row.factoryName, row] as const)),
    [catalog],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.factoryName.toLowerCase().includes(q));
  }, [query, rows]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">廠家目錄</p>
              <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
                <Building2 className="h-5 w-5 text-primary" />
                銷售表現
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                每張報價單只計最新版本。有廠家名稱的產品列算 1 次使用。這是報價採用次數，不是出貨金額。
              </p>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜尋廠家"
              placeholder="搜尋廠家"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm sm:max-w-xs"
            />
          </div>
        </section>

        {loading && <p className="px-2 text-sm text-muted-foreground">統計報價單中的廠家…</p>}
        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">{error}</section>
        )}
        {!loading && !error && visible.length === 0 && (
          <section className="rounded-2xl border border-border/80 bg-card px-6 py-12 text-center text-sm text-muted-foreground shadow-sm">
            {rows.length === 0 ? '報價單裡還沒有廠家名稱' : '沒有符合的廠家'}
          </section>
        )}

        <div className="grid gap-3">
          {visible.map((row) => {
            const catalogRow = catalogByName.get(row.factoryName);
            const rank = rows.indexOf(row) + 1;
            return (
              <article key={row.factoryName} className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-bold">{rank}. {row.factoryName}</h2>
                  <p className="text-sm text-muted-foreground">{row.quoteCount} 張報價單</p>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">使用次數</dt>
                    <dd className="font-semibold">{row.usageCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">數量合計</dt>
                    <dd className="font-semibold">{row.quantitySum}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">報價產品種類</dt>
                    <dd className="font-semibold">{row.productCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">目錄產品</dt>
                    <dd className="font-semibold">{catalogRow ? catalogRow.classBCount : '—'}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

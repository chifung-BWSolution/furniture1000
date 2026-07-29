import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BarChart2, Loader2, Package } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchQuoteUsageRankings,
  type QuoteProductUsageRow,
} from '@/lib/quoteUsageReports';
import { CHART_COLORS } from '@/constants/analytics-mock';

const TOP_CHART = 10;

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
        rank === 1
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {rank}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="font-body text-[11px]">{label}</span>
      </div>
      <p className="mt-1 font-display text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="py-10 text-center font-body text-sm text-muted-foreground">
      {text}
    </p>
  );
}

export function ProductReportView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<QuoteProductUsageRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchQuoteUsageRankings()
      .then((usage) => {
        if (cancelled) return;
        setProducts(usage.products);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '無法載入報價單產品報告資料');
        setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const productChart = products.slice(0, TOP_CHART).map((p) => ({
    name: p.name.length > 16 ? `${p.name.slice(0, 16)}…` : p.name,
    fullName: p.name,
    count: p.usageCount,
  }));

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            <h1 className="font-display text-2xl font-bold tracking-tight">
              報價單產品報告
            </h1>
          </div>
          <p className="mt-1 font-body text-xs text-muted-foreground">
            只統計報價明細中能對應產品目錄（products）的現有產品；增值服務／清走等非產品列不計入
          </p>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="font-body text-sm">載入報價使用數據…</span>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center font-body text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!loading && !error ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-1 max-w-xs">
              <StatCard
                icon={<Package className="h-4 w-4" />}
                label="有報價紀錄的產品"
                value={products.length.toLocaleString()}
              />
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 font-display text-sm font-bold">
                {`最受歡迎產品 Top ${TOP_CHART}（報價使用次數）`}
              </h3>
              {productChart.length === 0 ? (
                <EmptyHint text="尚無報價產品使用紀錄" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={productChart} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      allowDecimals={false}
                    />
                    <Tooltip
                      formatter={(value: number) => [`${value} 次`, '使用次數']}
                      labelFormatter={(_label, payload) =>
                        String(payload?.[0]?.payload?.fullName || '')
                      }
                      contentStyle={{
                        borderRadius: 12,
                        fontSize: 12,
                        border: '1px solid hsl(var(--border))',
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill={CHART_COLORS.primary}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-3">
                <h3 className="font-display text-sm font-bold">
                  最受歡迎產品排名
                </h3>
              </div>
              {products.length === 0 ? (
                <EmptyHint text="尚無報價產品使用紀錄" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5 text-left font-medium">
                          排名 / 產品
                        </th>
                        <th className="px-3 py-2.5 text-left font-medium">
                          廠家
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          使用次數
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          報價單數
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          總數量
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {products.map((p, i) => (
                        <tr key={p.name} className="hover:bg-muted/30">
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <RankBadge rank={i + 1} />
                              {p.image ? (
                                <img
                                  src={p.image}
                                  alt=""
                                  className="h-9 w-9 shrink-0 rounded-md border border-border object-cover bg-muted"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                                  <Package className="h-4 w-4 text-muted-foreground/50" />
                                </div>
                              )}
                              <span className="min-w-0 font-body text-[13px] font-medium text-foreground">
                                {p.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-body text-[12px] text-muted-foreground">
                            {p.factoryName || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-foreground">
                            {p.usageCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">
                            {p.quoteCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">
                            {p.quantitySum.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Building, Loader2 } from 'lucide-react';
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
  fetchFactoryCatalogCounts,
  fetchQuoteUsageRankings,
  type FactoryCatalogCountRow,
  type QuoteFactoryUsageRow,
} from '@/lib/quoteUsageReports';
import { CHART_COLORS } from '@/constants/analytics-mock';

const TOP_CHART = 10;

export function FactoryReportView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<QuoteFactoryUsageRow[]>([]);
  const [catalog, setCatalog] = useState<FactoryCatalogCountRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchQuoteUsageRankings(), fetchFactoryCatalogCounts()])
      .then(([quoteUsage, catalogCounts]) => {
        if (cancelled) return;
        setUsage(quoteUsage.factories);
        setCatalog(catalogCounts);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '無法載入廠家報告資料');
        setUsage([]);
        setCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = usage.slice(0, TOP_CHART).map((f) => ({
    name:
      f.factoryName.length > 14
        ? `${f.factoryName.slice(0, 14)}…`
        : f.factoryName,
    fullName: f.factoryName,
    count: f.usageCount,
  }));

  const catalogByName = new Map(
    catalog.map((row) => [row.factoryName, row.classBCount] as const),
  );

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Building className="h-5 w-5 text-primary" />
            <h1 className="font-display text-2xl font-bold tracking-tight">
              廠家報告
            </h1>
          </div>
          <p className="mt-1 font-body text-xs text-muted-foreground">
            統計報價單一覽各報價單最新版本：每件有廠家的產品列計 1 次使用；並對照目錄廠家產品數
          </p>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="font-body text-sm">載入廠家使用數據…</span>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center font-body text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="font-body text-[11px] text-muted-foreground">
                  有報價紀錄的廠家
                </p>
                <p className="mt-1 font-display text-xl font-bold text-foreground">
                  {usage.length.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="font-body text-[11px] text-muted-foreground">
                  報價使用總次數
                </p>
                <p className="mt-1 font-display text-xl font-bold text-foreground">
                  {usage
                    .reduce((sum, f) => sum + f.usageCount, 0)
                    .toLocaleString()}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 font-display text-sm font-bold">
                報價使用次數 Top {TOP_CHART} 廠家
              </h3>
              {chartData.length === 0 ? (
                <p className="py-10 text-center font-body text-sm text-muted-foreground">
                  尚無報價廠家使用紀錄
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={64}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      allowDecimals={false}
                    />
                    <Tooltip
                      formatter={(value: number) => [`${value} 次`, '使用次數']}
                      labelFormatter={(_, payload) =>
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
                  廠家報價使用排名
                </h3>
              </div>
              {usage.length === 0 ? (
                <p className="py-10 text-center font-body text-sm text-muted-foreground">
                  尚無報價廠家使用紀錄
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5 text-left font-medium">
                          排名 / 廠家
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          使用次數
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          報價單數
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          報價產品種類
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          目錄產品數
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          總數量
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {usage.map((f, i) => (
                        <tr key={f.factoryName} className="hover:bg-muted/30">
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={cn(
                                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold',
                                  i === 0
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground',
                                )}
                              >
                                {i + 1}
                              </span>
                              <span className="font-body text-[13px] font-medium text-foreground">
                                {f.factoryName}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-foreground">
                            {f.usageCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">
                            {f.quoteCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">
                            {f.productCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">
                            {(
                              catalogByName.get(f.factoryName) || 0
                            ).toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">
                            {f.quantitySum.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-3">
                <h3 className="font-display text-sm font-bold">
                  廠家產品數量排名（產品目錄）
                </h3>
                <p className="mt-1 font-body text-[11px] text-muted-foreground">
                  A類＝已上載／準備上載 Shopify；B類＝產品目錄；產品數量＝A＋B
                </p>
              </div>
              {catalog.length === 0 ? (
                <p className="py-10 text-center font-body text-sm text-muted-foreground">
                  尚無廠家產品資料
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5 text-left font-medium">
                          排名 / 廠家
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          A類產品
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          B類產品
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          產品數量
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {catalog.map((f, i) => (
                        <tr key={f.factoryName} className="hover:bg-muted/30">
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={cn(
                                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold',
                                  i === 0
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground',
                                )}
                              >
                                {i + 1}
                              </span>
                              <span className="font-body text-[13px] font-medium text-foreground">
                                {f.factoryName}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">
                            {f.classACount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">
                            {f.classBCount.toLocaleString()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-data text-foreground">
                            {f.productCount.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

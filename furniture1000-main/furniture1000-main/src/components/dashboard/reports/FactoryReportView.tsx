import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Building, FileSpreadsheet, Database, ChevronRight } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  MOCK_FACTORY_STATS, MOCK_FACTORY_TREND, CHART_COLORS, TIME_RANGES, type TimeRangeKey,
} from '@/constants/analytics-mock';
import { toast } from 'sonner';

export function FactoryReportView() {
  const [range, setRange] = useState<TimeRangeKey>('month');
  const [drillId, setDrillId] = useState<string | null>(null);
  const ranked = [...MOCK_FACTORY_STATS].sort((a, b) => b.orders - a.orders);

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <Building className="h-5 w-5 text-primary" />
            <h1 className="font-display text-2xl font-bold tracking-tight">廠家報告</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
              {TIME_RANGES.map((r) => (
                <button key={r.key} onClick={() => setRange(r.key)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', range === r.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{r.label}</button>
              ))}
            </div>
            <button onClick={() => toast.success('已匯出 Excel')} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"><FileSpreadsheet className="h-3.5 w-3.5" /> 匯出 Excel</button>
            <button onClick={() => toast.success('已同步至 PMS')} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"><Database className="h-3.5 w-3.5" /> 同步 PMS</button>
          </div>
        </div>

        {/* trend chart */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-4 font-display text-sm font-bold">訂貨量趨勢（Top 3 廠家）</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={MOCK_FACTORY_TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid hsl(var(--border))' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="華座" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="永豐" stroke={CHART_COLORS.sky} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="宏發" stroke={CHART_COLORS.amber} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* ranking table */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3"><h3 className="font-display text-sm font-bold">廠家績效排名</h3></div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">排名 / 廠家</th>
                <th className="px-3 py-2.5 text-right font-medium">訂貨量</th>
                <th className="px-3 py-2.5 text-right font-medium">報價成功率</th>
                <th className="px-3 py-2.5 text-right font-medium">平均交付期</th>
                <th className="px-3 py-2.5 text-right font-medium">退貨率</th>
                <th className="px-3 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {ranked.map((f, i) => (
                <>
                  <tr key={f.id} className="hover:bg-muted/30">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold', i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{i + 1}</span>
                        <span className="font-body text-[13px] font-medium text-foreground">{f.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono-data text-foreground">{f.orders}</td>
                    <td className="px-3 py-2.5 text-right font-mono-data text-emerald-600">{f.quoteWinRate}%</td>
                    <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">{f.avgLeadDays} 天</td>
                    <td className="px-3 py-2.5 text-right font-mono-data text-rose-500">{f.returnRate}%</td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setDrillId(drillId === f.id ? null : f.id)} className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10">
                        下鑽 <ChevronRight className={cn('h-3 w-3 transition-transform', drillId === f.id && 'rotate-90')} />
                      </button>
                    </td>
                  </tr>
                  {drillId === f.id && (
                    <tr key={f.id + '-drill'}>
                      <td colSpan={6} className="bg-muted/20 px-5 py-3">
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <DrillStat label="本期最暢銷" value="行政辦公桌 1.8m" />
                          <DrillStat label="平均報價金額" value={`$${(f.orders * 100).toLocaleString()}`} />
                          <DrillStat label="活躍產品數" value={`${Math.round(f.orders / 12)} 件`} />
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DrillStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="font-body text-[10.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-display text-[13px] font-bold text-foreground">{value}</p>
    </div>
  );
}

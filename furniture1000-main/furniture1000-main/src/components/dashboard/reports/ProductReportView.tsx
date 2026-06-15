import { useState } from 'react';
import { cn } from '@/lib/utils';
import { BarChart2, Sparkles, FileSpreadsheet } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  MOCK_PRODUCT_STATS, MOCK_PRODUCT_TREND, CHART_COLORS, type ProductStat,
} from '@/constants/analytics-mock';
import { TIER_META } from '@/types/solutions';
import { toast } from 'sonner';

export function ProductReportView() {
  const [stats, setStats] = useState<ProductStat[]>(MOCK_PRODUCT_STATS);
  const [dim, setDim] = useState<'quotes' | 'favorites' | 'usage' | 'conversion'>('quotes');

  const DIMS: { key: typeof dim; label: string }[] = [
    { key: 'quotes', label: '報價次數' },
    { key: 'favorites', label: '收藏次數' },
    { key: 'usage', label: '使用量' },
    { key: 'conversion', label: '轉換率' },
  ];

  const ranked = [...stats].sort((a, b) => (b[dim] as number) - (a[dim] as number));

  const setWeight = (id: string, w: number) => {
    setStats((prev) => prev.map((s) => (s.id === id ? { ...s, searchWeight: w } : s)));
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            <h1 className="font-display text-2xl font-bold tracking-tight">產品報告</h1>
          </div>
          <button onClick={() => toast.success('已匯出 Excel')} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"><FileSpreadsheet className="h-3.5 w-3.5" /> 匯出 Excel</button>
        </div>

        {/* heat trend */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-4 font-display text-sm font-bold">產品熱度趨勢</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={MOCK_PRODUCT_TREND}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} /><stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} /></linearGradient>
                <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CHART_COLORS.sky} stopOpacity={0.3} /><stop offset="95%" stopColor={CHART_COLORS.sky} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid hsl(var(--border))' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="報價" stroke={CHART_COLORS.primary} fill="url(#g1)" strokeWidth={2} />
              <Area type="monotone" dataKey="收藏" stroke={CHART_COLORS.sky} fill="url(#g2)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* dimension switch */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">熱度維度：</span>
          {DIMS.map((d) => (
            <button key={d.key} onClick={() => setDim(d.key)} className={cn('rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors', dim === d.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>{d.label}</button>
          ))}
        </div>

        {/* ranking + search weight */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3"><h3 className="font-display text-sm font-bold">熱度排名 · 搜尋權重調整</h3></div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">產品</th>
                <th className="px-3 py-2.5 text-left font-medium">分級</th>
                <th className="px-3 py-2.5 text-right font-medium">報價</th>
                <th className="px-3 py-2.5 text-right font-medium">收藏</th>
                <th className="px-3 py-2.5 text-right font-medium">轉換率</th>
                <th className="px-3 py-2.5 text-left font-medium">搜尋權重</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {ranked.map((s) => (
                <tr key={s.id} className={cn('hover:bg-muted/30', s.tier === 'A' && 'bg-primary/[0.03]')}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      <img src={s.imageUrl} alt={s.title} loading="lazy" className="h-9 w-9 rounded-md object-cover bg-muted" />
                      <span className="flex items-center gap-1.5 font-body text-[13px] font-medium text-foreground">
                        {s.title}
                        {s.tier === 'A' && <Sparkles className="h-3 w-3 text-primary" />}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', TIER_META[s.tier].className)}>{TIER_META[s.tier].label}</span></td>
                  <td className="px-3 py-2.5 text-right font-mono-data text-foreground">{s.quotes}</td>
                  <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground">{s.favorites}</td>
                  <td className="px-3 py-2.5 text-right font-mono-data text-emerald-600">{s.conversion}%</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <input type="range" min={0} max={100} value={s.searchWeight} onChange={(e) => setWeight(s.id, Number(e.target.value))} onMouseUp={() => toast.success(`已調整搜尋權重：${s.title}`)} className="h-1.5 w-28 cursor-pointer accent-[#6B46C1]" />
                      <span className="w-8 font-mono-data text-[11px] text-primary">{s.searchWeight}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-center text-[11px] text-muted-foreground/60">A 類產品自動提升搜尋排名，可手動微調權重（0–100）</p>
      </div>
    </div>
  );
}

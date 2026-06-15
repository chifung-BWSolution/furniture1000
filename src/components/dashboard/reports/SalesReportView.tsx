import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, FileSpreadsheet, Database, Target } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  MOCK_SALES_KPIS, MOCK_SALES_TREND, MOCK_CATEGORY_SHARE, CHART_COLORS, PIE_COLORS,
} from '@/constants/analytics-mock';
import { toast } from 'sonner';

const fmtMoney = (v: number) => `$${(v / 1000).toFixed(0)}k`;

export function SalesReportView() {
  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h1 className="font-display text-2xl font-bold tracking-tight">銷售報告</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => toast.success('已匯出 Excel')} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"><FileSpreadsheet className="h-3.5 w-3.5" /> 匯出 Excel</button>
            <button onClick={() => toast.success('已同步 PMS 採購單')} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"><Database className="h-3.5 w-3.5" /> 同步 PMS</button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {MOCK_SALES_KPIS.map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-card p-4">
              <p className="font-body text-[11.5px] text-muted-foreground">{k.label}</p>
              <p className="mt-1 font-display text-xl font-bold text-foreground">{k.value}</p>
              <p className={cn('mt-1 flex items-center gap-0.5 text-[11px] font-medium', k.positive ? 'text-emerald-600' : 'text-rose-500')}>
                {k.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{k.delta}
              </p>
            </div>
          ))}
        </div>

        {/* sales trend line */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-4 font-display text-sm font-bold">報價額 vs 成交額趨勢</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={MOCK_SALES_TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tickFormatter={fmtMoney} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid hsl(var(--border))' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="報價額" stroke={CHART_COLORS.primarySoft} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="成交額" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* category pie */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 font-display text-sm font-bold">熱門分類佔比</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={MOCK_CATEGORY_SHARE} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => `${e.name} ${e.value}%`} labelLine={false} fontSize={11}>
                  {MOCK_CATEGORY_SHARE.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid hsl(var(--border))' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* monthly deal bar */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 font-display text-sm font-bold">月度成交額</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={MOCK_SALES_TREND}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tickFormatter={fmtMoney} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="成交額" fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* target alert */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <Target className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-display text-sm font-bold text-amber-700 dark:text-amber-400">銷售目標達成率 83%</p>
            <p className="font-body text-[12px] text-muted-foreground">距本月目標 $2.24M 尚差 $380k，建議聚焦 A 類辦公桌與座椅報價跟進。</p>
          </div>
          <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-amber-500" style={{ width: '83%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

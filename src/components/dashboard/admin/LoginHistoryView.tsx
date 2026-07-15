import { useState, useMemo, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  History, Search, FileSpreadsheet, AlertTriangle, ShieldAlert, Globe, Loader2, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  LOG_TYPE_META, CHART_COLORS,
  type LogType,
} from '@/constants/analytics-mock';
import { fetchPlatformAdminData } from '@/lib/adminApi';
import type { LoginLog, SecurityTrendPoint } from '@/lib/adminApi';
import { toast } from 'sonner';

const TYPE_FILTERS: { key: LogType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'login', label: '登入' },
  { key: 'failed', label: '登入失敗' },
  { key: 'edit', label: '編輯' },
  { key: 'publish', label: '發佈' },
  { key: 'logout', label: '登出' },
];

function fmt(d: string) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

/** Fixed-width detail column — publish SKUs wrap per item to next line when needed. */
const DETAIL_COL_CLASS = 'w-[300px] min-w-[300px] max-w-[300px]';

function LogDetailCell({ log }: { log: LoginLog }) {
  if (log.type === 'publish' && log.skus && log.skus.length > 0) {
    return (
      <div className={cn(DETAIL_COL_CLASS, 'flex flex-wrap items-baseline gap-y-0.5 font-mono-data text-[11.5px] leading-relaxed text-muted-foreground')}>
        {log.skus.map((sku, i) => (
          <span key={`${sku}-${i}`} className="whitespace-nowrap">
            &quot;{sku}&quot;{i < log.skus!.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
    );
  }

  if (log.detail) {
    return (
      <span className={cn(DETAIL_COL_CLASS, 'block font-body text-[12px] leading-relaxed text-muted-foreground whitespace-normal break-words')}>
        {log.detail}
      </span>
    );
  }

  return <span className="text-[12px] text-muted-foreground/30">—</span>;
}

function exportLogsCsv(logs: LoginLog[]) {
  const header = ['用戶', '頁面 / 內容', '操作', 'IP', '位置', '時間'];
  const rows = logs.map((l) => [
    l.user,
    l.type === 'publish' && l.skus?.length
      ? l.skus.map((s) => `"${s}"`).join(', ')
      : (l.detail ?? ''),
    LOG_TYPE_META[l.type].label,
    l.ip,
    l.location,
    fmt(l.at),
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `login-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function LoginHistoryView() {
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [securityTrend, setSecurityTrend] = useState<SecurityTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<LogType | 'all'>('all');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const data = await fetchPlatformAdminData();
    setLogs(data.logs);
    setSecurityTrend(data.securityTrend);
    if (!silent) setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => logs.filter((l) => {
    if (search) {
      const q = search.toLowerCase();
      const hay = [
        l.user,
        l.email ?? '',
        l.detail ?? '',
        ...(l.skus ?? []),
        l.ip,
        l.location,
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (typeFilter !== 'all' && l.type !== typeFilter) return false;
    return true;
  }), [search, typeFilter, logs]);

  const suspicious = useMemo(() => logs.filter((l) => l.suspicious), [logs]);
  const totalFailed = useMemo(
    () => securityTrend.reduce((s, d) => s + d.失敗, 0),
    [securityTrend],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">登入紀錄</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">
            {logs.length} 筆日誌 · {suspicious.length} 異常
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋用戶 / IP..."
              className="h-8 w-48 rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} /> 重新載入
          </button>
          <button
            type="button"
            onClick={() => {
              exportLogsCsv(filtered);
              toast.success('已匯出日誌 CSV');
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> 匯出日誌
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setTypeFilter(f.key)}
                className={cn('rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors', typeFilter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium w-[140px]">用戶</th>
                  <th className={cn('px-3 py-2.5 text-left font-medium', DETAIL_COL_CLASS)}>頁面 / 內容</th>
                  <th className="px-3 py-2.5 text-left font-medium w-[88px]">操作</th>
                  <th className="px-3 py-2.5 text-left font-medium">IP / 位置</th>
                  <th className="px-3 py-2.5 text-left font-medium w-[130px]">時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.map((l) => (
                  <tr key={l.id} className={cn('hover:bg-muted/30 align-top', l.suspicious && 'bg-rose-500/[0.04]')}>
                    <td className="px-4 py-2.5">
                      <span className="flex items-start gap-1.5 font-body text-[13px] text-foreground whitespace-normal break-words">
                        {l.suspicious && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
                        {l.user}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <LogDetailCell log={l} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap', LOG_TYPE_META[l.type].className)}>
                        {LOG_TYPE_META[l.type].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-start gap-1 font-mono-data text-[11.5px] text-muted-foreground whitespace-normal break-words">
                        <Globe className="mt-0.5 h-3 w-3 shrink-0" />
                        {l.ip} · {l.location}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono-data text-[11.5px] text-muted-foreground whitespace-nowrap">{fmt(l.at)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-[12px] text-muted-foreground/60">
                      {logs.length === 0 ? '尚無系統日誌紀錄' : '無符合條件的日誌'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="flex w-[340px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-sidebar p-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              <h4 className="font-display text-sm font-bold">異常登入警示</h4>
            </div>
            {suspicious.length === 0 ? (
              <p className="rounded-xl border border-border bg-card py-6 text-center text-[11px] text-muted-foreground">
                目前無異常登入紀錄
              </p>
            ) : (
              <div className="space-y-2">
                {suspicious.map((l) => (
                  <div key={l.id} className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                    <p className="flex items-center gap-1 font-display text-[12.5px] font-semibold text-rose-700 dark:text-rose-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {l.user}
                    </p>
                    <p className="mt-0.5 font-body text-[11px] text-muted-foreground">
                      異地登入：{l.location}（{l.ip}）
                    </p>
                    <p className="font-mono-data text-[10px] text-muted-foreground/60">{fmt(l.at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-3">
            <h4 className="mb-3 font-display text-sm font-bold">安全事件趨勢（7 日）</h4>
            {securityTrend.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={securityTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid hsl(var(--border))' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="成功" stackId="a" fill={CHART_COLORS.emerald} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="失敗" stackId="a" fill={CHART_COLORS.rose} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-1 text-center text-[10.5px] text-muted-foreground/60">
                  本週累計 SSO 登入 {securityTrend.reduce((s, d) => s + d.成功, 0)} 次
                  {totalFailed > 0 ? ` · 失敗 ${totalFailed} 次` : ''}
                </p>
              </>
            ) : (
              <p className="py-8 text-center text-[11px] text-muted-foreground">暫無趨勢資料</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

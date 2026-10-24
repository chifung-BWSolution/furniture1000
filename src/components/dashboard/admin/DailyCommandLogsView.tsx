import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  AlertCircle, Download, ListChecks, RefreshCw, ScrollText, Search, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Modal, ModalButton } from '@/components/ui/modal';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  COMMAND_LOG_PAGE_SIZE,
  deleteCommandLog,
  developmentOpsError,
  emptyCommandLogFilters,
  formatDuration,
  formatNumber,
  formatUsd,
  getCommandLogAnalytics,
  getCommandLogs,
  type CommandLogAnalytics,
  type CommandLogFilters,
  type CommandLogRow,
  type CommandLogStatus,
} from '@/lib/developmentOps';

const statusLabels: Record<CommandLogStatus, string> = {
  running: '執行中',
  completed: '已完成',
  failed: '失敗',
  cancelled: '取消',
};

const statusVariants: Record<CommandLogStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  completed: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
};

const percentFormat = new Intl.NumberFormat('zh-HK', { style: 'percent', maximumFractionDigits: 1 });

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatHkDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium leading-4 text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold leading-8 tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  );
}

export function DailyCommandLogsView() {
  const [filters, setFilters] = useState<CommandLogFilters>(emptyCommandLogFilters);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CommandLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [analytics, setAnalytics] = useState<CommandLogAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CommandLogRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const appliedSearchRef = useRef(filters.search);
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (appliedSearchRef.current === filters.search) return;
      appliedSearchRef.current = filters.search;
      setDebouncedSearch(filters.search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const { from, to, developerEmail, status, model } = filters;
  const queryFilters = useMemo<CommandLogFilters>(
    () => ({ from, to, developerEmail, status, model, search: debouncedSearch }),
    [from, to, developerEmail, status, model, debouncedSearch],
  );

  const load = useCallback(async (nextFilters: CommandLogFilters, nextPage: number) => {
    setLoading(true);
    setError('');
    try {
      const [list, stats] = await Promise.all([
        getCommandLogs(nextFilters, nextPage),
        getCommandLogAnalytics(nextFilters),
      ]);
      setRows(list.rows);
      setTotal(list.total);
      setAnalytics(stats);
    } catch (err) {
      setError(developmentOpsError(err as { message?: string }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(queryFilters, page);
  }, [queryFilters, page, load]);

  const totalPages = Math.max(1, Math.ceil(total / COMMAND_LOG_PAGE_SIZE));
  const summary = analytics?.summary;

  // 對照 QMS qms_dev_command_logs_analytics：完成率 30%、每小時完成量 25%、完成時間效率 20%、Credit 效率 15%、低失敗率 10%（min-max normalize 後 0–100）。
  const developerPerformance = useMemo(() => {
    const base = (analytics?.developers ?? []).map((d) => {
      const total = d.totalCommands || 0;
      const completed = d.completedCount || 0;
      const duration = d.totalDurationSeconds || 0;
      return {
        email: d.developerEmail,
        name: d.developerName,
        total,
        completed,
        failed: d.failedCount || 0,
        completionRate: safeDivide(completed, total),
        avgCompletionSeconds: completed > 0 ? duration / completed : null,
        completionsPerHour: safeDivide(completed * 3600, duration),
        avgCreditPerCommand: safeDivide(d.totalCredits || 0, total),
        dailyAvgSeconds: safeDivide(duration, d.activeDays || 0),
        totalCredits: d.totalCredits || 0,
        totalCostUsd: d.totalCostUsd || 0,
        score: 0,
        rank: 0,
      };
    });
    const bounds = (get: (r: (typeof base)[number]) => number | null) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const row of base) {
        const value = get(row);
        if (value === null) continue;
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      if (lo === Infinity) return null;
      return { lo, hi } as const;
    };
    const normalized = (value: number, range: ReturnType<typeof bounds>, inverted: boolean) => {
      if (!range || range.lo === range.hi) return 100;
      const pct = ((value - range.lo) / (range.hi - range.lo)) * 100;
      return inverted ? 100 - pct : pct;
    };
    const cr = bounds((r) => r.completionRate);
    const cph = bounds((r) => r.completionsPerHour);
    const act = bounds((r) => r.avgCompletionSeconds);
    const acpc = bounds((r) => r.avgCreditPerCommand);
    const fr = bounds((r) => safeDivide(r.failed, r.total));
    for (const row of base) {
      const sCr = normalized(row.completionRate, cr, false);
      const sCph = normalized(row.completionsPerHour, cph, false);
      const sAct = row.avgCompletionSeconds === null ? 0 : normalized(row.avgCompletionSeconds, act, true);
      const sAcpc = normalized(row.avgCreditPerCommand, acpc, true);
      const sFr = normalized(safeDivide(row.failed, row.total), fr, true);
      row.score = Math.round(Math.max(0, Math.min(100, 0.3 * sCr + 0.25 * sCph + 0.2 * sAct + 0.15 * sAcpc + 0.1 * sFr)) * 10) / 10;
    }
    base.sort((a, b) => b.score - a.score || b.completed - a.completed);
    base.forEach((row, index) => { row.rank = index + 1; });
    return base;
  }, [analytics]);

  const updateFilter = (patch: Partial<CommandLogFilters>) => {
    if (!('search' in patch)) setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const all = await getCommandLogs(queryFilters, 1, 2000);
      const sheet = XLSX.utils.json_to_sheet(all.rows.map((row) => ({
        日期: row.businessDate,
        程式員: row.developerName,
        電郵: row.developerEmail,
        指令字眼: row.instructionText,
        開始時間: formatHkDateTime(row.startedAt),
        完成時間: formatHkDateTime(row.completedAt),
        所需時間: formatDuration(row.durationSeconds),
        模型: row.model ?? '',
        Credit: row.creditsUsed ?? '',
        '成本(USD)': row.costUsd ?? '',
        狀態: statusLabels[row.status],
        結果: row.resultSummary ?? '',
        失敗原因: row.failureReason ?? '',
        工作編號: row.taskReference ?? '',
      })));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, '指令明細');
      XLSX.writeFile(book, `每日指令記錄-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      toast.error(developmentOpsError(err as { message?: string }));
    } finally {
      setExporting(false);
    }
  };

  const remove = async (row: CommandLogRow) => {
    const ok = await confirm({
      title: '刪除這筆指令記錄？',
      description: `刪除 ${row.developerName} 於 ${row.businessDate} 的指令記錄，刪除後無法復原。`,
      confirmLabel: '刪除',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteCommandLog(row.id);
      toast.success('已刪除指令記錄');
      setSelected(null);
      await load(queryFilters, page);
    } catch (err) {
      toast.error(developmentOpsError(err as { message?: string }));
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-none flex-col gap-5 overflow-y-auto fds-page-padding">
      <header className="fds-page-header flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div>
            <h1 className="fds-page-title"><ListChecks className="h-5 w-5 text-primary" />每日指令記錄</h1>
            <p className="fds-page-description">
              檢視開發指令的字眼、開始與完成時間、模型、Credit 與工具成本（USD）。日期以香港時間計算。
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load(queryFilters, page)} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            重新載入
          </Button>
          <Button type="button" size="sm" onClick={() => void exportExcel()} disabled={exporting}>
            <Download className="mr-1 h-4 w-4" />
            匯出 Excel
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="今日指令" value={formatNumber(summary?.todayCommandCount ?? 0)} hint={`完成 ${summary?.todayCompletedCount ?? 0} · 執行中 ${summary?.todayRunningCount ?? 0}`} />
        <Stat label="今日失敗" value={formatNumber(summary?.todayFailedCount ?? 0)} hint="狀態為失敗" />
        <Stat label="今日工具成本" value={formatUsd(summary?.todayCostUsd ?? 0)} hint="來源工具 USD，不換算港元" />
        <Stat label="本月工時" value={formatDuration(summary?.monthDurationSeconds ?? 0)} hint={`${summary?.monthCommandCount ?? 0} 條指令`} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
        <Input type="date" aria-label="開始日期" value={filters.from} onChange={(e) => updateFilter({ from: e.target.value })} className="w-40" />
        <Input type="date" aria-label="結束日期" value={filters.to} onChange={(e) => updateFilter({ to: e.target.value })} className="w-40" />
        <Select value={filters.status || 'all'} onValueChange={(value) => updateFilter({ status: value === 'all' ? '' : value })}>
          <SelectTrigger className="w-36" aria-label="狀態"><SelectValue placeholder="全部狀態" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            {Object.entries(statusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.developerEmail || 'all'} onValueChange={(value) => updateFilter({ developerEmail: value === 'all' ? '' : value })}>
          <SelectTrigger className="w-48" aria-label="程式員"><SelectValue placeholder="全部程式員" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部程式員</SelectItem>
            {(analytics?.options.developers ?? []).map((person) => (
              <SelectItem key={person.email} value={person.email}>{person.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="搜尋指令" value={filters.search} placeholder="搜尋指令、結果或程式員" className="pl-9" onChange={(e) => updateFilter({ search: e.target.value })} />
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : (
        <Tabs defaultValue="detail">
          <TabsList>
            <TabsTrigger value="detail">指令明細</TabsTrigger>
            <TabsTrigger value="daily">每日統計</TabsTrigger>
            <TabsTrigger value="performance">程式員表現</TabsTrigger>
          </TabsList>

          <TabsContent value="detail" className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px] table-fixed text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-28 px-4 py-3">日期</th>
                    <th className="w-44 px-3 py-3">程式員</th>
                    <th className="w-72 px-3 py-3">指令字眼</th>
                    <th className="w-36 px-3 py-3">開始時間</th>
                    <th className="w-36 px-3 py-3">完成時間</th>
                    <th className="w-24 px-3 py-3 text-right">所需時間</th>
                    <th className="w-32 px-3 py-3">模型</th>
                    <th className="w-20 px-3 py-3 text-right">Credit</th>
                    <th className="w-24 px-3 py-3 text-right">成本(USD)</th>
                    <th className="w-24 px-3 py-3">狀態</th>
                    <th className="w-20 px-3 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">正在載入…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">這個範圍還沒有指令記錄</td></tr>
                  ) : rows.map((row) => (
                    <tr key={row.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(row)}>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.businessDate}</td>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{row.developerName}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{row.developerEmail}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="line-clamp-2" title={row.instructionText}>{row.instructionText || '（無指令字眼）'}</p>
                      </td>
                      <td className="px-3 py-3 text-xs">{formatHkDateTime(row.startedAt)}</td>
                      <td className="px-3 py-3 text-xs">{formatHkDateTime(row.completedAt)}</td>
                      <td className="px-3 py-3 text-right text-xs">{formatDuration(row.durationSeconds)}</td>
                      <td className="px-3 py-3 text-xs">{row.model || '—'}</td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums">{formatNumber(row.creditsUsed)}</td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums">{formatUsd(row.costUsd)}</td>
                      <td className="px-3 py-3"><Badge variant={statusVariants[row.status]}>{statusLabels[row.status]}</Badge></td>
                      <td className="px-3 py-3 text-right">
                        <Button type="button" size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelected(row); }}>查看</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span>共 {total} 筆</span>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一頁</Button>
                <span>{page} / {totalPages}</span>
                <Button type="button" size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一頁</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="daily" className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1380px] table-fixed text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-28 px-4 py-3">日期</th>
                    <th className="w-48 px-3 py-3">程式員</th>
                    <th className="w-24 px-3 py-3 text-right">指令總數</th>
                    <th className="w-20 px-3 py-3 text-right">完成</th>
                    <th className="w-20 px-3 py-3 text-right">失敗</th>
                    <th className="w-24 px-3 py-3 text-right">完成率</th>
                    <th className="w-28 px-3 py-3 text-right">每日 Credit</th>
                    <th className="w-28 px-3 py-3 text-right">每日成本(USD)</th>
                    <th className="w-32 px-3 py-3 text-right">每日總時間</th>
                    <th className="w-32 px-3 py-3 text-right">平均完成時間</th>
                    <th className="w-32 px-3 py-3 text-right">每小時完成量</th>
                    <th className="w-32 px-3 py-3 text-right">平均每條 Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(analytics?.daily ?? []).length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">沒有每日統計</td></tr>
                  ) : analytics?.daily.map((row) => (
                    <tr key={`${row.businessDate}-${row.developerEmail}`}>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.businessDate}</td>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{row.developerName}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{row.developerEmail}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.totalCommands}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.completedCount}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.failedCount}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{percentFormat.format(safeDivide(row.completedCount, row.totalCommands))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.totalCredits)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatUsd(row.totalCostUsd)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatDuration(row.totalDurationSeconds)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatDuration(row.completedCount > 0 ? Math.round(safeDivide(row.totalDurationSeconds, row.completedCount)) : null)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(safeDivide(row.completedCount * 3600, row.totalDurationSeconds))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(safeDivide(row.totalCredits, row.totalCommands))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="performance" className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1580px] table-fixed text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-16 px-4 py-3">排名</th>
                    <th className="w-48 px-3 py-3">程式員</th>
                    <th className="w-24 px-3 py-3 text-right">完成指令數</th>
                    <th className="w-24 px-3 py-3 text-right">完成率</th>
                    <th className="w-32 px-3 py-3 text-right">平均完成時間</th>
                    <th className="w-36 px-3 py-3 text-right">每日平均工作時間</th>
                    <th className="w-24 px-3 py-3 text-right">總 Credit</th>
                    <th className="w-28 px-3 py-3 text-right">總成本(USD)</th>
                    <th className="w-32 px-3 py-3 text-right">每條平均 Credit</th>
                    <th className="w-36 px-3 py-3 text-right">每小時完成指令數</th>
                    <th className="w-24 px-3 py-3 text-right">失敗次數</th>
                    <th className="w-32 px-3 py-3 text-right">工作表現分數</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {developerPerformance.length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">沒有程式員統計</td></tr>
                  ) : developerPerformance.map((row) => (
                    <tr key={row.email}>
                      <td className="px-4 py-3">
                        <span className={`inline-grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${row.rank === 1 ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'}`}>{row.rank}</span>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{row.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{row.email}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.completed} / {row.total}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{percentFormat.format(row.completionRate)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatDuration(row.avgCompletionSeconds === null ? null : Math.round(row.avgCompletionSeconds))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatDuration(Math.round(row.dailyAvgSeconds))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.totalCredits)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatUsd(row.totalCostUsd)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.avgCreditPerCommand)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.completionsPerHour)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.failed}</td>
                      <td className="px-3 py-3 text-right">
                        <Badge variant={row.score >= 80 ? 'default' : row.score >= 50 ? 'secondary' : 'outline'}>{row.score.toFixed(1)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      <Modal
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        size="2xl"
        icon={<ScrollText className="h-6 w-6" />}
        title={`${selected?.developerName ?? ''} · ${selected ? statusLabels[selected.status] : ''}`}
        description="指令執行紀錄詳情"
        footer={
          selected ? (
            <>
              <ModalButton variant="destructive" onClick={() => void remove(selected)}>
                <Trash2 className="h-4 w-4" />
                刪除
              </ModalButton>
              <ModalButton variant="secondary" onClick={() => setSelected(null)}>
                關閉
              </ModalButton>
            </>
          ) : null
        }
      >
        {selected && (
          <dl className="space-y-2 text-sm">
            <Detail label="電郵" value={selected.developerEmail} />
            <Detail label="指令字眼" value={selected.instructionText} />
            <Detail label="開始" value={formatHkDateTime(selected.startedAt)} />
            <Detail label="完成" value={formatHkDateTime(selected.completedAt)} />
            <Detail label="所需時間" value={formatDuration(selected.durationSeconds)} />
            <Detail label="模型" value={selected.model ?? '—'} />
            <Detail label="Credit" value={formatNumber(selected.creditsUsed)} />
            <Detail label="成本 (USD)" value={formatUsd(selected.costUsd)} />
            <Detail
              label="Token 用量"
              value={
                selected.inputTokens === null && selected.outputTokens === null
                  ? '—'
                  : `輸入 ${formatNumber(selected.inputTokens)}（快取 ${formatNumber(selected.cachedInputTokens)}）／輸出 ${formatNumber(selected.outputTokens)}`
              }
            />
            <Detail label="結果" value={selected.resultSummary ?? '—'} />
            <Detail label="失敗原因" value={selected.failureReason ?? '—'} />
            <Detail label="工作編號" value={selected.taskReference ?? '—'} />
          </dl>
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 border-b border-border py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{value}</dd>
    </div>
  );
}

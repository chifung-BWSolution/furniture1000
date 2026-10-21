import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  AlertCircle, Clock, Coins, Download, ListChecks, RefreshCw, ScrollText, Search, Trash2, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Modal, ModalButton } from '@/components/ui/modal';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
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
        指令: row.instructionText,
        狀態: statusLabels[row.status],
        開始: formatHkDateTime(row.startedAt),
        完成: formatHkDateTime(row.completedAt),
        所需時間: formatDuration(row.durationSeconds),
        模型: row.model ?? '',
        Credit: row.creditsUsed ?? '',
        成本USD: row.costUsd ?? '',
        結果: row.resultSummary ?? '',
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
    if (!window.confirm(`刪除 ${row.developerName} 於 ${row.businessDate} 的指令記錄？`)) return;
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <ListChecks className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold">每日指令記錄</h1>
            <p className="mt-1 max-w-3xl font-body text-sm text-muted-foreground">
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
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">程式員</th>
                    <th className="px-3 py-3">指令</th>
                    <th className="px-3 py-3">狀態</th>
                    <th className="px-3 py-3">時間</th>
                    <th className="px-3 py-3">成本</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">正在載入…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">這個範圍還沒有指令記錄</td></tr>
                  ) : rows.map((row) => (
                    <tr key={row.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(row)}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{row.developerName}</p>
                        <p className="text-[11px] text-muted-foreground">{row.businessDate}</p>
                      </td>
                      <td className="max-w-md px-3 py-3">
                        <p className="line-clamp-2">{row.instructionText}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{row.model ?? '未標示模型'}</p>
                      </td>
                      <td className="px-3 py-3"><Badge variant="secondary">{statusLabels[row.status]}</Badge></td>
                      <td className="px-3 py-3 text-xs">{formatDuration(row.durationSeconds)}</td>
                      <td className="px-3 py-3 text-xs">{formatUsd(row.costUsd)}</td>
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
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">日期</th>
                  <th className="px-3 py-3">程式員</th>
                  <th className="px-3 py-3">指令</th>
                  <th className="px-3 py-3">完成</th>
                  <th className="px-3 py-3">工時</th>
                  <th className="px-3 py-3">USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(analytics?.daily ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">沒有每日統計</td></tr>
                ) : analytics?.daily.map((row) => (
                  <tr key={`${row.businessDate}-${row.developerEmail}`}>
                    <td className="px-4 py-3">{row.businessDate}</td>
                    <td className="px-3 py-3">{row.developerName}</td>
                    <td className="px-3 py-3">{row.totalCommands}</td>
                    <td className="px-3 py-3">{row.completedCount}</td>
                    <td className="px-3 py-3">{formatDuration(row.totalDurationSeconds)}</td>
                    <td className="px-3 py-3">{formatUsd(row.totalCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="performance" className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3"><Users className="mr-1 inline h-3.5 w-3.5" />程式員</th>
                  <th className="px-3 py-3">完成 / 總數</th>
                  <th className="px-3 py-3"><Clock className="mr-1 inline h-3.5 w-3.5" />工時</th>
                  <th className="px-3 py-3"><Coins className="mr-1 inline h-3.5 w-3.5" />Credit</th>
                  <th className="px-3 py-3">活躍日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(analytics?.developers ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">沒有程式員統計</td></tr>
                ) : analytics?.developers.map((row, index) => (
                  <tr key={row.developerEmail}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{index + 1}. {row.developerName}</p>
                      <p className="text-[11px] text-muted-foreground">{row.developerEmail}</p>
                    </td>
                    <td className="px-3 py-3">{row.completedCount} / {row.totalCommands}</td>
                    <td className="px-3 py-3">{formatDuration(row.totalDurationSeconds)}</td>
                    <td className="px-3 py-3">{formatNumber(row.totalCredits)}</td>
                    <td className="px-3 py-3">{row.activeDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              <ModalButton variant="ghost" onClick={() => setSelected(null)}>
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
            <Detail label="結果" value={selected.resultSummary ?? '—'} />
            <Detail label="失敗原因" value={selected.failureReason ?? '—'} />
          </dl>
        )}
      </Modal>
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

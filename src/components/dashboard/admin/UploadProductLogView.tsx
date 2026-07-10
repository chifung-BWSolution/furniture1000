import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ClipboardList, RefreshCw, Loader2, Clock, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { UploadLogStage } from '@/lib/uploadLog';
import {
  fetchUploadLogReport,
  formatHkDateLabel,
  formatHkDateTime,
  STAGE_LABELS,
  UPLOAD_LOG_STAGES,
  type DailyReportRow,
  type UploadLogReport,
  type UserActivity,
} from '@/lib/uploadLogReport';

const STAGE_COLORS: Record<UploadLogStage, string> = {
  copywriting: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  product_info: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  furniture_group_check: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  ready_to_publish: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

function PendingCell({ count, isToday }: { count: number; isToday: boolean }) {
  if (!isToday) {
    return <span className="font-mono-data text-[12px] text-muted-foreground/40">—</span>;
  }
  return (
    <span className="font-mono-data text-[13px] font-semibold text-foreground">
      {count}
      <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">件</span>
    </span>
  );
}

function ProcessedCell({
  stats,
  isToday,
}: {
  stats: { completedCount: number; users: UserActivity[] };
  isToday: boolean;
}) {
  const label = isToday ? '今日已處理' : '當日已處理';

  return (
    <div className="min-w-[120px]">
      <p className="text-[11px] text-muted-foreground">
        {label}
        <span className="ml-1 font-mono-data text-[13px] font-semibold text-primary">
          {stats.completedCount}
        </span>
        件
      </p>
      {stats.users.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-border/50 pt-1.5">
          {stats.users.map((u) => (
            <li
              key={u.userName}
              className="flex items-center justify-between gap-2 text-[11px] text-foreground"
            >
              <span className="truncate">{u.userName}</span>
              <span className="shrink-0 font-mono-data text-muted-foreground">{u.count} 件</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[10.5px] text-muted-foreground/40">—</p>
      )}
    </div>
  );
}

function DailyTableRow({
  row,
  todayHk,
  pendingCounts,
}: {
  row: DailyReportRow;
  todayHk: string;
  pendingCounts: Record<UploadLogStage, number>;
}) {
  const isToday = row.hkDate === todayHk;

  return (
    <tr className={cn('align-top hover:bg-muted/20', isToday && 'bg-primary/[0.03]')}>
      <td className="whitespace-nowrap border-r border-border/40 px-4 py-3">
        <span
          className={cn(
            'font-mono-data text-[12px]',
            isToday ? 'font-semibold text-primary' : 'text-foreground',
          )}
        >
          {formatHkDateLabel(row.hkDate, todayHk)}
        </span>
      </td>
      {UPLOAD_LOG_STAGES.map((stage, idx) => (
        <td
          key={stage}
          colSpan={2}
          className={cn('p-0', idx < UPLOAD_LOG_STAGES.length - 1 && 'border-r border-border/40')}
        >
          <div className="grid grid-cols-2 divide-x divide-border/40">
            <div className="px-3 py-3">
              <PendingCell count={pendingCounts[stage]} isToday={isToday} />
            </div>
            <div className="px-3 py-3">
              <ProcessedCell stats={row.stages[stage]} isToday={isToday} />
            </div>
          </div>
        </td>
      ))}
    </tr>
  );
}

export function UploadProductLogView() {
  const [report, setReport] = useState<UploadLogReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(formatHkDateTime());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'all'>('single');

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    setError(null);
    try {
      const data = await fetchUploadLogReport(30);
      setReport(data);
      setSelectedDate((prev) => {
        if (prev && data.dailyRows.some((r) => r.hkDate === prev)) return prev;
        return data.todayHk;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshTimer = setInterval(() => void load(true), 60_000);
    const clockTimer = setInterval(() => setClock(formatHkDateTime()), 1000);
    return () => {
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    };
  }, [load]);

  const selectedRow = useMemo(
    () => report?.dailyRows.find((r) => r.hkDate === selectedDate) ?? null,
    [report, selectedDate],
  );

  const selectedIndex = useMemo(
    () => (report && selectedDate ? report.dailyRows.findIndex((r) => r.hkDate === selectedDate) : -1),
    [report, selectedDate],
  );

  const goPrevDay = () => {
    if (!report || selectedIndex < 0 || selectedIndex >= report.dailyRows.length - 1) return;
    setSelectedDate(report.dailyRows[selectedIndex + 1].hkDate);
  };

  const goNextDay = () => {
    if (!report || selectedIndex <= 0) return;
    setSelectedDate(report.dailyRows[selectedIndex - 1].hkDate);
  };

  const displayRows = viewMode === 'all'
    ? (report?.dailyRows ?? [])
    : selectedRow
      ? [selectedRow]
      : [];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">上載產品紀錄</h2>
          {report && (
            <span className="font-mono-data text-[11px] text-muted-foreground">
              最近 30 日 · 香港時間 {clock}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {report && (
            <>
              <div className="flex items-center rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={goPrevDay}
                  disabled={selectedIndex < 0 || selectedIndex >= report.dailyRows.length - 1}
                  className="px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="較早日期"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <select
                  value={selectedDate ?? report.todayHk}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setViewMode('single');
                  }}
                  className="h-8 min-w-[148px] border-x border-border bg-transparent px-2 font-mono-data text-[12px] focus:outline-none"
                >
                  {report.dailyRows.map((row) => (
                    <option key={row.hkDate} value={row.hkDate}>
                      {formatHkDateLabel(row.hkDate, report.todayHk)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={goNextDay}
                  disabled={selectedIndex <= 0}
                  className="px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="較近日期"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="flex rounded-lg border border-border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('single')}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                    viewMode === 'single'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  單日
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('all')}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                    viewMode === 'all'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  全部日期
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            重新整理
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          )}

          {isLoading && !report ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              載入紀錄中…
            </div>
          ) : report ? (
            <>
              {report.generatedAt && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                  <Clock className="h-3 w-3" />
                  資料更新於 {formatHkDateTime(new Date(report.generatedAt))}（香港時間）· 每 60 秒自動更新
                </p>
              )}

              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[960px] text-sm">
                  <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th rowSpan={2} className="w-[110px] border-r border-border/40 px-4 py-2.5 text-left font-medium align-middle">
                        日期
                      </th>
                      {UPLOAD_LOG_STAGES.map((stage, idx) => (
                        <th
                          key={stage}
                          colSpan={2}
                          className={cn(
                            'px-3 py-2 text-center font-medium',
                            STAGE_COLORS[stage],
                            idx < UPLOAD_LOG_STAGES.length - 1 && 'border-r border-border/40',
                          )}
                        >
                          {STAGE_LABELS[stage]}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {UPLOAD_LOG_STAGES.map((stage, idx) => (
                        <th
                          key={`${stage}-sub`}
                          colSpan={2}
                          className={cn(
                            'p-0 font-normal normal-case',
                            idx < UPLOAD_LOG_STAGES.length - 1 && 'border-r border-border/40',
                          )}
                        >
                          <div className="grid grid-cols-2 divide-x divide-border/40 text-[10px]">
                            <span className="px-3 py-1.5 text-center">目前停留</span>
                            <span className="px-3 py-1.5 text-center">已處理</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {displayRows.map((row) => (
                      <DailyTableRow
                        key={row.hkDate}
                        row={row}
                        todayHk={report.todayHk}
                        pendingCounts={report.pendingCounts}
                      />
                    ))}
                    {displayRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-6 py-10 text-center text-[12px] text-muted-foreground/60">
                          尚無上載產品紀錄
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-[10.5px] leading-relaxed text-muted-foreground/60">
                「目前停留」僅顯示今天（即時查詢）；過往日期只顯示當日已處理紀錄。各用戶處理件數加總等於當日已處理總數。
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

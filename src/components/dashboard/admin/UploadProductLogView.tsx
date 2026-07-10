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

const STAGE_ROW_COLORS: Record<UploadLogStage, string> = {
  copywriting: 'bg-violet-500/[0.06]',
  product_info: 'bg-sky-500/[0.06]',
  furniture_group_check: 'bg-amber-500/[0.06]',
  ready_to_publish: 'bg-emerald-500/[0.06]',
};

function PendingCell({ count, isToday }: { count: number; isToday: boolean }) {
  if (!isToday) {
    return <span className="font-mono-data text-xs text-muted-foreground/50">—</span>;
  }
  return (
    <span className="font-mono-data text-sm font-semibold text-foreground">
      {count}
      <span className="ml-0.5 text-xs font-normal text-muted-foreground">件</span>
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
    <div>
      <p className="text-xs leading-relaxed text-foreground">
        {label}
        <span className="ml-1 font-mono-data text-sm font-semibold text-primary">
          {stats.completedCount}
        </span>
        件
      </p>
      {stats.users.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 border-t border-border/40 pt-2.5">
          {stats.users.map((u) => (
            <li
              key={u.userName}
              className="flex items-center justify-between gap-4 text-xs text-muted-foreground"
            >
              <span className="truncate">{u.userName}</span>
              <span className="shrink-0 font-mono-data">{u.count} 件</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StageDayTable({
  row,
  todayHk,
  pendingCounts,
  showDateHeader = false,
}: {
  row: DailyReportRow;
  todayHk: string;
  pendingCounts: Record<UploadLogStage, number>;
  showDateHeader?: boolean;
}) {
  const isToday = row.hkDate === todayHk;

  return (
    <div className={cn(showDateHeader && 'space-y-3')}>
      {showDateHeader && (
        <h3
          className={cn(
            'font-display text-base font-bold',
            isToday ? 'text-primary' : 'text-foreground',
          )}
        >
          {formatHkDateLabel(row.hkDate, todayHk)}
        </h3>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full">
          <thead className="border-b border-border bg-muted/60">
            <tr>
              <th className="w-[148px] px-5 py-3.5 text-left text-sm font-bold text-foreground">
                階段
              </th>
              <th className="w-[160px] px-5 py-3.5 text-left text-sm font-bold text-foreground">
                產品目前停留
              </th>
              <th className="px-5 py-3.5 text-left text-sm font-bold text-foreground">
                今日已處理
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {UPLOAD_LOG_STAGES.map((stage) => (
              <tr key={stage} className={cn('align-top hover:bg-muted/20', STAGE_ROW_COLORS[stage])}>
                <td className="px-5 py-4">
                  <span className="font-display text-sm font-bold text-foreground">
                    {STAGE_LABELS[stage]}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <PendingCell count={pendingCounts[stage]} isToday={isToday} />
                </td>
                <td className="px-5 py-4">
                  <ProcessedCell stats={row.stages[stage]} isToday={isToday} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
          <h2 className="font-display text-base font-bold">上載產品紀錄</h2>
          {report && (
            <span className="font-mono-data text-xs text-muted-foreground">
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
                  className="h-9 min-w-[160px] border-x border-border bg-transparent px-2 font-mono-data text-xs focus:outline-none"
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
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
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
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
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
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            重新整理
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
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
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  資料更新於 {formatHkDateTime(new Date(report.generatedAt))}（香港時間）· 每 60 秒自動更新
                </p>
              )}

              {viewMode === 'single' && selectedRow && (
                <h3 className="font-display text-base font-bold text-primary">
                  {formatHkDateLabel(selectedRow.hkDate, report.todayHk)}
                </h3>
              )}

              <div className={cn(viewMode === 'all' && 'space-y-8')}>
                {displayRows.map((row) => (
                  <StageDayTable
                    key={row.hkDate}
                    row={row}
                    todayHk={report.todayHk}
                    pendingCounts={report.pendingCounts}
                    showDateHeader={viewMode === 'all'}
                  />
                ))}
                {displayRows.length === 0 && (
                  <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-xs text-muted-foreground">
                    尚無上載產品紀錄
                  </div>
                )}
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                「產品目前停留」僅顯示今天（即時查詢）；「今日已處理」整合 upload_log 及歷史時間戳，並透過 products.editor_staff_id 還原同事名稱及電郵。
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

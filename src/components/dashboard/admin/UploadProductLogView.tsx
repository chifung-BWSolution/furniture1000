import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ClipboardList, RefreshCw, Loader2, Users, Package, Clock,
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
  copywriting: 'border-violet-500/30 bg-violet-500/5',
  product_info: 'border-sky-500/30 bg-sky-500/5',
  furniture_group_check: 'border-amber-500/30 bg-amber-500/5',
  ready_to_publish: 'border-emerald-500/30 bg-emerald-500/5',
};

function UserChips({ users }: { users: UserActivity[] }) {
  if (users.length === 0) {
    return <span className="text-[11px] text-muted-foreground/50">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {users.map((u) => (
        <span
          key={u.userName}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10.5px] font-medium text-foreground"
        >
          <Users className="h-3 w-3 text-muted-foreground" />
          {u.userName}
          <span className="font-mono-data text-muted-foreground">×{u.count}</span>
        </span>
      ))}
    </div>
  );
}

function StageCell({
  stage,
  row,
  isToday,
  pendingCount,
}: {
  stage: UploadLogStage;
  row: DailyReportRow;
  isToday: boolean;
  pendingCount: number;
}) {
  const stats = row.stages[stage];
  return (
    <div className="space-y-1.5">
      {isToday && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Package className="h-3 w-3 shrink-0" />
          目前停留
          <span className="font-mono-data font-semibold text-foreground">{pendingCount}</span>
          件
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {isToday ? '今日' : '當日'}已修改/完成
        <span className="ml-1 font-mono-data font-semibold text-primary">{stats.completedCount}</span>
        件
      </p>
      <UserChips users={stats.users} />
    </div>
  );
}

export function UploadProductLogView() {
  const [report, setReport] = useState<UploadLogReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(formatHkDateTime());

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    setError(null);
    try {
      const data = await fetchUploadLogReport(30);
      setReport(data);
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

  const todayRow = report?.dailyRows.find((r) => r.hkDate === report.todayHk);

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

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
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
              {/* Live summary cards */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {UPLOAD_LOG_STAGES.map((stage) => (
                  <div
                    key={stage}
                    className={cn('rounded-xl border p-4', STAGE_COLORS[stage])}
                  >
                    <p className="font-display text-xs font-bold text-foreground">{STAGE_LABELS[stage]}</p>
                    <p className="mt-2 font-mono-data text-2xl font-bold text-foreground">
                      {report.pendingCounts[stage]}
                    </p>
                    <p className="text-[11px] text-muted-foreground">件產品目前停留</p>
                    {todayRow && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        今日已處理
                        <span className="ml-1 font-mono-data font-semibold text-primary">
                          {todayRow.stages[stage].completedCount}
                        </span>
                        件
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {report.generatedAt && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                  <Clock className="h-3 w-3" />
                  資料更新於 {formatHkDateTime(new Date(report.generatedAt))}（香港時間）· 每 60 秒自動更新
                </p>
              )}

              {/* Daily table */}
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="w-[110px] px-4 py-2.5 text-left font-medium">日期</th>
                      {UPLOAD_LOG_STAGES.map((stage) => (
                        <th key={stage} className="px-3 py-2.5 text-left font-medium">
                          {STAGE_LABELS[stage]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {report.dailyRows.map((row) => {
                      const isToday = row.hkDate === report.todayHk;
                      return (
                        <tr
                          key={row.hkDate}
                          className={cn('align-top hover:bg-muted/20', isToday && 'bg-primary/[0.03]')}
                        >
                          <td className="px-4 py-3">
                            <span className={cn(
                              'font-mono-data text-[12px]',
                              isToday ? 'font-semibold text-primary' : 'text-foreground',
                            )}>
                              {formatHkDateLabel(row.hkDate, report.todayHk)}
                            </span>
                          </td>
                          {UPLOAD_LOG_STAGES.map((stage) => (
                            <td key={stage} className="px-3 py-3">
                              <StageCell
                                stage={stage}
                                row={row}
                                isToday={isToday}
                                pendingCount={report.pendingCounts[stage]}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {report.dailyRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-[12px] text-muted-foreground/60">
                          尚無上載產品紀錄
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-[10.5px] leading-relaxed text-muted-foreground/60">
                「目前停留」為即時查詢各頁面待處理產品數；「已修改/完成」依 upload_log 紀錄統計（產品文案：提交到下一步；產品信息：儲存或完成；傢俬組檢查：儲存或加入準備上載；準備上載：成功上傳）。
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

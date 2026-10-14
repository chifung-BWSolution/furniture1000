import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CircleDollarSign, History, RefreshCw, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  developmentOpsError,
  formatDuration,
  formatHkd,
  formatUsd,
  getDevelopmentCostOverview,
  saveDevelopmentRate,
  type DevelopmentCostOverview,
  type DevelopmentMonthlyRow,
} from '@/lib/developmentOps';

function hkToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function monthLabel(value: string) {
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  return `${year} 年 ${Number(month)} 月`;
}

function rateRange(row: DevelopmentMonthlyRow) {
  if (!row.rateCount || row.rateMin === null) return '—';
  if (row.rateCount === 1 || row.rateMax === null || row.rateMin === row.rateMax) return formatHkd(row.rateMin);
  return `${formatHkd(row.rateMin)} – ${formatHkd(row.rateMax)}`;
}

const statusLabel = { priced: '已完整計價', partial: '部分未定價', none: '未有記錄' } as const;
const versionLabel = { current: '目前有效', scheduled: '未來排程', historical: '歷史' } as const;

export function DevelopmentCostView() {
  const [overview, setOverview] = useState<DevelopmentCostOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(hkToday);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOverview(await getDevelopmentCostOverview());
    } catch (err) {
      setError(developmentOpsError(err as { message?: string }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!overview) return;
    setSaving(true);
    try {
      await saveDevelopmentRate({
        hourlyRateHkd: Number(rate),
        effectiveFrom,
        changeReason: reason,
        expectedRevision: overview.currentRevision,
      });
      toast.success('已儲存時薪版本');
      setReason('');
      await load();
    } catch (err) {
      toast.error(developmentOpsError(err as { message?: string }));
    } finally {
      setSaving(false);
    }
  };

  const month = overview?.monthSummary;
  const app = overview?.appSummary;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <CircleDollarSign className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold">開發成本</h1>
            <p className="mt-1 max-w-3xl font-body text-sm text-muted-foreground">
              已完成指令的工時按香港日期套用港元時薪。工時成本（HKD）與工具成本（USD）分開計算，不會相加。
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          重新載入
        </Button>
      </header>

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">目前時薪</p>
              <p className="mt-1 font-display text-2xl font-bold">
                {overview?.currentRate ? `${formatHkd(overview.currentRate.rate)} / 小時` : '未設定'}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {overview?.currentRate ? `由 ${overview.currentRate.effectiveFrom} 起` : '儲存第一個版本後開始計價'}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">本月工時成本</p>
              <p className="mt-1 font-display text-2xl font-bold">{month ? formatHkd(month.labourCostHkd) : '—'}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{formatDuration(month?.durationSeconds)} · {statusLabel[month?.status ?? 'none']}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">本月工具成本</p>
              <p className="mt-1 font-display text-2xl font-bold">{month ? formatUsd(month.toolCostUsd) : '—'}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{month?.toolCostCount ?? 0} 筆有來源成本</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">累計工時成本</p>
              <p className="mt-1 font-display text-2xl font-bold">{app ? formatHkd(app.labourCostHkd) : '—'}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                未定價 {formatDuration(app?.unpricedSeconds)}
              </p>
            </div>
          </div>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                <Timer className="h-4 w-4" />
                每月成本
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">月份</th>
                      <th className="px-3 py-3">完成</th>
                      <th className="px-3 py-3">工時</th>
                      <th className="px-3 py-3">時薪</th>
                      <th className="px-3 py-3">工時成本</th>
                      <th className="px-3 py-3">工具成本</th>
                      <th className="px-3 py-3">狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loading ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">正在載入…</td></tr>
                    ) : (overview?.monthlyRows.length ?? 0) === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">尚未有已完成指令</td></tr>
                    ) : overview?.monthlyRows.map((row) => (
                      <tr key={row.monthStart}>
                        <td className="px-4 py-3 font-medium">{monthLabel(row.monthStart)}</td>
                        <td className="px-3 py-3">{row.completedCount}</td>
                        <td className="px-3 py-3">{formatDuration(row.durationSeconds)}</td>
                        <td className="px-3 py-3">{rateRange(row)}</td>
                        <td className="px-3 py-3">{row.pricedSeconds === 0 && row.unpricedSeconds > 0 ? '未定價' : formatHkd(row.labourCostHkd)}</td>
                        <td className="px-3 py-3">{row.toolCostCount === 0 ? '未有來源成本' : formatUsd(row.toolCostUsd)}</td>
                        <td className="px-3 py-3"><Badge variant="secondary">{statusLabel[row.status]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <form
              className="space-y-3 rounded-xl border border-border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <h2 className="font-display text-sm font-bold">調整時薪</h2>
              <p className="text-xs text-muted-foreground">新版本會附加到歷史，不會改寫舊費率。</p>
              <label className="block text-xs font-medium text-muted-foreground">
                每小時港元
                <Input className="mt-1" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                生效日期
                <Input className="mt-1" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                調整原因
                <Textarea className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} />
              </label>
              <Button type="submit" className="w-full" disabled={saving || !overview}>
                {saving ? '儲存中…' : '儲存新版本'}
              </Button>
            </form>
          </section>

          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
              <History className="h-4 w-4" />
              時薪版本
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">版本</th>
                  <th className="px-3 py-3">生效</th>
                  <th className="px-3 py-3">時薪</th>
                  <th className="px-3 py-3">原因</th>
                  <th className="px-3 py-3">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(overview?.rateVersions.length ?? 0) === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">尚未有時薪版本</td></tr>
                ) : overview?.rateVersions.map((row) => (
                  <tr key={row.revision}>
                    <td className="px-4 py-3">v{row.revision}</td>
                    <td className="px-3 py-3">{row.effectiveFrom}</td>
                    <td className="px-3 py-3">{formatHkd(row.rate)}</td>
                    <td className="px-3 py-3">
                      <p>{row.reason}</p>
                      <p className="text-[11px] text-muted-foreground">{row.createdByName}</p>
                    </td>
                    <td className="px-3 py-3"><Badge variant="secondary">{versionLabel[row.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

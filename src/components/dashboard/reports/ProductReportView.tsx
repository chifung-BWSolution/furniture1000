import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import {
  BarChart2,
  Building2,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  MousePointerClick,
  MoreHorizontal,
  Package,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productThumbUrl } from '@/lib/imageThumb';
import { LoadingImage } from '@/components/ui/loading-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Modal } from '@/components/ui/modal';
import { CompactEmptyState } from '@/components/ui/empty-state';
import {
  fetchProductReport,
  type ProductReportResult,
  type ProductReportRow,
} from '@/lib/quoteUsageReports';

/** 精選產品卡顯示數量。 */
const TOP_PRODUCTS = 5;
const PAGE_SIZES = [10, 20, 50] as const;

type MetricKey = 'usage' | 'quotes' | 'quantity';

const METRICS: Record<
  MetricKey,
  { label: string; unit: string; field: 'usageCount' | 'quoteCount' | 'quantitySum' }
> = {
  usage: { label: '使用次數', unit: '次', field: 'usageCount' },
  quotes: { label: '報價單數', unit: '張', field: 'quoteCount' },
  quantity: { label: '總數量', unit: '件', field: 'quantitySum' },
};

type Tone = 'sky' | 'violet' | 'amber' | 'emerald';

const TONE_CLASS: Record<Tone, string> = {
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

function fmtDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function defaultRange(): { from: Date; to: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { from: new Date(today.getFullYear(), 0, 1), to: today };
}

/** 與上一個等長期間比較的百分比。 */
function trendOf(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? null : ({ dir: 'up', label: '新增' } as const);
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { dir: 'flat', label: '持平' } as const;
  return { dir: pct > 0 ? 'up' : 'down', label: `${Math.abs(pct)}%` } as const;
}

function Trend({ current, previous }: { current: number; previous: number }) {
  const trend = trendOf(current, previous);
  if (!trend) {
    return <span className="text-[11px] text-muted-foreground/70">期間內無紀錄</span>;
  }
  const up = trend.dir === 'up';
  const flat = trend.dir === 'flat';
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <span
        className={cn(
          'flex items-center gap-0.5 font-mono-data font-semibold tabular-nums',
          flat
            ? 'text-muted-foreground'
            : up
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400',
        )}
      >
        {flat ? null : up ? (
          <TrendingUp className="h-3 w-3" />
        ) : (
          <TrendingDown className="h-3 w-3" />
        )}
        {trend.label}
      </span>
      <span className="text-muted-foreground/70">較上期</span>
    </span>
  );
}

function KpiCard({
  icon,
  tone,
  label,
  value,
  current,
  previous,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: number;
  current: number;
  previous: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONE_CLASS[tone])}>
          {icon}
        </span>
        <p className="font-body text-[12px] leading-snug text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 font-display text-2xl font-bold leading-none text-foreground tabular-nums">
        {value.toLocaleString()}
      </p>
      <div className="mt-2 min-h-4">
        <Trend current={current} previous={previous} />
      </div>
    </div>
  );
}

function RankBadge({ rank, active }: { rank: number; active?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {rank}
    </span>
  );
}

function Thumb({ src, className }: { src: string | null; className?: string }) {
  if (!src) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md border border-border bg-muted',
          className,
        )}
      >
        <Package className="h-4 w-4 text-muted-foreground/50" />
      </div>
    );
  }
  return (
    <LoadingImage
      src={productThumbUrl(src)}
      alt=""
      className={cn('shrink-0 rounded-md border border-border bg-muted object-cover', className)}
      loading="lazy"
      decoding="async"
    />
  );
}

const PRESETS: Array<{ label: string; get: () => { from: Date; to: Date } }> = [
  {
    label: '近 7 天',
    get: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 6);
      return { from, to };
    },
  },
  {
    label: '近 30 天',
    get: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 29);
      return { from, to };
    },
  },
  {
    label: '近 90 天',
    get: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 89);
      return { from, to };
    },
  },
  { label: '本年度', get: defaultRange },
  {
    label: '上年度',
    get: () => {
      const year = new Date().getFullYear() - 1;
      return { from: new Date(year, 0, 1), to: new Date(year, 11, 31) };
    },
  },
];

function RangeField({
  range,
  onApply,
}: {
  range: { from: Date; to: Date };
  onApply: (next: { from: Date; to: Date }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(range);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setDraft({ from: range.from, to: range.to });
  };

  const apply = (next: DateRange | undefined) => {
    if (!next?.from || !next?.to) return;
    onApply({ from: next.from, to: next.to });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 justify-start gap-2 px-3 font-body text-[12.5px] font-normal"
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="tabular-nums">{fmtDate(range.from)}</span>
          <span className="text-muted-foreground">~</span>
          <span className="tabular-nums">{fmtDate(range.to)}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex shrink-0 flex-row gap-1 border-b border-border p-2 sm:w-28 sm:flex-col sm:border-b-0 sm:border-r">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  const next = preset.get();
                  setDraft(next);
                  onApply(next);
                  setOpen(false);
                }}
                className="rounded-md px-2.5 py-1.5 text-left font-body text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div>
            <Calendar
              mode="range"
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from ?? range.from}
              numberOfMonths={2}
              className="p-2"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
              <span className="font-body text-[11px] text-muted-foreground">以報價單建立日期計</span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={!draft?.from || !draft?.to}
                  onClick={() => apply(draft)}
                >
                  套用
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function pageList(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | 'gap'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('gap');
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < total - 1) pages.push('gap');
  pages.push(total);
  return pages;
}

function exportCsv(rows: ProductReportRow[], range: { from: string; to: string }) {
  const header = ['排名', '產品', '分類', '廠家', '使用次數', '報價單數', '總數量', '最後使用日期', '報價單編號'];
  const body = rows.map((row, index) => [
    index + 1,
    row.name,
    row.category ?? '',
    row.factoryName ?? '',
    row.usageCount,
    row.quoteCount,
    row.quantitySum,
    row.lastUsedAt ? format(new Date(row.lastUsedAt), 'yyyy-MM-dd') : '',
    row.quoteNumbers.join(' / '),
  ]);
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `產品報告-${range.from}_${range.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ProductReportView() {
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState<ProductReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [topMetric, setTopMetric] = useState<MetricKey>('usage');
  const [search, setSearch] = useState('');
  const [factory, setFactory] = useState('');
  const [sortKey, setSortKey] = useState<MetricKey>('usage');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [detail, setDetail] = useState<ProductReportRow | null>(null);

  const fromTime = range.from.getTime();
  const toTime = range.to.getTime();
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    fetchProductReport({ from: new Date(fromTime), to: new Date(toTime) })
      .then((result) => {
        if (cancelled) return;
        hasLoadedRef.current = true;
        setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '無法載入產品報告資料');
        setData(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromTime, toTime, reloadKey]);

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const previousTotals = data?.previousTotals;

  const factoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) {
      if (row.factoryName) names.add(row.factoryName);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }, [rows]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const list = rows.filter((row) => {
      if (factory && row.factoryName !== factory) return false;
      if (!keyword) return true;
      return [row.name, row.category ?? '', row.factoryName ?? '', ...row.quoteNumbers]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
    const field = METRICS[sortKey].field;
    return [...list].sort(
      (a, b) => b[field] - a[field] || a.name.localeCompare(b.name, 'zh-Hant'),
    );
  }, [rows, search, factory, sortKey]);

  useEffect(() => {
    setPage(1);
  }, [search, factory, sortKey, pageSize, fromTime, toTime]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const topProducts = useMemo(() => {
    const field = METRICS[topMetric].field;
    return [...rows]
      .sort((a, b) => b[field] - a[field] || a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, TOP_PRODUCTS);
  }, [rows, topMetric]);

  const kpis = [
    {
      key: 'products',
      label: '有報價紀錄的產品',
      icon: <Package className="h-4 w-4" />,
      tone: 'sky' as Tone,
      value: totals?.productCount ?? 0,
      current: totals?.productCount ?? 0,
      previous: previousTotals?.productCount ?? 0,
    },
    {
      key: 'usage',
      label: '總使用次數',
      icon: <MousePointerClick className="h-4 w-4" />,
      tone: 'violet' as Tone,
      value: totals?.usageCount ?? 0,
      current: totals?.usageCount ?? 0,
      previous: previousTotals?.usageCount ?? 0,
    },
    {
      key: 'quotes',
      label: '報價單數',
      icon: <FileText className="h-4 w-4" />,
      tone: 'amber' as Tone,
      value: totals?.quoteCount ?? 0,
      current: totals?.quoteCount ?? 0,
      previous: previousTotals?.quoteCount ?? 0,
    },
    {
      key: 'factories',
      label: '廠家數量',
      icon: <Building2 className="h-4 w-4" />,
      tone: 'emerald' as Tone,
      value: totals?.factoryCount ?? 0,
      current: totals?.factoryCount ?? 0,
      previous: previousTotals?.factoryCount ?? 0,
    },
  ];

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error('複製失敗，請手動選取');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background fds-page-padding">
      <div className="mx-auto max-w-none space-y-4">
        <div className="fds-page-header">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-5 w-5 shrink-0 text-primary" />
                <h1 className="fds-page-title">產品報告</h1>
                {refreshing ? (
                  <span className="flex items-center gap-1 font-body text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    更新中
                  </span>
                ) : null}
              </div>
              <p className="fds-page-description">
                只統計報價明細中能對應產品目錄（products）的現有產品；增值服務／清走等非產品列不計入
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RangeField range={range} onApply={setRange} />
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="重新載入"
                title="重新載入"
                disabled={loading || refreshing}
                onClick={() => setReloadKey((n) => n + 1)}
              >
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
              </Button>
              <Button
                className="h-9 gap-1.5"
                disabled={!filtered.length}
                onClick={() => {
                  exportCsv(filtered, data?.range ?? { from: fmtDate(range.from), to: fmtDate(range.to) });
                  toast.success(`已導出 ${filtered.length} 個產品的報告`);
                }}
              >
                <Download className="h-4 w-4" />
                導出報告
              </Button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="font-body text-sm">載入報價使用數據…</span>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center font-body text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!loading && !error ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {kpis.map((kpi) => (
                <KpiCard
                  key={kpi.key}
                  icon={kpi.icon}
                  tone={kpi.tone}
                  label={kpi.label}
                  value={kpi.value}
                  current={kpi.current}
                  previous={kpi.previous}
                />
              ))}
            </div>

            <div className="rounded-xl border border-border bg-card">
              <div className="flex flex-col gap-2 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-sm font-bold text-foreground">
                    最受歡迎產品 Top {TOP_PRODUCTS}
                  </h2>
                  <span className="font-body text-[11px] text-muted-foreground">
                    按{METRICS[topMetric].label}
                  </span>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
                  {(Object.keys(METRICS) as MetricKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTopMetric(key)}
                      aria-pressed={topMetric === key}
                      className={cn(
                        'rounded-md px-2.5 py-1 font-body text-[11.5px] transition-colors',
                        topMetric === key
                          ? 'bg-card font-semibold text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {METRICS[key].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-4">
                {topProducts.length === 0 ? (
                  <CompactEmptyState
                    icon={BarChart2}
                    title="此期間尚無報價產品使用紀錄"
                    description="試試放寬日期區間，或先確認報價單明細的名稱能對應產品目錄。"
                    className="py-6"
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {topProducts.map((row, index) => {
                      const field = METRICS[topMetric].field;
                      return (
                        <button
                          key={row.name}
                          type="button"
                          onClick={() => setDetail(row)}
                          className="group rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                        >
                          <div className="flex items-start gap-2.5">
                            <RankBadge rank={index + 1} active={index === 0} />
                            <Thumb src={row.image} className="h-9 w-9" />
                            <p className="ml-auto font-display text-lg font-bold leading-none text-foreground tabular-nums">
                              {row[field].toLocaleString()}
                              <span className="ml-0.5 font-body text-[10px] font-medium text-muted-foreground">
                                {METRICS[topMetric].unit}
                              </span>
                            </p>
                          </div>
                          <p className="mt-2.5 line-clamp-2 font-body text-[12.5px] font-medium leading-snug text-foreground">
                            {row.name}
                          </p>
                          <p className="mt-0.5 truncate font-body text-[11px] text-muted-foreground">
                            {row.category || row.factoryName || '—'}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-sm font-bold text-foreground">產品列表</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono-data text-[10.5px] text-muted-foreground">
                    {filtered.length}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="搜尋產品名稱／廠家"
                      aria-label="搜尋產品名稱或廠家"
                      className="h-8 pl-8 pr-8 text-[12.5px]"
                    />
                    {search ? (
                      <button
                        type="button"
                        aria-label="清除搜尋"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setSearch('')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <Select
                    value={factory || '__all__'}
                    onValueChange={(next) => setFactory(next === '__all__' ? '' : next)}
                  >
                    <SelectTrigger aria-label="篩選廠家" className="h-8 w-36 text-[12.5px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">全部廠家</SelectItem>
                      {factoryOptions.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={!filtered.length}
                    onClick={() => {
                      exportCsv(filtered, data?.range ?? { from: fmtDate(range.from), to: fmtDate(range.to) });
                      toast.success('已導出產品列表');
                    }}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    導出
                  </Button>
                </div>
              </div>

              {filtered.length === 0 ? (
                <CompactEmptyState
                  icon={Package}
                  title={rows.length === 0 ? '此期間尚無報價產品使用紀錄' : '沒有符合條件的產品'}
                  description={rows.length === 0 ? '試試放寬日期區間。' : '試試清除搜尋或廠家篩選。'}
                  className="py-10"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="w-14 px-4 py-2.5 text-left font-medium">排名</th>
                        <th className="px-3 py-2.5 text-left font-medium">產品</th>
                        <th className="hidden px-3 py-2.5 text-left font-medium md:table-cell">廠家</th>
                        {(Object.keys(METRICS) as MetricKey[]).map((key) => {
                          const active = sortKey === key;
                          return (
                            <th key={key} className="px-3 py-2.5 text-right font-medium">
                              <button
                                type="button"
                                onClick={() => setSortKey(key)}
                                className={cn(
                                  'inline-flex items-center gap-1 transition-colors hover:text-foreground',
                                  active && 'text-foreground',
                                )}
                                aria-label={`按${METRICS[key].label}排序`}
                              >
                                {METRICS[key].label}
                                <ChevronDown
                                  className={cn(
                                    'h-3 w-3 transition-transform',
                                    active ? 'opacity-100' : 'opacity-0',
                                    active ? '' : '-rotate-180',
                                  )}
                                />
                              </button>
                            </th>
                          );
                        })}
                        <th className="px-4 py-2.5 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {paged.map((row, index) => {
                        const rank = (currentPage - 1) * pageSize + index + 1;
                        return (
                          <tr key={row.name} className="group hover:bg-muted/30">
                            <td className="px-4 py-2.5">
                              <RankBadge rank={rank} active={rank === 1} />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <Thumb src={row.image} className="h-9 w-9" />
                                <div className="min-w-0">
                                  <p className="line-clamp-1 font-body text-[13px] font-medium text-foreground">
                                    {row.name}
                                  </p>
                                  <p className="line-clamp-1 font-body text-[11px] text-muted-foreground">
                                    {row.category || row.factoryName || '未分類'}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="hidden px-3 py-2.5 font-body text-[12px] text-muted-foreground md:table-cell">
                              {row.factoryName || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono-data text-foreground tabular-nums">
                              {row.usageCount.toLocaleString()}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground tabular-nums">
                              {row.quoteCount.toLocaleString()}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono-data text-muted-foreground tabular-nums">
                              {row.quantitySum.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-[11.5px]"
                                  onClick={() => setDetail(row)}
                                >
                                  查看詳情
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground"
                                      aria-label={`${row.name} 更多操作`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-40">
                                    <DropdownMenuItem
                                      onClick={() => void copyText(row.name, '已複製產品名稱')}
                                    >
                                      <Copy className="mr-2 h-3.5 w-3.5" />
                                      複製名稱
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        void copyText(
                                          [
                                            row.name,
                                            `使用次數：${row.usageCount}`,
                                            `報價單數：${row.quoteCount}`,
                                            `總數量：${row.quantitySum}`,
                                            `廠家：${row.factoryName || '—'}`,
                                          ].join('\n'),
                                          '已複製使用數據',
                                        )
                                      }
                                    >
                                      <Copy className="mr-2 h-3.5 w-3.5" />
                                      複製使用數據
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {filtered.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
                  <p className="font-body text-[11.5px] text-muted-foreground tabular-nums">
                    共 {filtered.length} 筆
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="上一頁"
                        disabled={currentPage <= 1}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      {pageList(currentPage, totalPages).map((item, index) =>
                        item === 'gap' ? (
                          <span
                            key={`gap-${index}`}
                            className="px-1 font-mono-data text-[11px] text-muted-foreground"
                          >
                            …
                          </span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            onClick={() => setPage(item)}
                            aria-current={item === currentPage ? 'page' : undefined}
                            className={cn(
                              'h-7 min-w-7 rounded-md px-1.5 font-mono-data text-[11.5px] tabular-nums transition-colors',
                              item === currentPage
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                            )}
                          >
                            {item}
                          </button>
                        ),
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="下一頁"
                        disabled={currentPage >= totalPages}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(next) => setPageSize(Number(next))}
                    >
                      <SelectTrigger aria-label="每頁筆數" className="h-7 w-24 text-[11.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZES.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size} 筆／頁
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(next) => {
          if (!next) setDetail(null);
        }}
        title={detail?.name ?? '產品詳情'}
        description={
          detail
            ? [detail.category, detail.factoryName].filter(Boolean).join(' · ') || '報價使用詳情'
            : undefined
        }
        icon={<Package className="h-5 w-5" />}
        size="lg"
        footer={
          <Button variant="outline" onClick={() => setDetail(null)}>
            關閉
          </Button>
        }
      >
        {detail ? (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <Thumb src={detail.image} className="h-24 w-24" />
              <div className="min-w-0 flex-1">
                <p className="font-body text-[13px] font-medium text-foreground">{detail.name}</p>
                <p className="mt-1 font-body text-[12px] text-muted-foreground">
                  {detail.category || '未分類'}
                  {detail.factoryName ? ` · ${detail.factoryName}` : ''}
                </p>
                <p className="mt-1 font-body text-[11.5px] text-muted-foreground/80">
                  最後使用：{detail.lastUsedAt ? format(new Date(detail.lastUsedAt), 'yyyy-MM-dd') : '—'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['使用次數', detail.usageCount, METRICS.usage.unit],
                  ['報價單數', detail.quoteCount, METRICS.quotes.unit],
                  ['總數量', detail.quantitySum, METRICS.quantity.unit],
                ] as const
              ).map(([label, value, unit]) => (
                <div key={label} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <p className="font-body text-[11px] text-muted-foreground">{label}</p>
                  <p className="mt-0.5 font-display text-lg font-bold text-foreground tabular-nums">
                    {value.toLocaleString()}
                    <span className="ml-0.5 font-body text-[10px] font-medium text-muted-foreground">
                      {unit}
                    </span>
                  </p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-1.5 font-body text-[12px] font-medium text-foreground">
                使用此產品的報價單（{detail.quoteCount}）
              </p>
              {detail.quoteNumbers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center font-body text-[11.5px] text-muted-foreground">
                  沒有可對應的報價單編號
                </p>
              ) : (
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2.5">
                  {detail.quoteNumbers.map((number) => (
                    <span
                      key={number}
                      className="rounded-md border border-border bg-card px-2 py-0.5 font-mono-data text-[11px] text-muted-foreground"
                    >
                      {number}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

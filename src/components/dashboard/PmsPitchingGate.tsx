import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clock,
  Loader2,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';

interface PmsPitchingGateProps {
  onSelect: (item: PmsPitchingListItem) => void;
}

type SortKey =
  | 'enquiry_date'
  | 'remaining_days'
  | 'customer_type'
  | 'display_name'
  | 'service_type'
  | 'estimated_income'
  | 'estimated_gross_profit'
  | 'staff'
  | 'pitching_stages';

type SortDir = 'asc' | 'desc';

function formatEnquiryDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function formatMoney(value: number | string | null | undefined): string {
  if (value == null || value === '') return 'N/A';
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 'N/A';
  return n.toLocaleString('en-HK', { maximumFractionDigits: 0 });
}

function statusBadgeClass(stage: string | null | undefined): string {
  const s = (stage || '').toLowerCase();
  if (s.includes('close') || s.includes('結案') || s.includes('lost')) {
    return 'bg-rose-500 text-white border-rose-500';
  }
  if (s.includes('enquir') || s.includes('查詢')) {
    return 'bg-amber-100 text-amber-900 border-amber-200';
  }
  if (s.includes('quote') || s.includes('報價')) {
    return 'bg-sky-100 text-sky-900 border-sky-200';
  }
  if (s.includes('win') || s.includes('得標') || s.includes('confirm')) {
    return 'bg-emerald-100 text-emerald-900 border-emerald-200';
  }
  return 'bg-muted text-muted-foreground border-border';
}

function statusLabel(stage: string | null | undefined): string {
  if (!stage?.trim()) return '—';
  const s = stage.trim();
  if (/case\s*closed/i.test(s)) return '結案';
  return s;
}

function staffLabel(item: PmsPitchingListItem): string {
  const parts = [item.main_pm_name, item.main_designer_name]
    .map((x) => x?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '—';
}

function compareNullable(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: SortDir,
): number {
  const emptyA = a == null || a === '';
  const emptyB = b == null || b === '';
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return dir === 'asc' ? a - b : b - a;
  }
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  const cmp = sa.localeCompare(sb, 'zh-HK');
  return dir === 'asc' ? cmp : -cmp;
}

/**
 * Full-page PMS pitching picker for 快速報價 (replaces minimal search dropdown).
 */
export function PmsPitchingGate({ onSelect }: PmsPitchingGateProps) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<PmsPitchingListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('enquiry_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      const rows = await fetchPmsPitchings({ search, limit: 100 });
      if (cancelled) return;
      setItems(rows);
      setLoading(false);
      if (rows.length === 0 && !search.trim()) {
        setLoadError('未能載入 PMS Pitching 列表');
      }
    }, search.trim() ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const sortedItems = useMemo(() => {
    const rows = [...items];
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'enquiry_date':
          return compareNullable(
            a.enquiry_date ? new Date(a.enquiry_date).getTime() : null,
            b.enquiry_date ? new Date(b.enquiry_date).getTime() : null,
            sortDir,
          );
        case 'remaining_days':
          return compareNullable(a.remaining_days, b.remaining_days, sortDir);
        case 'customer_type':
          return compareNullable(a.customer_type, b.customer_type, sortDir);
        case 'display_name':
          return compareNullable(
            pitchingDisplayTitle(a),
            pitchingDisplayTitle(b),
            sortDir,
          );
        case 'service_type':
          return compareNullable(a.service_type, b.service_type, sortDir);
        case 'estimated_income':
          return compareNullable(
            a.estimated_income == null ? null : Number(a.estimated_income),
            b.estimated_income == null ? null : Number(b.estimated_income),
            sortDir,
          );
        case 'estimated_gross_profit':
          return compareNullable(
            a.estimated_gross_profit == null
              ? null
              : Number(a.estimated_gross_profit),
            b.estimated_gross_profit == null
              ? null
              : Number(b.estimated_gross_profit),
            sortDir,
          );
        case 'staff':
          return compareNullable(staffLabel(a), staffLabel(b), sortDir);
        case 'pitching_stages':
          return compareNullable(a.pitching_stages, b.pitching_stages, sortDir);
        default:
          return 0;
      }
    });
    return rows;
  }, [items, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'enquiry_date' || key === 'remaining_days' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) {
      return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-primary" />
    ) : (
      <ArrowDown className="h-3 w-3 text-primary" />
    );
  };

  const thClass =
    'whitespace-nowrap px-3 py-2.5 text-left font-body text-[11px] font-semibold tracking-wide text-muted-foreground';

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border bg-card/40 px-5 py-5 md:px-8">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              建立新報價單
            </h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              從 PMS Pitching 列表選擇一筆，系統會自動帶入報價資料
            </p>
          </div>
          <div className="relative w-full md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋 pitching code / 客戶名稱 / 提案名稱…"
              className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 font-body text-sm text-foreground shadow-sm placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4 md:px-8">
        <div className="mx-auto w-full max-w-[1400px]">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {(
                      [
                        ['enquiry_date', '查詢日期'],
                        ['remaining_days', '剩餘天數'],
                        ['customer_type', '客戶類型'],
                        ['display_name', '提案顯示名稱'],
                        ['service_type', '服務類型'],
                        ['estimated_income', '預計收入'],
                        ['estimated_gross_profit', '預計毛利'],
                        ['staff', '主要PM及設計師'],
                        ['pitching_stages', 'Status'],
                      ] as const
                    ).map(([key, label]) => (
                      <th key={key} className={thClass}>
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                        >
                          {label}
                          <SortIcon column={key} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-16 text-center">
                        <div className="inline-flex items-center gap-2 font-body text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          載入 Pitching 列表…
                        </div>
                      </td>
                    </tr>
                  ) : sortedItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-16 text-center font-body text-sm text-muted-foreground"
                      >
                        {loadError ||
                          (search.trim()
                            ? `找不到「${search.trim()}」`
                            : '暫無 Pitching 資料')}
                      </td>
                    </tr>
                  ) : (
                    sortedItems.map((item) => {
                      const selected = activeId === item.id;
                      const title = pitchingDisplayTitle(item);
                      const days = item.remaining_days;
                      return (
                        <tr
                          key={item.id}
                          tabIndex={0}
                          onMouseEnter={() => setActiveId(item.id)}
                          onFocus={() => setActiveId(item.id)}
                          onClick={() => onSelect(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelect(item);
                            }
                          }}
                          className={cn(
                            'cursor-pointer border-b border-border/70 transition-colors last:border-b-0',
                            selected
                              ? 'bg-primary/10'
                              : 'hover:bg-accent/50',
                          )}
                        >
                          <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs text-foreground">
                            {formatEnquiryDate(item.enquiry_date)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            {days == null ? (
                              <span className="font-body text-xs text-muted-foreground">
                                —
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 font-body text-xs font-medium',
                                  days < 0
                                    ? 'text-rose-600'
                                    : days <= 14
                                      ? 'text-amber-600'
                                      : 'text-emerald-600',
                                )}
                              >
                                <Clock className="h-3.5 w-3.5" />
                                {days} 天
                              </span>
                            )}
                          </td>
                          <td className="max-w-[140px] px-3 py-3 font-body text-xs leading-snug text-foreground">
                            {item.customer_type || '—'}
                          </td>
                          <td className="min-w-[220px] max-w-[320px] px-3 py-3">
                            <div className="truncate font-body text-sm font-semibold text-primary">
                              {title}
                            </div>
                            <div className="mt-0.5 truncate font-mono-data text-[11px] text-muted-foreground">
                              {item.pitching_code || '—'}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            {item.service_type ? (
                              <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 font-body text-[11px] font-medium text-violet-700">
                                {item.service_type}
                              </span>
                            ) : (
                              <span className="font-body text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs text-foreground">
                            {formatMoney(item.estimated_income)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs text-foreground">
                            {formatMoney(item.estimated_gross_profit)}
                          </td>
                          <td className="max-w-[160px] px-3 py-3 font-body text-xs text-foreground">
                            {staffLabel(item)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span
                              className={cn(
                                'inline-flex rounded-md border px-2 py-0.5 font-body text-[11px] font-medium',
                                statusBadgeClass(item.pitching_stages),
                              )}
                            >
                              {statusLabel(item.pitching_stages)}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {!loading && sortedItems.length > 0 ? (
              <div className="border-t border-border px-4 py-2 font-body text-[11px] text-muted-foreground">
                共 {sortedItems.length} 筆 · 點擊任一列即可開始報價
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

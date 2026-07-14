import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import {
  ListPageShell,
  ListTableCard,
  ListTableEmptyRow,
  ListTableLoadingRow,
  LIST_TABLE_TH_CLASS,
} from '@/components/dashboard/ListPageShell';
import {
  compareNullable,
  formatListDate,
  formatListMoney,
  pitchingStatusBadgeClass,
  pitchingStatusLabel,
  SortHeaderIcon,
  type ListSortDir,
} from '@/lib/listTableUtils';

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

function staffLabel(item: PmsPitchingListItem): string {
  const parts = [item.main_pm_name, item.main_designer_name]
    .map((x) => x?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '—';
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
  const [sortDir, setSortDir] = useState<ListSortDir>('desc');
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

  return (
    <ListPageShell
      title="建立新報價單"
      subtitle="從 PMS Pitching 列表選擇一筆，系統會自動帶入報價資料"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="搜尋 pitching code / 客戶名稱 / 提案名稱…"
      searchInputRef={inputRef}
    >
      <ListTableCard
        footer={
          !loading && sortedItems.length > 0
            ? `共 ${sortedItems.length} 筆 · 點擊任一列即可開始報價`
            : null
        }
      >
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
              <th key={key} className={LIST_TABLE_TH_CLASS}>
                <button
                  type="button"
                  onClick={() => toggleSort(key)}
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                >
                  {label}
                  <SortHeaderIcon active={sortKey === key} dir={sortDir} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <ListTableLoadingRow colSpan={9} label="載入 Pitching 列表…" />
          ) : sortedItems.length === 0 ? (
            <ListTableEmptyRow
              colSpan={9}
              message={
                loadError ||
                (search.trim()
                  ? `找不到「${search.trim()}」`
                  : '暫無 Pitching 資料')
              }
            />
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
                    selected ? 'bg-primary/10' : 'hover:bg-accent/50',
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs text-foreground">
                    {formatListDate(item.enquiry_date)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {days == null ? (
                      <span className="font-body text-xs text-muted-foreground">—</span>
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
                      <span className="font-body text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs text-foreground">
                    {formatListMoney(item.estimated_income)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs text-foreground">
                    {formatListMoney(item.estimated_gross_profit)}
                  </td>
                  <td className="max-w-[160px] px-3 py-3 font-body text-xs text-foreground">
                    {staffLabel(item)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-md border px-2 py-0.5 font-body text-[11px] font-medium',
                        pitchingStatusBadgeClass(item.pitching_stages),
                      )}
                    >
                      {pitchingStatusLabel(item.pitching_stages)}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </ListTableCard>
    </ListPageShell>
  );
}

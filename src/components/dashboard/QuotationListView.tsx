import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Copy, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { resolvePitchingCode, resolvePitchingName } from '@/lib/bwfQuoteItems';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import {
  ListPageShell,
  ListRefreshButton,
  ListTableCard,
  ListTableEmptyRow,
  ListTableLoadingRow,
  LIST_TABLE_TH_CLASS,
} from '@/components/dashboard/ListPageShell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  compareNullable,
  formatListDate,
  formatListMoney,
  pitchingStatusBadgeClass,
  pitchingStatusLabel,
  quoteStatusBadgeClass,
  SortHeaderIcon,
  type ListSortDir,
} from '@/lib/listTableUtils';
import {
  canonicalStaffName,
  matchesStaffFilter,
  staffDisplayLabel,
} from '@/lib/staffDisplay';
import { collectStaffNamesFromQuoteRows } from '@/lib/quoteStaffOptions';
import { compareQuoteVersion, displayQuoteVersion } from '@/lib/quoteVersions';

interface QuoteRecord {
  id: string;
  quote_id: string;
  version: string;
  status: string;
  total_amount: number;
  cost_price: number | null;
  submitter: string;
  pitching_code: string | null;
  pitching_name: string | null;
  bwf_pitching_id: string | null;
  project_data: {
    formData?: {
      pitchingCode?: string;
      pitchingName?: string;
      projectName?: string;
      clientName?: string;
      company?: string;
      projectManager?: string;
    };
    [key: string]: unknown;
  };
  created_at: string;
  modified_date?: string | null;
}

type QuoteListRow = QuoteRecord & {
  pitching: PmsPitchingListItem | null;
};

interface QuotationListViewProps {
  onOpenQuote?: (quoteId: string, opts?: { quoteUuid?: string }) => void;
  onCopyQuote?: (quoteUuid: string) => void;
}

const LIST_SELECT =
  'id, quote_id, version, status, total_amount, cost_price, submitter, pitching_code, pitching_name, bwf_pitching_id, created_at, modified_date, project_data';

type SortKey =
  | 'enquiry_date'
  | 'remaining_days'
  | 'customer_type'
  | 'display_name'
  | 'service_type'
  | 'total_amount'
  | 'cost_price'
  | 'staff'
  | 'quote_status'
  | 'pitching_stages';

/** Group all version rows; each group sorted newest version first. */
function groupQuoteVersions(rows: QuoteRecord[]): Map<string, QuoteListRow[]> {
  const map = new Map<string, QuoteListRow[]>();
  for (const row of rows) {
    const list = map.get(row.quote_id) || [];
    list.push(row as QuoteListRow);
    map.set(row.quote_id, list);
  }
  for (const [key, list] of map) {
    list.sort((a, b) => -compareQuoteVersion(a.version, b.version));
    map.set(key, list);
  }
  return map;
}

function latestQuoteInGroup(versions: QuoteListRow[]): QuoteListRow {
  return versions[0];
}

function quoteDisplayCode(q: QuoteRecord): string {
  return resolvePitchingCode({
    pitchingCode: q.pitching_code,
    formData: q.project_data?.formData as Record<string, unknown> | undefined,
  });
}

function quoteDisplayName(q: QuoteListRow): string {
  if (q.pitching) return pitchingDisplayTitle(q.pitching);
  const name = resolvePitchingName({
    pitchingName: q.pitching_name,
    formData: q.project_data?.formData as Record<string, unknown> | undefined,
  });
  const client = q.project_data?.formData?.clientName?.trim() || '';
  return name || client || '未命名專案';
}

function quoteCode(q: QuoteListRow): string {
  return (
    q.pitching?.pitching_code?.trim() ||
    quoteDisplayCode(q) ||
    '—'
  );
}

function staffLabel(q: QuoteListRow): string {
  if (q.pitching) {
    const label = staffDisplayLabel([
      q.pitching.main_pm_name,
      q.pitching.main_designer_name,
    ]);
    if (label !== '—') return label;
  }
  return (
    canonicalStaffName(
      q.project_data?.formData?.projectManager?.trim() ||
        q.submitter?.trim() ||
        '',
    ) || '—'
  );
}

export function QuotationListView({ onOpenQuote, onCopyQuote }: QuotationListViewProps) {
  const [quotes, setQuotes] = useState<QuoteListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [staffFilter, setStaffFilter] = useState('__all__');
  const [deleteTarget, setDeleteTarget] = useState<QuoteListRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('enquiry_date');
  const [sortDir, setSortDir] = useState<ListSortDir>('desc');
  const [expandedQuoteIds, setExpandedQuoteIds] = useState<Set<string>>(
    () => new Set(),
  );

  const fetchQuotes = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('bwf_quote')
        .select(LIST_SELECT)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const allRows = (data as QuoteRecord[]) || [];

      const pitchingIds = [
        ...new Set(
          allRows
            .map((q) => q.bwf_pitching_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      let pitchingById = new Map<string, PmsPitchingListItem>();
      if (pitchingIds.length > 0) {
        const pitchings = await fetchPmsPitchings({
          ids: pitchingIds,
          limit: pitchingIds.length,
        });
        pitchingById = new Map(pitchings.map((p) => [p.id, p]));
      }

      setQuotes(
        allRows.map((q) => ({
          ...q,
          pitching: q.bwf_pitching_id
            ? pitchingById.get(q.bwf_pitching_id) || null
            : null,
        })),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '無法載入報價單列表';
      toast.error('載入失敗', { description: message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('bwf_quote')
        .delete()
        .eq('id', deleteTarget.id);

      if (error) throw error;

      setQuotes((prev) => prev.filter((q) => q.id !== deleteTarget.id));
      toast.success('已刪除報價單', {
        description: quoteCode(deleteTarget),
      });
      setDeleteTarget(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '無法刪除報價單';
      toast.error('刪除失敗', { description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const staffFilterOptions = useMemo(
    () => collectStaffNamesFromQuoteRows(quotes),
    [quotes],
  );

  const quoteGroups = useMemo(() => groupQuoteVersions(quotes), [quotes]);

  const filteredLatestQuotes = useMemo(() => {
    const latestRows = [...quoteGroups.values()].map(latestQuoteInGroup);

    let rows = latestRows;

    if (staffFilter !== '__all__') {
      rows = rows.filter((q) =>
        matchesStaffFilter(
          [
            q.pitching?.main_pm_name,
            q.pitching?.main_designer_name,
            q.project_data?.formData?.projectManager,
            q.submitter,
          ],
          staffFilter,
        ),
      );
    }

    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((q) => {
      const code = quoteCode(q).toLowerCase();
      const name = quoteDisplayName(q).toLowerCase();
      const clientName = (
        q.pitching?.customer_name ||
        q.project_data?.formData?.clientName ||
        ''
      ).toLowerCase();
      const pm = staffLabel(q).toLowerCase();
      return (
        code.includes(query) ||
        name.includes(query) ||
        clientName.includes(query) ||
        pm.includes(query) ||
        q.submitter.toLowerCase().includes(query) ||
        q.status.toLowerCase().includes(query) ||
        q.quote_id.toLowerCase().includes(query) ||
        q.version.toLowerCase().includes(query)
      );
    });
  }, [quoteGroups, searchQuery, staffFilter]);

  const sortedLatestQuotes = useMemo(() => {
    const rows = [...filteredLatestQuotes];
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'enquiry_date': {
          const aDate =
            a.pitching?.enquiry_date || a.modified_date || a.created_at;
          const bDate =
            b.pitching?.enquiry_date || b.modified_date || b.created_at;
          return compareNullable(
            aDate ? new Date(aDate).getTime() : null,
            bDate ? new Date(bDate).getTime() : null,
            sortDir,
          );
        }
        case 'remaining_days':
          return compareNullable(
            a.pitching?.remaining_days ?? null,
            b.pitching?.remaining_days ?? null,
            sortDir,
          );
        case 'customer_type':
          return compareNullable(
            a.pitching?.customer_type,
            b.pitching?.customer_type,
            sortDir,
          );
        case 'display_name':
          return compareNullable(
            quoteDisplayName(a),
            quoteDisplayName(b),
            sortDir,
          );
        case 'service_type':
          return compareNullable(
            a.pitching?.service_type,
            b.pitching?.service_type,
            sortDir,
          );
        case 'total_amount':
          return compareNullable(a.total_amount, b.total_amount, sortDir);
        case 'cost_price':
          return compareNullable(a.cost_price, b.cost_price, sortDir);
        case 'staff':
          return compareNullable(staffLabel(a), staffLabel(b), sortDir);
        case 'quote_status':
          return compareNullable(
            `${a.version} ${a.status}`,
            `${b.version} ${b.status}`,
            sortDir,
          );
        case 'pitching_stages':
          return compareNullable(
            a.pitching?.pitching_stages,
            b.pitching?.pitching_stages,
            sortDir,
          );
        default:
          return 0;
      }
    });
    return rows;
  }, [filteredLatestQuotes, sortKey, sortDir]);

  const toggleQuoteVersions = (quoteId: string) => {
    setExpandedQuoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(quoteId)) next.delete(quoteId);
      else next.add(quoteId);
      return next;
    });
  };

  const displayRows = useMemo(() => {
    const rows: Array<{
      quote: QuoteListRow;
      quoteId: string;
      isOlderVersion: boolean;
      versionCount: number;
      showExpandControl: boolean;
      expanded: boolean;
    }> = [];

    for (const latest of sortedLatestQuotes) {
      const versions = quoteGroups.get(latest.quote_id) || [latest];
      const expanded = expandedQuoteIds.has(latest.quote_id);
      const visible = expanded ? versions : [versions[0]];
      visible.forEach((quote, index) => {
        rows.push({
          quote,
          quoteId: latest.quote_id,
          isOlderVersion: index > 0,
          versionCount: versions.length,
          showExpandControl: index === 0 && versions.length > 1,
          expanded,
        });
      });
    }
    return rows;
  }, [sortedLatestQuotes, quoteGroups, expandedQuoteIds]);

  const [activeId, setActiveId] = useState<string | null>(null);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'enquiry_date' ||
          key === 'remaining_days' ||
          key === 'total_amount'
          ? 'desc'
          : 'asc',
      );
    }
  };

  const deleteLabel = deleteTarget
    ? [quoteCode(deleteTarget), quoteDisplayName(deleteTarget)]
        .filter(Boolean)
        .join(' · ')
    : '';

  const emptyMessage = useMemo(() => {
    if (staffFilter !== '__all__' && searchQuery.trim()) {
      return `找不到「${staffFilter}」且符合「${searchQuery.trim()}」的報價`;
    }
    if (staffFilter !== '__all__') {
      return `找不到「${staffFilter}」的報價`;
    }
    if (searchQuery.trim()) {
      return `找不到「${searchQuery.trim()}」`;
    }
    return '尚無報價記錄';
  }, [searchQuery, staffFilter]);

  return (
    <>
      <ListPageShell
        title="報價單一覽"
        subtitle="管理和追蹤所有已提交的報價記錄（含關聯 PMS Pitching）"
        search={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="搜尋 pitching code / 客戶名稱 / 提案名稱 / 提交者…"
        searchLeading={
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger
              className="h-10 w-[168px] shrink-0 rounded-xl border-border bg-card font-body text-sm shadow-sm"
              aria-label="篩選主要 PM 及設計師"
            >
              <SelectValue placeholder="PM及設計師" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部 PM及設計師</SelectItem>
              {staffFilterOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        searchActions={
          <ListRefreshButton onClick={fetchQuotes} loading={isLoading} />
        }
      >
        <ListTableCard
          minWidthClassName="min-w-[1280px]"
          footer={
            !isLoading && displayRows.length > 0
              ? `共 ${sortedLatestQuotes.length} 張報價 · ${quotes.length} 個版本紀錄`
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
                  ['total_amount', '報價金額'],
                  ['cost_price', '成本'],
                  ['staff', '主要PM及設計師'],
                  ['quote_status', '報價狀態'],
                  ['pitching_stages', 'Pitching'],
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
              <th className={LIST_TABLE_TH_CLASS}>
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <ListTableLoadingRow colSpan={11} label="載入報價單列表…" />
            ) : displayRows.length === 0 ? (
              <ListTableEmptyRow
                colSpan={11}
                message={emptyMessage}
              />
            ) : (
              displayRows.map(({ quote, quoteId, isOlderVersion, versionCount, showExpandControl, expanded }) => {
                const selected = activeId === quote.id;
                const title = quoteDisplayName(quote);
                const code = quoteCode(quote);
                const days = quote.pitching?.remaining_days ?? null;
                const enquiryDate =
                  quote.pitching?.enquiry_date ||
                  quote.modified_date ||
                  quote.created_at;
                const isLatestExpanded = expanded && showExpandControl;
                const isOldExpanded = expanded && isOlderVersion;
                const versionDate = quote.modified_date || quote.created_at;

                const openQuote = () =>
                  onOpenQuote?.(quote.quote_id, { quoteUuid: quote.id });

                return (
                  <tr
                    key={quote.id}
                    tabIndex={0}
                    onMouseEnter={() => setActiveId(quote.id)}
                    onFocus={() => setActiveId(quote.id)}
                    onClick={openQuote}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openQuote();
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b transition-colors last:border-b-0',
                      isOldExpanded
                        ? 'border-border/40 border-l-2 border-l-muted-foreground/25 bg-muted/20'
                        : 'border-border/70',
                      isLatestExpanded && 'border-l-[3px] border-l-primary bg-primary/[0.04]',
                      selected
                        ? isOldExpanded
                          ? 'bg-muted/35'
                          : 'bg-primary/10'
                        : isOldExpanded
                          ? 'hover:bg-muted/30'
                          : 'hover:bg-accent/50',
                    )}
                  >
                    <td
                      className={cn(
                        'whitespace-nowrap font-mono-data text-foreground',
                        isOldExpanded ? 'px-3 py-2 text-[11px] text-muted-foreground/80' : 'px-3 py-3 text-xs',
                      )}
                    >
                      {formatListDate(isOldExpanded ? versionDate : enquiryDate)}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap',
                        isOldExpanded ? 'px-3 py-2' : 'px-3 py-3',
                      )}
                    >
                      {isOldExpanded || days == null ? (
                        <span className="font-body text-xs text-muted-foreground/60">
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
                    <td
                      className={cn(
                        'max-w-[140px] font-body leading-snug',
                        isOldExpanded
                          ? 'px-3 py-2 text-[11px] text-muted-foreground/60'
                          : 'px-3 py-3 text-xs text-foreground',
                      )}
                    >
                      {isOldExpanded ? '—' : quote.pitching?.customer_type || '—'}
                    </td>
                    <td
                      className={cn(
                        'min-w-[220px] max-w-[320px]',
                        isOldExpanded ? 'px-3 py-2' : 'px-3 py-3',
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        {showExpandControl ? (
                          <button
                            type="button"
                            title={expanded ? '收合版本' : `展開 ${versionCount} 個版本`}
                            aria-label={expanded ? '收合版本' : `展開 ${versionCount} 個版本`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleQuoteVersions(quoteId);
                            }}
                            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            {expanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        ) : isOldExpanded ? (
                          <>
                            <span className="inline-block w-6 shrink-0" aria-hidden />
                            <span className="inline-block w-6 shrink-0" aria-hidden />
                          </>
                        ) : (
                          <span className="inline-block w-6 shrink-0" aria-hidden />
                        )}
                        <div className="min-w-0">
                          {isOldExpanded ? (
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 rounded border border-border/80 bg-muted/50 px-2 py-0.5 font-body text-[10px] font-semibold text-muted-foreground">
                                舊版
                              </span>
                              <span className="truncate font-mono-data text-[11px] text-muted-foreground/80">
                                {displayQuoteVersion(quote.version)}
                              </span>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <div className="truncate font-body text-sm font-semibold text-primary">
                                  {title}
                                </div>
                                {isLatestExpanded ? (
                                  <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-body text-[10px] font-semibold text-primary">
                                    最新
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 truncate font-mono-data text-[11px] text-muted-foreground">
                                {code}
                                {quote.project_data?.formData?.clientName
                                  ? ` · ${quote.project_data.formData.clientName}`
                                  : ''}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap',
                        isOldExpanded ? 'px-3 py-2' : 'px-3 py-3',
                      )}
                    >
                      {isOldExpanded ? (
                        <span className="font-body text-xs text-muted-foreground/60">—</span>
                      ) : quote.pitching?.service_type ? (
                        <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 font-body text-[11px] font-medium text-violet-700">
                          {quote.pitching.service_type}
                        </span>
                      ) : (
                        <span className="font-body text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap font-mono-data',
                        isOldExpanded
                          ? 'px-3 py-2 text-[11px] font-normal text-muted-foreground/85'
                          : 'px-3 py-3 text-xs font-semibold text-foreground',
                      )}
                    >
                      ${formatListMoney(quote.total_amount)}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap font-mono-data',
                        isOldExpanded
                          ? 'px-3 py-2 text-[11px] text-muted-foreground/75'
                          : 'px-3 py-3 text-xs text-muted-foreground',
                      )}
                    >
                      {quote.cost_price != null
                        ? `$${formatListMoney(quote.cost_price)}`
                        : 'N/A'}
                    </td>
                    <td
                      className={cn(
                        'max-w-[160px] font-body',
                        isOldExpanded
                          ? 'px-3 py-2 text-[11px] text-muted-foreground/75'
                          : 'px-3 py-3 text-xs text-foreground',
                      )}
                    >
                      {isOldExpanded ? (
                        <div>
                          提交:{' '}
                          {quote.submitter
                            ? canonicalStaffName(quote.submitter)
                            : '—'}
                        </div>
                      ) : (
                        <>
                          <div>{staffLabel(quote)}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            提交:{' '}
                            {quote.submitter
                              ? canonicalStaffName(quote.submitter)
                              : '—'}
                          </div>
                        </>
                      )}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap',
                        isOldExpanded ? 'px-3 py-2' : 'px-3 py-3',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex rounded-md border px-2 py-0.5 font-body font-medium',
                            quoteStatusBadgeClass(quote.status),
                            isOldExpanded
                              ? 'text-[10px] opacity-75'
                              : 'text-[11px]',
                            isLatestExpanded && 'ring-1 ring-primary/20',
                          )}
                        >
                          {displayQuoteVersion(quote.version)} · {quote.status}
                        </span>
                        {showExpandControl && !expanded ? (
                          <span className="font-body text-[10px] text-muted-foreground">
                            {versionCount} 版
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap',
                        isOldExpanded ? 'px-3 py-2' : 'px-3 py-3',
                      )}
                    >
                      {isOldExpanded ? (
                        <span className="font-body text-xs text-muted-foreground/60">—</span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex rounded-md border px-2 py-0.5 font-body text-[11px] font-medium',
                            pitchingStatusBadgeClass(
                              quote.pitching?.pitching_stages,
                            ),
                          )}
                        >
                          {pitchingStatusLabel(quote.pitching?.pitching_stages)}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap',
                        isOldExpanded ? 'px-2 py-2' : 'px-2 py-3',
                      )}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="複製報價單"
                          aria-label={`複製報價單 ${code}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onCopyQuote?.(quote.id);
                          }}
                          className={cn(
                            'flex items-center justify-center rounded-lg border border-transparent text-muted-foreground/70 transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary',
                            isOldExpanded ? 'h-7 w-7' : 'h-8 w-8',
                          )}
                        >
                          <Copy className={isOldExpanded ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                        </button>
                        <button
                          type="button"
                          title="刪除報價單"
                          aria-label={`刪除報價單 ${code}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(quote);
                          }}
                          className={cn(
                            'flex items-center justify-center rounded-lg border border-transparent text-muted-foreground/70 transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive',
                            isOldExpanded ? 'h-7 w-7' : 'h-8 w-8',
                          )}
                        >
                          <Trash2 className={isOldExpanded ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </ListTableCard>
      </ListPageShell>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-md border-destructive/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              確認刪除
            </AlertDialogTitle>
            <AlertDialogDescription className="font-body text-sm">
              確定要刪除報價單版本{' '}
              <span className="font-mono-data font-bold text-foreground">
                {deleteTarget ? displayQuoteVersion(deleteTarget.version) : ''}
              </span>
              （{deleteTarget ? quoteCode(deleteTarget) : ''}）嗎？
              <br />
              <span className="mt-2 block text-xs text-muted-foreground">
                「{deleteLabel}」的此版本將永久移除；其他版本不受影響。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              className="font-display text-xs font-bold"
            >
              否
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-display text-xs font-bold gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isDeleting ? '刪除中...' : '是，刪除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

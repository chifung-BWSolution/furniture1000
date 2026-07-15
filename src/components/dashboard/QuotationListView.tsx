import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';
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
  onOpenQuote?: (quoteId: string) => void;
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

/** Keep one row per quote_id — latest modified_date wins (legacy duplicate cleanup in UI). */
function dedupeQuotesByQuoteId(rows: QuoteRecord[]): QuoteRecord[] {
  const byQuoteId = new Map<string, QuoteRecord>();
  for (const row of rows) {
    const prev = byQuoteId.get(row.quote_id);
    if (!prev) {
      byQuoteId.set(row.quote_id, row);
      continue;
    }
    const prevTs = new Date(prev.modified_date || prev.created_at).getTime();
    const rowTs = new Date(row.modified_date || row.created_at).getTime();
    if (rowTs >= prevTs) byQuoteId.set(row.quote_id, row);
  }
  return [...byQuoteId.values()].sort(
    (a, b) =>
      new Date(b.modified_date || b.created_at).getTime() -
      new Date(a.modified_date || a.created_at).getTime(),
  );
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

function staffNamesForQuote(q: QuoteListRow): string[] {
  if (q.pitching) {
    const names = [q.pitching.main_pm_name, q.pitching.main_designer_name]
      .map((x) => x?.trim())
      .filter((x): x is string => Boolean(x));
    if (names.length > 0) return names;
  }
  const pm = q.project_data?.formData?.projectManager?.trim();
  if (pm) return [pm];
  const sub = q.submitter?.trim();
  if (sub) return [sub];
  return [];
}

function staffLabel(q: QuoteListRow): string {
  if (q.pitching) {
    const parts = [q.pitching.main_pm_name, q.pitching.main_designer_name]
      .map((x) => x?.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' / ');
  }
  return (
    q.project_data?.formData?.projectManager?.trim() ||
    q.submitter?.trim() ||
    '—'
  );
}

export function QuotationListView({ onOpenQuote }: QuotationListViewProps) {
  const [quotes, setQuotes] = useState<QuoteListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [staffFilter, setStaffFilter] = useState('__all__');
  const [deleteTarget, setDeleteTarget] = useState<QuoteListRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('enquiry_date');
  const [sortDir, setSortDir] = useState<ListSortDir>('desc');
  const [activeId, setActiveId] = useState<string | null>(null);

  const fetchQuotes = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('bwf_quote')
        .select(LIST_SELECT)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const deduped = dedupeQuotesByQuoteId((data as QuoteRecord[]) || []);

      const pitchingIds = [
        ...new Set(
          deduped
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
        deduped.map((q) => ({
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

  const staffFilterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const q of quotes) {
      for (const name of staffNamesForQuote(q)) {
        names.add(name);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }, [quotes]);

  const filteredQuotes = useMemo(() => {
    let rows = quotes;

    if (staffFilter !== '__all__') {
      const target = staffFilter.toLowerCase();
      rows = rows.filter((q) =>
        staffNamesForQuote(q).some((name) => name.toLowerCase() === target),
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
        q.quote_id.toLowerCase().includes(query)
      );
    });
  }, [quotes, searchQuery, staffFilter]);

  const sortedQuotes = useMemo(() => {
    const rows = [...filteredQuotes];
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
  }, [filteredQuotes, sortKey, sortDir]);

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
            !isLoading && sortedQuotes.length > 0
              ? `共 ${sortedQuotes.length} 筆 · 點擊任一列開啟報價`
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
            ) : sortedQuotes.length === 0 ? (
              <ListTableEmptyRow
                colSpan={11}
                message={emptyMessage}
              />
            ) : (
              sortedQuotes.map((quote) => {
                const selected = activeId === quote.id;
                const title = quoteDisplayName(quote);
                const code = quoteCode(quote);
                const days = quote.pitching?.remaining_days ?? null;
                const enquiryDate =
                  quote.pitching?.enquiry_date ||
                  quote.modified_date ||
                  quote.created_at;

                return (
                  <tr
                    key={quote.id}
                    tabIndex={0}
                    onMouseEnter={() => setActiveId(quote.id)}
                    onFocus={() => setActiveId(quote.id)}
                    onClick={() => onOpenQuote?.(quote.quote_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenQuote?.(quote.quote_id);
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border/70 transition-colors last:border-b-0',
                      selected ? 'bg-primary/10' : 'hover:bg-accent/50',
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs text-foreground">
                      {formatListDate(enquiryDate)}
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
                      {quote.pitching?.customer_type || '—'}
                    </td>
                    <td className="min-w-[220px] max-w-[320px] px-3 py-3">
                      <div className="truncate font-body text-sm font-semibold text-primary">
                        {title}
                      </div>
                      <div className="mt-0.5 truncate font-mono-data text-[11px] text-muted-foreground">
                        {code}
                        {quote.project_data?.formData?.clientName
                          ? ` · ${quote.project_data.formData.clientName}`
                          : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {quote.pitching?.service_type ? (
                        <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 font-body text-[11px] font-medium text-violet-700">
                          {quote.pitching.service_type}
                        </span>
                      ) : (
                        <span className="font-body text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs font-semibold text-foreground">
                      ${formatListMoney(quote.total_amount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs text-muted-foreground">
                      {quote.cost_price != null
                        ? `$${formatListMoney(quote.cost_price)}`
                        : 'N/A'}
                    </td>
                    <td className="max-w-[160px] px-3 py-3 font-body text-xs text-foreground">
                      <div>{staffLabel(quote)}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        提交: {quote.submitter || '—'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-md border px-2 py-0.5 font-body text-[11px] font-medium',
                          quoteStatusBadgeClass(quote.status),
                        )}
                      >
                        {quote.version} · {quote.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
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
                    </td>
                    <td className="whitespace-nowrap px-2 py-3">
                      <button
                        type="button"
                        title="刪除報價單"
                        aria-label={`刪除報價單 ${code}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(quote);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground/70 transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
              確定要刪除報價單{' '}
              <span className="font-mono-data font-bold text-foreground">
                {deleteTarget ? quoteCode(deleteTarget) : ''}
              </span>
              嗎？
              <br />
              <span className="mt-2 block text-xs text-muted-foreground">
                「{deleteLabel}」將永久移除，此操作無法撤銷。
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

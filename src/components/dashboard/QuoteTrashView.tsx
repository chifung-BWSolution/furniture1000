import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal, ModalButton } from '@/components/ui/modal';
import {
  listTrashedQuotes,
  restoreQuoteFromTrash,
  type TrashedQuoteRow,
} from '@/lib/quoteTrash';
import { compareNullable, quoteStatusBadgeClass, SortHeaderIcon, type ListSortDir, formatListDate, formatListMoney } from '@/lib/listTableUtils';
import { compareQuoteVersion, displayQuoteVersion } from '@/lib/quoteVersions';

import { ListPageShell, ListRefreshButton, ListTableCard, ListTableEmptyRow, ListTableLoadingRow, LIST_TABLE_TH_CLASS } from '@/components/dashboard/ListPageShell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type SortKey = 'trashedAt' | 'createdAt' | 'quoteId' | 'version' | 'clientName' | 'previousStatus' | 'totalAmount' | 'submitter';
const columns: readonly (readonly [SortKey, string])[] = [
  ['trashedAt', '移入日期'], ['createdAt', '建立日期'], ['quoteId', '報價單號'],
  ['version', '版本'], ['clientName', '客戶名稱'], ['previousStatus', '原報價狀態'],
  ['totalAmount', '報價金額'], ['submitter', '提交人'],
];

export function QuoteTrashView() {
  const [rows, setRows] = useState<TrashedQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('__all__');
  const [sortKey, setSortKey] = useState<SortKey>('trashedAt');
  const [sortDir, setSortDir] = useState<ListSortDir>('desc');
  const [pending, setPending] = useState<TrashedQuoteRow | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listTrashedQuotes());
    } catch (err: unknown) {
      setRows([]);
      setError(err instanceof Error ? err.message : '無法載入回收桶');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) =>
      (statusFilter === '__all__' || row.previousStatus === statusFilter) &&
      (!q || [row.quoteId, row.clientName, row.submitter, row.version, displayQuoteVersion(row.version)]
        .join(' ').toLowerCase().includes(q)),
    ).sort((a, b) => {
      if (sortKey === 'version') {
        return compareQuoteVersion(a.version, b.version) * (sortDir === 'asc' ? 1 : -1);
      }
      return compareNullable(
        sortKey === 'trashedAt' ? a.trashedAt || a.createdAt : a[sortKey],
        sortKey === 'trashedAt' ? b.trashedAt || b.createdAt : b[sortKey], sortDir,
      );
    });
  }, [query, rows, statusFilter, sortKey, sortDir]);

  const statuses = useMemo(() => [...new Set(rows.map((row) => row.previousStatus))].sort(), [rows]);


  const confirmRestore = async () => {
    if (!pending || restoring) return;
    setRestoring(true);
    try {
      await restoreQuoteFromTrash(pending.id);
      toast.success('已還原報價單', { description: pending.quoteId });
      setPending(null);
      await load();
    } catch (err: unknown) {
      toast.error('還原失敗', {
        description: err instanceof Error ? err.message : '請再試一次',
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <ListPageShell
        title="報價回收桶"
        subtitle="從報價一覽刪除的版本會留在這裡，報價內容與價錢都還在。還原後回到刪除前的狀態。"
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="搜尋報價單號、客戶、提交人"
        searchLeading={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="篩選原報價狀態" className="w-32 shrink-0 rounded-xl bg-card sm:w-40">
              <SelectValue placeholder="全部原狀態" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部原狀態</SelectItem>
              {statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
        }
        searchActions={<ListRefreshButton loading={loading} onClick={() => void load()} />}
      >
        <ListTableCard footer={!loading && !error ? `共 ${visible.length} 個版本${visible.length !== rows.length ? `（全部 ${rows.length} 個）` : ''}` : undefined}>
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map(([key, label]) => (
                <th key={key} scope="col" className={LIST_TABLE_TH_CLASS} aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground" onClick={() => {
                    setSortKey(key);
                    setSortDir(sortKey === key && sortDir === 'desc' ? 'asc' : 'desc');
                  }}>
                    {label}<SortHeaderIcon active={sortKey === key} dir={sortDir} />
                  </button>
                </th>
              ))}
              <th scope="col" className={LIST_TABLE_TH_CLASS}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <ListTableLoadingRow colSpan={9} label="載入回收桶…" /> : error ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-destructive" role="alert">
                <p>{error}</p><Button variant="outline" className="mt-3" onClick={() => void load()}>重新載入</Button>
              </td></tr>
            ) : visible.length === 0 ? (
              <ListTableEmptyRow colSpan={9} message={rows.length === 0 ? '回收桶是空的' : '沒有符合的報價單'} />
            ) : visible.map((row) => (
              <tr key={row.id} className="border-b border-border/70 transition-colors last:border-b-0 hover:bg-accent/50">
                <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs">{formatListDate(row.trashedAt || row.createdAt)}</td>
                <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs">{formatListDate(row.createdAt)}</td>
                <td className="px-3 py-3 text-sm font-semibold text-primary">{row.quoteId || '未命名報價單'}</td>
                <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs">{displayQuoteVersion(row.version)}</td>
                <td className="max-w-[260px] break-words px-3 py-3 text-sm">{row.clientName || '未填客戶'}</td>
                <td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${quoteStatusBadgeClass(row.previousStatus)}`}>{row.previousStatus}</span></td>
                <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs tabular-nums">HK$ {formatListMoney(row.totalAmount)}</td>
                <td className="px-3 py-3 text-xs">{row.submitter || '未知提交人'}</td>
                <td className="px-3 py-3">
                  <Button type="button" variant="outline" size="sm" aria-label={`還原 ${row.quoteId} ${displayQuoteVersion(row.version)}`} disabled={restoring} onClick={() => setPending(row)}>
                    <RotateCcw className="mr-2 h-4 w-4" />還原
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </ListTableCard>
      </ListPageShell>

      <Modal
        open={pending != null}
        onOpenChange={(open) => {
          if (!open && !restoring) setPending(null);
        }}
        size="md"
        icon={<RotateCcw className="h-6 w-6" />}
        title="還原報價單"
        description={
          pending
            ? `還原 ${pending.quoteId} ${displayQuoteVersion(pending.version)} 後，它會回到報價一覽，狀態恢復為「${pending.previousStatus}」。`
            : undefined
        }
        footer={
          <>
            <ModalButton variant="secondary" disabled={restoring} onClick={() => setPending(null)}>
              取消
            </ModalButton>
            <ModalButton variant="primary" disabled={restoring} onClick={() => void confirmRestore()}>
              {restoring ? '還原中…' : '確認還原'}
            </ModalButton>
          </>
        }
      />
    </>
  );
}

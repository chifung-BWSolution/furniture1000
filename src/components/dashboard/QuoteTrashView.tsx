import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal, ModalButton } from '@/components/ui/modal';
import {
  listTrashedQuotes,
  restoreQuoteFromTrash,
  type TrashedQuoteRow,
} from '@/lib/quoteTrash';
import { formatListDate, formatListMoney } from '@/lib/listTableUtils';
import { displayQuoteVersion } from '@/lib/quoteVersions';

export function QuoteTrashView() {
  const [rows, setRows] = useState<TrashedQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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
    if (!q) return rows;
    return rows.filter((row) =>
      [row.quoteId, row.clientName, row.submitter, row.version]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [query, rows]);

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
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                傢俬報價
              </p>
              <h1 className="mt-1 text-xl font-bold">報價回收桶</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                從報價一覽刪除的版本會留在這裡，報價內容與價錢都還在。還原後回到刪除前的狀態。
              </p>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜尋回收桶"
              placeholder="搜尋報價單號、客戶、提交人"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm sm:max-w-xs"
            />
          </div>
        </section>

        {loading && (
          <p className="px-2 text-sm text-muted-foreground">載入回收桶…</p>
        )}
        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}
        {!loading && !error && visible.length === 0 && (
          <section className="rounded-2xl border border-border/80 bg-card px-6 py-12 text-center shadow-sm">
            <Trash2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {rows.length === 0 ? '回收桶是空的' : '沒有符合的報價單'}
            </p>
          </section>
        )}

        <div className="grid gap-3">
          {visible.map((row) => (
            <article
              key={row.id}
              className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold">{row.quoteId || '未命名報價單'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.clientName || '未填客戶'} · {displayQuoteVersion(row.version)} · {row.submitter || '未知提交人'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  移入 {formatListDate(row.trashedAt || row.createdAt)} · 原狀態 {row.previousStatus} · HK$ {formatListMoney(row.totalAmount)}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setPending(row)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                還原
              </Button>
            </article>
          ))}
        </div>
      </div>

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
            <ModalButton variant="ghost" disabled={restoring} onClick={() => setPending(null)}>
              取消
            </ModalButton>
            <ModalButton variant="primary" disabled={restoring} onClick={() => void confirmRestore()}>
              {restoring ? '還原中…' : '確認還原'}
            </ModalButton>
          </>
        }
      />
    </div>
  );
}

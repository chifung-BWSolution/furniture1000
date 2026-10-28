import { useEffect, useState } from 'react';
import { FileText, FolderInput, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatListDate, formatListMoney } from '@/lib/listTableUtils';
import {
  searchPresentationQuotes,
  type PresentationQuoteOption,
} from '@/lib/presentationQuoteImport';

export function PresentationQuoteImportModal({
  open,
  disabled,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (quote: PresentationQuoteOption) => Promise<boolean | void>;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PresentationQuoteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedId('');
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void searchPresentationQuotes(query)
        .then((next) => {
          if (cancelled) return;
          setRows(next);
          setSelectedId((current) => (next.some((row) => row.id === current) ? current : ''));
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setRows([]);
          setError(err instanceof Error ? err.message : '載入報價單失敗');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const importQuote = async (quote: PresentationQuoteOption | null) => {
    if (!quote || importing || disabled) return;
    setSelectedId(quote.id);
    setImporting(true);
    try {
      const accepted = await onPick(quote);
      if (accepted === false) return;
      onOpenChange(false);
    } catch (err) {
      toast.error('導入失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!importing) onOpenChange(next);
      }}
      size="lg"
      icon={<FolderInput className="h-5 w-5" />}
      title="從現有報價單導入"
      description="選擇報價單後，帶入客戶、專案、平面圖、分區和報價產品。單價、數量、尺寸、備註和聯絡資料也會一併寫進簡報；成本價不會帶入。每個單號只列出最新版本。"
      footer={(
        <>
          <ModalButton variant="primary" disabled={!selected || importing || disabled} onClick={() => void importQuote(selected)}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            導入
          </ModalButton>
          <ModalButton variant="secondary" disabled={importing} onClick={() => onOpenChange(false)}>
            取消
          </ModalButton>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋報價單號或客戶名稱"
            className="h-10 rounded-lg pl-9"
            aria-label="搜尋報價單"
          />
        </div>
        <div className="max-h-[22rem] overflow-y-auto rounded-xl border border-border/80">
          {loading ? (
            <p className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在載入報價單
            </p>
          ) : error ? (
            <p className="px-3 py-10 text-center text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">沒有相符的報價單</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {rows.map((row) => {
                const active = row.id === selectedId;
                const label = row.clientName || '未填客戶';
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted/60',
                        active && 'bg-[#f3f1ff] dark:bg-indigo-950/40',
                      )}
                      aria-pressed={active}
                      onClick={() => setSelectedId(row.id)}
                      onDoubleClick={() => void importQuote(row)}
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatListDate(row.updatedAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[row.quoteId || '未編號', row.versionLabel, row.hasFloorPlan ? '有平面圖' : '無平面圖', `HK$ ${formatListMoney(row.totalAmount)}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {selected
            ? `已選 ${selected.quoteId || '未編號'} ${selected.versionLabel}。已填的簡報標題、目的和原文會保留；報價單有的平面圖、分區和產品會取代目前的清單。`
            : '點選一張報價單再導入。報價單沒有的欄位會保留你已經填好的內容。'}
        </p>
      </div>
    </Modal>
  );
}

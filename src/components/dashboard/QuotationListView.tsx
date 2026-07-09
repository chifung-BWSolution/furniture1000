import { useState, useEffect, useCallback } from 'react';
import { Search, SlidersHorizontal, FileText, Clock, RefreshCw, Trash2 } from 'lucide-react';
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

interface QuoteRecord {
  id: string;
  quote_id: string;
  version: string;
  status: string;
  total_amount: number;
  cost_price: number | null;
  submitter: string;
  project_data: {
    formData?: {
      projectName?: string;
      clientName?: string;
      company?: string;
    };
    items?: Array<{ name: string; unitPrice: number; quantity: number }>;
    [key: string]: unknown;
  };
  created_at: string;
}

interface QuotationListViewProps {
  onOpenQuote?: (quoteId: string) => void;
}

function getStatusColor(status: string) {
  switch (status) {
    case '待審核':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case '已通過':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case '已退回':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}

export function QuotationListView({ onOpenQuote }: QuotationListViewProps) {
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<QuoteRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchQuotes = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('bwf_quote')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setQuotes((data as QuoteRecord[]) || []);
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
        description: deleteTarget.quote_id,
      });
      setDeleteTarget(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '無法刪除報價單';
      toast.error('刪除失敗', { description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredQuotes = quotes.filter((q) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const projectName = q.project_data?.formData?.projectName || '';
    const clientName = q.project_data?.formData?.clientName || '';
    return (
      q.quote_id.toLowerCase().includes(query) ||
      projectName.toLowerCase().includes(query) ||
      clientName.toLowerCase().includes(query) ||
      q.submitter.toLowerCase().includes(query)
    );
  });

  const deleteProjectName =
    deleteTarget?.project_data?.formData?.projectName || '未命名專案';

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            報價單一覽
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            管理和追蹤所有已提交的報價記錄
          </p>
        </div>

        {/* Search & Filter Bar */}
        <div className="mb-6 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋報價單編號、專案名稱..."
              className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
          <button
            type="button"
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 font-body text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <SlidersHorizontal className="h-4 w-4" />
            進階篩選
          </button>
          <button
            type="button"
            onClick={fetchQuotes}
            className="flex items-center justify-center h-10 w-10 rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="重新載入"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Quote List */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-5 w-48 rounded bg-muted" />
                    <div className="h-3 w-32 rounded bg-muted" />
                  </div>
                  <div className="space-y-2 text-right">
                    <div className="h-5 w-20 rounded bg-muted ml-auto" />
                    <div className="h-3 w-28 rounded bg-muted ml-auto" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
              <FileText className="h-7 w-7 text-muted-foreground/60" />
            </div>
            <h3 className="font-display text-base font-semibold text-foreground/80 mb-1">
              {searchQuery ? '沒有符合的報價單' : '尚無報價記錄'}
            </h3>
            <p className="font-body text-sm text-muted-foreground">
              {searchQuery
                ? '請嘗試不同的搜尋關鍵字'
                : '建立新報價單後，記錄將顯示在此處'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredQuotes.map((quote) => {
              const projectName =
                quote.project_data?.formData?.projectName || '未命名專案';
              const clientName =
                quote.project_data?.formData?.clientName || '—';

              return (
                <div
                  key={quote.id}
                  onClick={() => onOpenQuote?.(quote.quote_id)}
                  className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left */}
                    <div className="min-w-0 flex-1">
                      {/* Top Row: Quote ID, Company Badge, Version+Status */}
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="font-mono-data text-[11px] tracking-wider text-muted-foreground">
                          {quote.quote_id}
                        </span>
                        <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono-data text-[10px] font-bold tracking-wider text-primary">
                          BWF
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 font-body text-[11px] font-medium ${getStatusColor(quote.status)}`}
                        >
                          {quote.version} · {quote.status}
                        </span>
                      </div>

                      {/* Main Title */}
                      <h3 className="mb-1 truncate font-display text-base font-bold text-foreground group-hover:text-primary transition-colors">
                        {projectName}
                      </h3>

                      {/* Subtitle */}
                      <p className="font-body text-sm text-muted-foreground">
                        {clientName}
                        <span className="mx-2 text-border">·</span>
                        <span className="text-xs">提交者: {quote.submitter}</span>
                      </p>
                    </div>

                    {/* Right */}
                    <div className="flex items-start gap-3 flex-shrink-0">
                      <div className="flex flex-col items-end">
                        <span className="font-display text-lg font-bold text-foreground">
                          ${quote.total_amount.toLocaleString()}
                        </span>
                        {quote.cost_price != null && (
                          <span className="mt-0.5 font-mono-data text-[11px] text-muted-foreground">
                            成本: ${quote.cost_price.toLocaleString()}
                          </span>
                        )}
                        <span className="mt-1 flex items-center gap-1 font-mono-data text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(quote.created_at)}
                        </span>
                      </div>
                      <button
                        type="button"
                        title="刪除報價單"
                        aria-label={`刪除報價單 ${quote.quote_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(quote);
                        }}
                        className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground/70 transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
                {deleteTarget?.quote_id}
              </span>
              嗎？
              <br />
              <span className="mt-2 block text-xs text-muted-foreground">
                「{deleteProjectName}」將永久移除，此操作無法撤銷。
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
    </div>
  );
}

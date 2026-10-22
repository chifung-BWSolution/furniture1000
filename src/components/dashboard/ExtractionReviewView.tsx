import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoadingImage } from '@/components/ui/loading-image';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  FileSearch,
  FileText,
  ImageOff,
  Loader2,
  Lock,
  MoreHorizontal,
  PackageCheck,
  PackagePlus,
  Pencil,
  PencilLine,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Modal, ModalButton } from '@/components/ui/modal';
import { SourcePageDialog } from '@/components/dashboard/SourcePageDialog';
import { canManageSupplierDocuments } from '@/lib/supplierDocuments';
import { importExtractedProducts } from '@/lib/productSearch';
import {
  EDITABLE_FIELDS,
  FLAG_LABELS,
  addToReviewCounts,
  countExtractionItems,
  effectiveProduct,
  emptyReviewCounts,
  isCorrected,
  listExtractionImages,
  listExtractionItems,
  listReviewDocuments,
  reviewExtractionItem,
  reviewExtractionItemsBatch,
  type ExtractedProduct,
  type ExtractionImage,
  type ExtractionItem,
  type ExtractionStatus,
  type ReviewDocument,
  type ReviewDocumentCounts,
} from '@/lib/extractionReview';

type Filter = 'all' | 'pending' | 'attention' | 'approved' | 'imported' | 'rejected';
type Phase = 'all' | 'parsing' | 'review' | 'done';

/** What the reviewer sees on a row; import state overrides the review status. */
type RowState = 'pending' | 'attention' | 'ready' | 'imported' | 'rejected';

const ROW_STATE: Record<RowState, { label: string; className: string }> = {
  pending: { label: '待審核', className: 'border-primary/25 bg-primary/10 text-primary' },
  attention: {
    label: '待補充',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  ready: {
    label: '可匯入',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  imported: {
    label: '已匯入',
    className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  },
  rejected: { label: '已拒絕', className: 'border-border bg-muted text-muted-foreground' },
};

const PHASE_LABEL: Record<Exclude<Phase, 'all'>, string> = {
  parsing: '解析中',
  review: '待審核',
  done: '已審完',
};

/** Flags that are informational only; everything else is shown as a warning. */
const INFO_FLAGS = new Set(['catalog_no_price', 'currency_from_document', 'ai_uncertain']);

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sizeText(p: ExtractedProduct): string {
  const dims = [p.width_mm, p.depth_mm, p.height_mm];
  if (dims.every((d) => d == null)) return p.dimensions_text ?? '—';
  return dims.map((d) => (d == null ? '?' : d)).join(' × ');
}

function priceParts(
  p: ExtractedProduct,
  docCurrency: string | null,
): { currency: string | null; amount: string } | null {
  if (p.price == null) return null;
  const currency = (p.currency ?? docCurrency ?? '').trim().toUpperCase() || null;
  return {
    currency,
    amount: p.price.toLocaleString('en-US', { maximumFractionDigits: 2 }),
  };
}

function rowState(item: ExtractionItem): RowState {
  if (item.imported_product_id) return 'imported';
  if (item.status === 'approved') return 'ready';
  if (item.status === 'rejected') return 'rejected';
  return item.needs_attention ? 'attention' : 'pending';
}

function docPhase(doc: ReviewDocument): Exclude<Phase, 'all'> {
  if (doc.status === 'parsing') return 'parsing';
  if (doc.counts.pending + doc.counts.attention === 0) return 'done';
  return 'review';
}

function matchesFilter(item: ExtractionItem, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return item.status === 'pending' && item.needs_attention;
  if (filter === 'pending') return item.status === 'pending' && !item.needs_attention;
  if (filter === 'approved') return item.status === 'approved';
  if (filter === 'imported') return !!item.imported_product_id;
  return item.status === 'rejected';
}

/**
 * Imported PDFs often already start with their own list number ("1.向氏 QXS").
 * Only add our position number when the name does not carry one.
 */
function numberedFactoryName(doc: ReviewDocument, index: number): string {
  const name = doc.factory_name?.trim() || '未指定廠家';
  return /^\d+\s*[.、．)]/.test(name) ? name : `${index + 1}. ${name}`;
}

function fieldToInput(value: unknown, kind: string): string {
  if (value == null) return '';
  if (kind === 'list' && Array.isArray(value)) return value.join(', ');
  return String(value);
}

function inputToField(value: string, kind: string): unknown {
  const v = value.trim();
  if (!v) return kind === 'list' ? [] : null;
  if (kind === 'number') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'list') return v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  return v;
}

interface ExtractionReviewViewProps {
  /** Jump to 上載報價PDF when there is nothing to review yet. */
  onOpenUpload?: () => void;
}

export function ExtractionReviewView({ onOpenUpload }: ExtractionReviewViewProps = {}) {
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<ReviewDocument[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [items, setItems] = useState<ExtractionItem[]>([]);
  const [images, setImages] = useState<ExtractionImage[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [docQuery, setDocQuery] = useState('');
  const [factoryFilter, setFactoryFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState<Phase>('all');
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ExtractionItem | null>(null);
  const [sourcePage, setSourcePage] = useState<number | null | undefined>(undefined);
  const itemsRequestRef = useRef(0);

  const imageById = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);

  useEffect(() => {
    let cancelled = false;
    canManageSupplierDocuments().then((ok) => {
      if (!cancelled) setCanManage(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadDocs = useCallback(async () => {
    setLoadingDocs(true);
    setDocsError(null);
    try {
      const rows = await listReviewDocuments();
      setDocs(rows);
      setDocId((cur) => (cur && rows.some((d) => d.id === cur) ? cur : rows[0]?.id ?? null));
    } catch (err) {
      setDocsError(errorText(err));
      toast.error('讀取文件失敗', { description: errorText(err) });
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const reloadItems = useCallback(async (id: string) => {
    const requestId = ++itemsRequestRef.current;
    setLoadingItems(true);
    setItemsError(null);
    try {
      const [rows, imgs] = await Promise.all([listExtractionItems(id), listExtractionImages(id)]);
      if (requestId !== itemsRequestRef.current) return;
      setItems(rows);
      setImages(imgs);
    } catch (err) {
      if (requestId !== itemsRequestRef.current) return;
      setItemsError(errorText(err));
      toast.error('讀取提取結果失敗', { description: errorText(err) });
    } finally {
      if (requestId === itemsRequestRef.current) setLoadingItems(false);
    }
  }, []);

  /** Keep the left-hand document card in step without refetching the whole list. */
  const refreshCounts = useCallback(async (id: string) => {
    try {
      const counts = await countExtractionItems([id]);
      setDocs((cur) =>
        cur.map((d) => (d.id === id ? { ...d, counts: counts[id] ?? emptyReviewCounts() } : d)),
      );
    } catch {
      // Sidebar totals are a convenience; a failed refresh must not interrupt reviewing.
    }
  }, []);

  useEffect(() => {
    if (canManage) void reloadDocs();
  }, [canManage, reloadDocs]);

  useEffect(() => {
    setSelected(new Set());
    setEditing(null);
    if (!docId) {
      itemsRequestRef.current += 1;
      setItems([]);
      setImages([]);
      setItemsError(null);
      setLoadingItems(false);
      return;
    }
    // Drop the previous document immediately so approve/reject cannot hit its items.
    setItems([]);
    setImages([]);
    setItemsError(null);
    setQuery('');
    setFilter('pending');
    void reloadItems(docId);
  }, [docId, reloadItems]);

  const factoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const d of docs) {
      const name = d.factory_name?.trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }, [docs]);

  const visibleDocs = useMemo(() => {
    const q = docQuery.trim().toLowerCase();
    return docs.filter((d) => {
      if (factoryFilter !== 'all' && d.factory_name !== factoryFilter) return false;
      if (phaseFilter !== 'all' && docPhase(d) !== phaseFilter) return false;
      if (!q) return true;
      return [d.factory_name, d.title].some((v) => v?.toLowerCase().includes(q));
    });
  }, [docs, docQuery, factoryFilter, phaseFilter]);

  useEffect(() => {
    if (visibleDocs.length === 0) {
      if (docId !== null) setDocId(null);
      return;
    }
    if (!docId || !visibleDocs.some((d) => d.id === docId)) {
      setDocId(visibleDocs[0].id);
    }
  }, [docId, visibleDocs]);

  const doc = docs.find((d) => d.id === docId) ?? null;
  const docIndex = doc ? visibleDocs.findIndex((d) => d.id === doc.id) : -1;

  const itemCounts = useMemo(() => {
    const c: ReviewDocumentCounts = emptyReviewCounts();
    for (const item of items) addToReviewCounts(c, item);
    return c;
  }, [items]);

  const tabs = useMemo(() => {
    const list: { id: Filter; label: string; count: number }[] = [
      { id: 'all', label: '全部', count: itemCounts.total },
      { id: 'pending', label: '待審核', count: itemCounts.pending },
      { id: 'attention', label: '待補充', count: itemCounts.attention },
      { id: 'approved', label: '已通過', count: itemCounts.approved },
    ];
    if (itemCounts.imported > 0) {
      list.push({ id: 'imported', label: '已匯入', count: itemCounts.imported });
    }
    if (itemCounts.rejected > 0) list.push({ id: 'rejected', label: '已拒絕', count: itemCounts.rejected });
    return list;
  }, [itemCounts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesFilter(item, filter)) return false;
      if (!q) return true;
      const p = effectiveProduct(item);
      return [p.model, p.name, p.series, p.category, p.material].some((v) =>
        v?.toLowerCase().includes(q),
      );
    });
  }, [items, filter, query]);

  const selectable = visible.filter((i) => !i.imported_product_id);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  const importableCount = items.filter((i) => i.status === 'approved' && !i.imported_product_id).length;

  /**
   * First open of a document should land on rows that need work. Only runs once
   * per document so a reviewer can still pick an empty tab on purpose.
   */
  const autoFilterDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (!docId || loadingItems || items.length === 0 || autoFilterDocRef.current === docId) return;
    autoFilterDocRef.current = docId;
    if (itemCounts.pending > 0) return;
    if (itemCounts.attention > 0) setFilter('attention');
    else if (itemCounts.imported > 0) setFilter('imported');
  }, [docId, loadingItems, items.length, itemCounts]);

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyLocal = (ids: string[], status: ExtractionStatus) => {
    const set = new Set(ids);
    setItems((cur) => cur.map((i) => (set.has(i.id) ? { ...i, status } : i)));
  };

  const handleBatch = async (status: ExtractionStatus) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const { updated, blocked } = await reviewExtractionItemsBatch(ids, status);
      if (blocked > 0 && doc) await reloadItems(doc.id);
      else applyLocal(ids, status);
      setSelected(new Set());
      if (doc) void refreshCounts(doc.id);
      toast.success(
        `${status === 'approved' ? '已通過' : status === 'rejected' ? '已拒絕' : '已退回待審'} ${updated} 項`,
        {
          description:
            blocked > 0 ? `${blocked} 項報價未確認，仍是待審。請先填上核對後的價格。` : undefined,
        },
      );
    } catch (err) {
      toast.error('批量審核失敗', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleSingle = async (item: ExtractionItem, status: ExtractionStatus) => {
    setBusy(true);
    try {
      await reviewExtractionItem({ itemId: item.id, status });
      applyLocal([item.id], status);
      if (doc) void refreshCounts(doc.id);
    } catch (err) {
      toast.error('審核失敗', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!doc || importableCount === 0) return;
    setBusy(true);
    try {
      const res = await importExtractedProducts(doc.id);
      const missingModel = res.skipped.filter((s) => s.reason === 'missing_model').length;
      const unconfirmed = res.skipped.filter((s) => s.reason === 'price_not_confirmed').length;
      const notes = [
        missingModel > 0 ? `${missingModel} 項缺型號未匯入，請先修正型號` : '',
        unconfirmed > 0 ? `${unconfirmed} 項價格未確認，未寫成正式價` : '',
      ].filter(Boolean);
      toast.success(
        `已匯入：新產品 ${res.created} 件、沿用既有產品 ${res.linked} 件、報價 ${res.prices} 條`,
        { description: notes.length > 0 ? notes.join('；') : undefined },
      );
      await reloadItems(doc.id);
      void reloadDocs();
    } catch (err) {
      toast.error('匯入失敗', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenSource = (page: number | null) => {
    if (!doc) return;
    setSourcePage(page);
  };

  if (canManage === null) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 檢查權限…
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 p-6">
        <div className="max-w-sm rounded-2xl border border-border bg-card p-6 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Lock className="h-5 w-5" />
          </span>
          <h2 className="mt-3 font-display text-base font-bold text-foreground">只限 admin／傢俬組</h2>
          <p className="mt-1 font-body text-sm leading-relaxed text-muted-foreground">
            AI 提取結果含成本價，只限 admin／傢俬組查看。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20">
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-3 md:p-5 xl:flex-row">
        {/* ── 供應商文件 ─────────────────────────────────────────────── */}
        <aside className="flex max-h-[46vh] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card xl:max-h-none xl:w-[336px]">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="font-display text-base font-bold tracking-tight text-foreground">供應商文件</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => void reloadDocs()}
              disabled={loadingDocs}
              title="重新整理文件清單"
              aria-label="重新整理文件清單"
            >
              <RefreshCw className={cn('h-4 w-4', loadingDocs && 'animate-spin')} />
            </Button>
          </div>

          <div className="space-y-2 border-b border-border px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={docQuery}
                onChange={(e) => setDocQuery(e.target.value)}
                placeholder="搜尋供應商／文件名稱"
                aria-label="搜尋供應商或文件名稱"
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Select value={factoryFilter} onValueChange={setFactoryFilter}>
                <SelectTrigger className="h-8 flex-1 text-xs" aria-label="篩選供應商">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部供應商</SelectItem>
                  {factoryOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={phaseFilter} onValueChange={(v) => setPhaseFilter(v as Phase)}>
                <SelectTrigger className="h-8 w-[7.5rem] shrink-0 text-xs" aria-label="篩選文件狀態">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部狀態</SelectItem>
                  <SelectItem value="parsing">{PHASE_LABEL.parsing}</SelectItem>
                  <SelectItem value="review">{PHASE_LABEL.review}</SelectItem>
                  <SelectItem value="done">{PHASE_LABEL.done}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loadingDocs && docs.length === 0 && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-xl border border-border/60 p-3">
                    <div className="flex gap-2">
                      <Skeleton className="h-9 w-9 rounded-lg" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                    <Skeleton className="mt-2 h-10 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            )}

            {docsError && (
              <div className="m-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                <p className="font-medium">未能讀取文件清單</p>
                <p className="mt-0.5 break-words text-destructive/80">{docsError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 border-destructive/30 text-xs text-destructive"
                  onClick={() => void reloadDocs()}
                >
                  重試
                </Button>
              </div>
            )}

            {!docsError && !loadingDocs && visibleDocs.length === 0 && (
              <div className="px-2 py-6 text-center">
                <FileSearch className="mx-auto h-6 w-6 text-muted-foreground/60" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {docs.length === 0
                    ? '未有 AI 提取結果。上載並解析供應商 PDF 後，文件會出現在這裡。'
                    : '沒有符合篩選的文件。'}
                </p>
                {docs.length === 0 && onOpenUpload && (
                  <Button size="sm" variant="outline" className="mt-3 h-8 text-xs" onClick={onOpenUpload}>
                    上載報價 PDF
                  </Button>
                )}
              </div>
            )}

            <ul className="space-y-1.5">
              {visibleDocs.map((d, index) => (
                <li key={d.id}>
                  <DocTile
                    doc={d}
                    index={index}
                    active={d.id === docId}
                    onSelect={() => setDocId(d.id)}
                    onOpenSource={() => {
                      setDocId(d.id);
                      setSourcePage(null);
                    }}
                    onOnlyAttention={() => {
                      setDocId(d.id);
                      setFilter('attention');
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* ── 提取結果 ───────────────────────────────────────────────── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5">
          {!doc ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 p-8">
              <div className="max-w-sm text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <FileSearch className="h-6 w-6" />
                </span>
                <h2 className="mt-3 font-display text-lg font-bold tracking-tight text-foreground">
                  未有待審核的提取結果
                </h2>
                <p className="mt-1 font-body text-sm leading-relaxed text-muted-foreground">
                  上載供應商報價單或產品目錄，AI 會抽出型號、尺寸與成本價，再交給你逐項核對。
                </p>
                {onOpenUpload && (
                  <Button className="mt-4" onClick={onOpenUpload}>
                    <PackagePlus className="mr-1.5 h-4 w-4" /> 上載報價 PDF
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h1 className="font-display text-lg font-bold leading-snug tracking-tight text-foreground">
                    <span className="break-words">
                      {docIndex >= 0 ? numberedFactoryName(doc, docIndex) : doc.factory_name || '未指定廠家'}
                      {doc.title ? ` · ${doc.title}` : ''}
                    </span>
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-xs text-muted-foreground">
                    <span>
                      供應商：<span className="font-medium text-foreground">{doc.factory_name || '未指定'}</span>
                    </span>
                    <span>上傳時間：{formatDateTime(doc.created_at)}</span>
                    <span>檔案大小：{formatFileSize(doc.file_size)}</span>
                    <span>{doc.page_count ?? '?'} 頁</span>
                    <span>幣種：{doc.currency ?? '未設定'}</span>
                    <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px]">
                      {doc.doc_type === 'catalog' ? '產品目錄' : '報價單'} · {PHASE_LABEL[docPhase(doc)]}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-9"
                    onClick={() => handleOpenSource(null)}
                    title="以簽署連結開啟原始 PDF"
                  >
                    <FileText className="mr-1.5 h-4 w-4" /> 原文 PDF
                  </Button>
                  <Button
                    className="h-9"
                    disabled={busy || importableCount === 0}
                    onClick={() => void handleImport()}
                    title="把已通過的項目寫入產品庫（型號＋廠家相同即沿用既有產品，只追加報價）"
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <PackagePlus className="mr-1.5 h-4 w-4" />
                    )}
                    匯入產品庫
                    {importableCount > 0 && (
                      <span className="ml-1.5 rounded-full bg-primary-foreground/20 px-1.5 font-mono-data text-[11px] tabular-nums">
                        {importableCount}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <StatTile
                  icon={FileText}
                  label="文件筆數"
                  hint="此文件抽出的所有產品"
                  value={itemCounts.total}
                  tone="neutral"
                  active={filter === 'all'}
                  onClick={() => setFilter('all')}
                />
                <StatTile
                  icon={AlertCircle}
                  label="未處理"
                  hint="AI 缺資料或信心偏低，需要補充"
                  value={itemCounts.attention}
                  tone="amber"
                  active={filter === 'attention'}
                  onClick={() => setFilter('attention')}
                />
                <StatTile
                  icon={Search}
                  label="待審核"
                  hint="等待你核對的項目"
                  value={itemCounts.pending}
                  tone="primary"
                  active={filter === 'pending'}
                  onClick={() => setFilter('pending')}
                />
                <StatTile
                  icon={PackageCheck}
                  label="已匯入"
                  hint="已寫入產品庫的項目"
                  value={itemCounts.imported}
                  tone="emerald"
                  active={filter === 'imported'}
                  onClick={() => {
                    setFilter('imported');
                    setQuery('');
                  }}
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                  <div className="relative w-full sm:w-56">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="型號／名稱"
                      aria-label="搜尋型號或名稱"
                      className="h-8 pl-8 text-sm"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="審核狀態">
                    {tabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={filter === tab.id}
                        onClick={() => {
                          setFilter(tab.id);
                          setSelected(new Set());
                        }}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                          filter === tab.id
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {tab.label}
                        <span
                          className={cn(
                            'font-mono-data tabular-nums',
                            filter === tab.id ? 'text-primary-foreground/80' : 'text-muted-foreground/70',
                          )}
                        >
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {selected.size > 0 ? (
                        <>
                          已選擇 <span className="font-mono-data font-semibold text-foreground">{selected.size}</span> 個項目
                        </>
                      ) : (
                        <>
                          顯示 <span className="font-mono-data tabular-nums">{visible.length}</span> 項
                        </>
                      )}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={selected.size === 0 || busy}
                        >
                          批量操作
                          <ChevronDown className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          已選 {selected.size} 項
                        </DropdownMenuLabel>
                        <DropdownMenuItem disabled={busy} onSelect={() => void handleBatch('approved')}>
                          <Check className="mr-2 h-4 w-4 text-emerald-600" />
                          批量通過
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={busy} onSelect={() => void handleBatch('rejected')}>
                          <X className="mr-2 h-4 w-4 text-muted-foreground" />
                          批量拒絕
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={busy} onSelect={() => void handleBatch('pending')}>
                          退回待審
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setSelected(new Set())}>
                          清除選擇
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {itemsError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                      <AlertCircle className="h-6 w-6 text-destructive" />
                      <p className="text-sm text-muted-foreground">未能讀取提取結果</p>
                      <p className="max-w-md text-xs text-muted-foreground/80">{itemsError}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => doc && void reloadItems(doc.id)}
                      >
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> 重試
                      </Button>
                    </div>
                  ) : (
                    <table className="w-full min-w-[960px] border-collapse text-sm">
                      <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="w-9 px-3 py-2.5">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={toggleAll}
                              disabled={selectable.length === 0}
                              aria-label="全選可審核項目"
                            />
                          </th>
                          <th className="w-12 py-2.5 text-left font-medium">圖片</th>
                          <th className="min-w-[180px] py-2.5 text-left font-medium">型號／名稱</th>
                          <th className="w-[6.5rem] py-2.5 text-left font-medium">尺寸 (mm)</th>
                          <th className="w-[4rem] py-2.5 text-center font-medium">PDF 頁</th>
                          <th className="w-[6.5rem] py-2.5 text-right font-medium">成本價</th>
                          <th className="w-[6.5rem] py-2.5 text-left font-medium">置信度</th>
                          <th className="w-[9.5rem] py-2.5 text-left font-medium">標籤</th>
                          <th className="w-[5rem] py-2.5 text-left font-medium">狀態</th>
                          <th className="w-[6rem] py-2.5 pr-3 text-right font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingItems &&
                          [0, 1, 2, 3, 4, 5].map((i) => (
                            <tr key={i} className="border-b border-border/60">
                              <td className="px-3 py-3" colSpan={10}>
                                <div className="flex items-center gap-3">
                                  <Skeleton className="h-10 w-10 rounded-lg" />
                                  <Skeleton className="h-4 w-40" />
                                  <Skeleton className="h-3 w-24" />
                                  <Skeleton className="ml-auto h-3 w-16" />
                                </div>
                              </td>
                            </tr>
                          ))}

                        {!loadingItems &&
                          visible.map((item) => {
                            const p = effectiveProduct(item);
                            const main = item.main_image_id ? imageById.get(item.main_image_id) : undefined;
                            const state = rowState(item);
                            const locked = !!item.imported_product_id;
                            const price = priceParts(p, doc.currency);
                            const tags = itemTags(item);
                            const extraTags = tags.length - 3;
                            const category = p.series || p.category;
                            return (
                              <tr
                                key={item.id}
                                className={cn(
                                  'border-b border-border/60 align-middle transition-colors hover:bg-muted/40',
                                  state === 'attention' && 'bg-amber-500/[0.04]',
                                  selected.has(item.id) && 'bg-primary/[0.05]',
                                )}
                              >
                                <td className="px-3 py-2.5">
                                  <Checkbox
                                    checked={selected.has(item.id)}
                                    disabled={locked}
                                    onCheckedChange={() => toggleOne(item.id)}
                                    aria-label={`選取 ${p.model ?? p.name ?? '項目'}`}
                                  />
                                </td>
                                <td className="py-2.5">
                                  {main ? (
                                    <LoadingImage
                                      src={main.public_url}
                                      alt={p.name ?? '產品圖片'}
                                      className="h-10 w-10 rounded-lg border border-border/60 object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div
                                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground"
                                      title="AI 未找到此產品的圖片"
                                    >
                                      <ImageOff className="h-4 w-4" />
                                    </div>
                                  )}
                                </td>
                                <td className="max-w-[17rem] py-2.5 pr-2">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={cn(
                                        'truncate font-mono-data text-[13px] font-semibold text-foreground',
                                        !p.model && 'text-destructive',
                                      )}
                                    >
                                      {p.model ?? '缺型號'}
                                    </span>
                                    {isCorrected(item, 'model') && (
                                      <Pencil
                                        className="h-3 w-3 shrink-0 text-sky-600"
                                        aria-label="型號已人手修正"
                                      />
                                    )}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {p.name || '（未命名）'}
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                                    {category && <span className="max-w-[12rem] truncate">{category}</span>}
                                  </div>
                                </td>
                                <td className="whitespace-nowrap py-2.5 pr-2 font-mono-data text-xs tabular-nums text-muted-foreground">
                                  {sizeText(p)}
                                </td>
                                <td className="py-2.5 text-center">
                                  {item.page_no != null ? (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenSource(item.page_no)}
                                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono-data text-[11px] tabular-nums text-foreground underline-offset-2 transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                                      title={`開啟原文 PDF 第 ${item.page_no} 頁`}
                                      aria-label={`開啟原文 PDF 第 ${item.page_no} 頁`}
                                    >
                                      P.{item.page_no}
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground/60">—</span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap py-2.5 pr-2 text-right">
                                  {price ? (
                                    <>
                                      <span className="font-mono-data text-[13px] font-semibold tabular-nums text-foreground">
                                        {price.amount}
                                      </span>
                                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                                        {price.currency ?? '未標幣種'}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                  {(p.other_prices?.length ?? 0) > 0 && (
                                    <div className="text-[10px] text-muted-foreground">
                                      +{p.other_prices!.length} 個價
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 pr-2">
                                  <ConfidenceBar value={item.confidence} />
                                </td>
                                <td className="py-2.5 pr-2">
                                  <div className="flex flex-wrap items-center gap-1">
                                    {tags.slice(0, 3).map((tag) => (
                                      <span
                                        key={`${tag.label}-${tag.tone}`}
                                        className={cn(
                                          'inline-flex max-w-[9.5rem] items-center truncate rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                                          tag.tone === 'warn'
                                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                            : 'border-border bg-muted/60 text-muted-foreground',
                                        )}
                                        title={tag.label}
                                      >
                                        {tag.label}
                                      </span>
                                    ))}
                                    {extraTags > 0 && (
                                      <span
                                        className="inline-flex rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                        title={tags.slice(3).map((t) => t.label).join('、')}
                                      >
                                        +{extraTags}
                                      </span>
                                    )}
                                    {tags.length === 0 && (
                                      <span className="text-[10px] text-muted-foreground/60">—</span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 pr-2">
                                  <span
                                    className={cn(
                                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                                      ROW_STATE[state].className,
                                    )}
                                  >
                                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                                    {ROW_STATE[state].label}
                                  </span>
                                </td>
                                <td className="py-2.5 pr-3">
                                  <div className="flex justify-end gap-0.5">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                      disabled={locked}
                                      title="修正提取結果"
                                      aria-label="修正提取結果"
                                      onClick={() => setEditing(item)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
                                      disabled={locked || busy || item.status === 'approved'}
                                      title="通過此項"
                                      aria-label="通過此項"
                                      onClick={() => void handleSingle(item, 'approved')}
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                      disabled={locked || busy || item.status === 'rejected'}
                                      title="拒絕此項"
                                      aria-label="拒絕此項"
                                      onClick={() => void handleSingle(item, 'rejected')}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}

                        {!loadingItems && visible.length === 0 && (
                          <tr>
                            <td colSpan={10} className="px-4 py-14">
                              <div className="mx-auto max-w-sm text-center">
                                <FileSearch className="mx-auto h-6 w-6 text-muted-foreground/60" />
                                <p className="mt-2 text-sm font-medium text-foreground">沒有符合條件的項目</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {query.trim()
                                    ? '試試其他型號或名稱，或清除搜尋。'
                                    : filter === 'pending'
                                      ? '這份文件已沒有待審核項目，可切換到「待補充」或「全部」。'
                                      : '切換其他狀態看看。'}
                                </p>
                                <div className="mt-3 flex flex-wrap justify-center gap-2">
                                  {query.trim() && (
                                    <Button variant="outline" size="sm" className="h-8" onClick={() => setQuery('')}>
                                      清除搜尋
                                    </Button>
                                  )}
                                  {filter !== 'all' && (
                                    <Button variant="outline" size="sm" className="h-8" onClick={() => setFilter('all')}>
                                      查看全部
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {editing && (
        <EditItemDialog
          item={editing}
          images={editing.image_ids.map((id) => imageById.get(id)).filter((i): i is ExtractionImage => !!i)}
          docCurrency={doc?.currency ?? null}
          onClose={() => setEditing(null)}
          onOpenSource={() => void handleOpenSource(editing.page_no)}
          onSaved={(updated) => {
            setItems((cur) => cur.map((i) => (i.id === updated.id ? updated : i)));
            setEditing(null);
            if (doc) void refreshCounts(doc.id);
          }}
        />
      )}
      {doc && sourcePage !== undefined && (
        <SourcePageDialog
          request={{ documentId: doc.id, pageNo: sourcePage, title: doc.title }}
          onClose={() => setSourcePage(undefined)}
        />
      )}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────── */

function DocTile({
  doc,
  index,
  active,
  onSelect,
  onOpenSource,
  onOnlyAttention,
}: {
  doc: ReviewDocument;
  index: number;
  active: boolean;
  onSelect: () => void;
  onOpenSource: () => void;
  onOnlyAttention: () => void;
}) {
  const total = doc.counts.total;
  return (
    <div
      className={cn(
        'group relative rounded-xl border transition-colors',
        active ? 'border-primary/40 bg-primary/[0.05]' : 'border-transparent hover:border-border hover:bg-muted/40',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className="w-full rounded-xl p-2.5 pr-8 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
              active
                ? 'border-primary/20 bg-primary/10 text-primary'
                : 'border-border/70 bg-muted/60 text-muted-foreground',
            )}
          >
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {numberedFactoryName(doc, index)}
            </div>
            <div className="truncate text-xs text-muted-foreground">{doc.title ?? '—'}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
              <span className="font-mono-data tabular-nums">{formatDateTime(doc.created_at)}</span>
              <span aria-hidden>·</span>
              <span>{doc.doc_type === 'catalog' ? '目錄' : '報價單'}</span>
              {docPhase(doc) === 'parsing' && <span className="text-sky-600">· 解析中</span>}
            </div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-4 divide-x divide-border/60 rounded-lg border border-border/60 bg-card/70 py-1.5">
          <TileStat label="文件筆數" value={total} />
          <TileStat label="未處理" value={doc.counts.attention} tone="amber" />
          <TileStat label="待審核" value={doc.counts.pending} tone="primary" />
          <TileStat label="已匯入" value={doc.counts.imported} tone="emerald" />
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1 h-7 w-7 text-muted-foreground/70 opacity-70 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100"
            title="文件操作"
            aria-label={`${doc.factory_name || '未指定廠家'} 文件操作`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onOpenSource}>
            <ExternalLink className="mr-2 h-4 w-4" /> 開啟原文 PDF
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOnlyAttention} disabled={doc.counts.attention === 0}>
            <AlertCircle className="mr-2 h-4 w-4" /> 只看未處理
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TileStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'amber' | 'primary' | 'emerald';
}) {
  const toneClass =
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'primary'
        ? 'text-primary'
        : tone === 'emerald'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-foreground';
  return (
    <div className="px-1 text-center">
      <div className="text-[10px] leading-tight text-muted-foreground">{label}</div>
      <div className={cn('font-mono-data text-sm font-bold leading-tight tabular-nums', toneClass)}>
        {value}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  hint,
  value,
  tone,
  active,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  hint: string;
  value: number;
  tone: 'neutral' | 'amber' | 'primary' | 'emerald';
  active: boolean;
  onClick: () => void;
}) {
  const toneClass = {
    neutral: 'bg-muted text-muted-foreground',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    primary: 'bg-primary/10 text-primary',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors',
        active ? 'border-primary/40 bg-primary/[0.04]' : 'border-border hover:border-border hover:bg-muted/40',
      )}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', toneClass)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] leading-tight text-muted-foreground">{label}</span>
        <span className="block font-mono-data text-xl font-bold leading-tight tabular-nums text-foreground">
          {value}
        </span>
      </span>
    </button>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const bar = pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-primary' : 'bg-amber-500';
  const text = pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-foreground' : 'text-amber-600';
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full rounded-full transition-[width] duration-200', bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('w-8 font-mono-data text-[11px] tabular-nums', text)}>{pct}%</span>
    </div>
  );
}

function itemTags(item: ExtractionItem): { label: string; tone: 'info' | 'warn' }[] {
  const p = effectiveProduct(item);
  const tags: { label: string; tone: 'info' | 'warn' }[] = [];
  const seen = new Set<string>();
  const push = (label: string | null | undefined, tone: 'info' | 'warn') => {
    const value = label?.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    tags.push({ label: value, tone });
  };

  push(p.category, 'info');
  for (const flag of item.flags) {
    push(FLAG_LABELS[flag] ?? flag, INFO_FLAGS.has(flag) ? 'info' : 'warn');
  }
  // Attention rows with no flagged field still need a reason on the row.
  if (item.status === 'pending' && item.needs_attention && !tags.some((t) => t.tone === 'warn')) {
    push('待補資料', 'warn');
  }
  return tags;
}

interface EditItemDialogProps {
  item: ExtractionItem;
  images: ExtractionImage[];
  docCurrency: string | null;
  onClose: () => void;
  onOpenSource: () => void;
  onSaved: (item: ExtractionItem) => void;
}

function EditItemDialog({ item, images, docCurrency, onClose, onOpenSource, onSaved }: EditItemDialogProps) {
  const current = effectiveProduct(item);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, fieldToInput(current[f.key], f.kind)])),
  );
  const [mainImageId, setMainImageId] = useState<string | null>(item.main_image_id);
  const [note, setNote] = useState(item.review_note ?? '');
  const [saving, setSaving] = useState(false);

  /** Only fields that differ from the AI original are stored in corrected_json. */
  const buildCorrected = (): Partial<ExtractedProduct> => {
    const corrected: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) {
      const next = inputToField(values[f.key] ?? '', f.kind);
      const raw = item.raw_json[f.key] ?? (f.kind === 'list' ? [] : null);
      if (JSON.stringify(next) !== JSON.stringify(raw)) corrected[f.key] = next;
    }
    return corrected as Partial<ExtractedProduct>;
  };

  const save = async (status: ExtractionStatus) => {
    setSaving(true);
    const corrected = buildCorrected();
    try {
      await reviewExtractionItem({
        itemId: item.id,
        status,
        corrected,
        mainImageId: mainImageId !== item.main_image_id ? mainImageId : null,
        note,
      });
      onSaved({
        ...item,
        status,
        corrected_json: corrected,
        main_image_id: mainImageId,
        review_note: note.trim() || null,
      });
      toast.success(status === 'approved' ? '已修正並通過' : '已保存');
    } catch (err) {
      toast.error('保存失敗', { description: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      size="3xl"
      icon={<PencilLine className="h-6 w-6" />}
      title={
        <>
          修正提取結果
          <Button variant="link" size="sm" className="ml-2 h-auto p-0 text-xs font-normal" onClick={onOpenSource}>
            原文第 {item.page_no ?? '?'} 頁 <ExternalLink className="ml-1 h-3 w-3" />
          </Button>
        </>
      }
      description="只會儲存與 AI 原值不同的欄位；已審核的項目重新解析時會保留。"
      footer={
        <>
          <ModalButton disabled={saving} onClick={() => void save('approved')}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            保存並通過
          </ModalButton>
          <ModalButton variant="secondary" disabled={saving} onClick={() => void save(item.status)}>
            只保存
          </ModalButton>
          <ModalButton variant="ghost" disabled={saving} onClick={() => void save('rejected')}>
            拒絕
          </ModalButton>
        </>
      }
    >
      {item.raw_json.price_text && (
        <p className="text-xs text-muted-foreground">
          原文價格：<span className="font-mono">{item.raw_json.price_text}</span>
          {!item.raw_json.currency && docCurrency && ` · 未標幣種，沿用文件幣種 ${docCurrency}`}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {EDITABLE_FIELDS.map((f) => {
          const aiValue = fieldToInput(item.raw_json[f.key], f.kind);
          const changed = values[f.key] !== aiValue;
          const uncertain = item.raw_json.uncertain_fields?.includes(f.key);
          return (
            <div key={f.key} className={cn('space-y-1', f.key === 'description' && 'col-span-full')}>
              <Label className="flex items-center gap-1 text-xs">
                {f.label}
                {uncertain && <span className="text-amber-600">（AI 不確定）</span>}
                {(changed || isCorrected(item, f.key)) && <span className="text-sky-600">已修正</span>}
              </Label>
              {f.key === 'description' ? (
                <Textarea
                  rows={2}
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  type={f.kind === 'date' ? 'date' : 'text'}
                  inputMode={f.kind === 'number' ? 'decimal' : undefined}
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="h-8 text-sm"
                />
              )}
              {changed && (
                <div className="truncate text-[11px] text-muted-foreground">AI：{aiValue || '（空）'}</div>
              )}
            </div>
          );
        })}
      </div>

      {(item.raw_json.other_prices?.length ?? 0) > 0 && (
        <div className="text-xs">
          <div className="mb-1 font-medium">其他價格（AI）</div>
          <ul className="space-y-0.5 text-muted-foreground">
            {item.raw_json.other_prices!.map((op, i) => (
              <li key={i}>
                {op.label}：{op.price}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-medium">主圖</div>
        {images.length === 0 ? (
          <p className="text-xs text-muted-foreground">AI 未找到此產品的圖片</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setMainImageId(img.id)}
                className={cn(
                  'relative overflow-hidden rounded border-2',
                  mainImageId === img.id ? 'border-primary' : 'border-transparent',
                )}
                title={`第 ${img.page_no} 頁 · ${img.image_type}`}
              >
                <LoadingImage src={img.public_url} alt="" className="h-20 w-20 object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">審核備註</Label>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

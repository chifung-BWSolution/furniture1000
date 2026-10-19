import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoadingImage } from '@/components/ui/loading-image';
import { toast } from 'sonner';
import { Check, ExternalLink, ImageOff, Loader2, Lock, PackagePlus, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { canManageSupplierDocuments } from '@/lib/supplierDocuments';
import { importExtractedProducts } from '@/lib/productSearch';
import {
  EDITABLE_FIELDS,
  FLAG_LABELS,
  effectiveProduct,
  isCorrected,
  listExtractionImages,
  listExtractionItems,
  listReviewDocuments,
  openSourcePage,
  reviewExtractionItem,
  reviewExtractionItemsBatch,
  type ExtractedProduct,
  type ExtractionImage,
  type ExtractionItem,
  type ExtractionStatus,
  type ReviewDocument,
} from '@/lib/extractionReview';

type Filter = 'pending' | 'attention' | 'approved' | 'rejected' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: '待審核' },
  { id: 'attention', label: '需注意' },
  { id: 'approved', label: '已通過' },
  { id: 'rejected', label: '已拒絕' },
  { id: 'all', label: '全部' },
];

const STATUS_BADGE: Record<ExtractionStatus, { label: string; className: string }> = {
  pending: { label: '待審核', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  approved: { label: '已通過', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  rejected: { label: '已拒絕', className: 'bg-muted text-muted-foreground border-border' },
};

/** Flags that are informational only; everything else is shown as a warning. */
const INFO_FLAGS = new Set(['catalog_no_price', 'currency_from_document', 'ai_uncertain']);

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sizeText(p: ExtractedProduct): string {
  const dims = [p.width_mm, p.depth_mm, p.height_mm];
  if (dims.every((d) => d == null)) return p.dimensions_text ?? '—';
  return dims.map((d) => (d == null ? '?' : d)).join('×');
}

function priceText(p: ExtractedProduct, docCurrency: string | null): string {
  if (p.price == null) return '—';
  const cur = p.currency ?? docCurrency ?? '';
  return `${cur} ${p.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim();
}

function matchesFilter(item: ExtractionItem, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return item.status === 'pending' && item.needs_attention;
  return item.status === filter;
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

export function ExtractionReviewView() {
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<ReviewDocument[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [items, setItems] = useState<ExtractionItem[]>([]);
  const [images, setImages] = useState<ExtractionImage[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ExtractionItem | null>(null);
  const itemsRequestRef = useRef(0);

  const doc = docs.find((d) => d.id === docId) ?? null;
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
    try {
      const rows = await listReviewDocuments();
      setDocs(rows);
      setDocId((cur) => (cur && rows.some((d) => d.id === cur) ? cur : rows[0]?.id ?? null));
    } catch (err) {
      toast.error('讀取文件失敗', { description: errorText(err) });
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const reloadItems = useCallback(async (id: string) => {
    const requestId = ++itemsRequestRef.current;
    setLoadingItems(true);
    try {
      const [rows, imgs] = await Promise.all([listExtractionItems(id), listExtractionImages(id)]);
      if (requestId !== itemsRequestRef.current) return;
      setItems(rows);
      setImages(imgs);
    } catch (err) {
      if (requestId !== itemsRequestRef.current) return;
      toast.error('讀取提取結果失敗', { description: errorText(err) });
    } finally {
      if (requestId === itemsRequestRef.current) setLoadingItems(false);
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
      setLoadingItems(false);
      return;
    }
    // Drop the previous document immediately so approve/reject cannot hit its items.
    setItems([]);
    setImages([]);
    void reloadItems(docId);
  }, [docId, reloadItems]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesFilter(item, filter)) return false;
      if (!q) return true;
      const p = effectiveProduct(item);
      return [p.model, p.name, p.series].some((v) => v?.toLowerCase().includes(q));
    });
  }, [items, filter, query]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { pending: 0, attention: 0, approved: 0, rejected: 0, all: items.length };
    for (const item of items) {
      c[item.status] += 1;
      if (item.status === 'pending' && item.needs_attention) c.attention += 1;
    }
    return c;
  }, [items]);

  const selectable = visible.filter((i) => !i.imported_product_id);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));

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

  const applyLocal = (ids: string[], status: ExtractionStatus, patch?: Partial<ExtractionItem>) => {
    const set = new Set(ids);
    setItems((cur) => cur.map((i) => (set.has(i.id) ? { ...i, ...patch, status } : i)));
  };

  const refreshDocCounts = () => void listReviewDocuments().then(setDocs).catch(() => undefined);

  const handleBatch = async (status: ExtractionStatus) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const n = await reviewExtractionItemsBatch(ids, status);
      applyLocal(ids, status);
      setSelected(new Set());
      refreshDocCounts();
      toast.success(`${status === 'approved' ? '已通過' : status === 'rejected' ? '已拒絕' : '已退回待審'} ${n} 項`);
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
      refreshDocCounts();
    } catch (err) {
      toast.error('審核失敗', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const importable = items.filter((i) => i.status === 'approved' && !i.imported_product_id);

  const handleImport = async () => {
    if (!doc || importable.length === 0) return;
    setBusy(true);
    try {
      const res = await importExtractedProducts(doc.id);
      const missingModel = res.skipped.filter((s) => s.reason === 'missing_model').length;
      toast.success(`已匯入：新產品 ${res.created} 件、沿用既有產品 ${res.linked} 件、報價 ${res.prices} 條`, {
        description: missingModel > 0 ? `${missingModel} 項缺型號未匯入，請先修正型號` : undefined,
      });
      await reloadItems(doc.id);
      refreshDocCounts();
    } catch (err) {
      toast.error('匯入失敗', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenSource = async (page: number | null) => {
    if (!doc) return;
    try {
      await openSourcePage(doc.storage_path, page);
    } catch (err) {
      toast.error('無法開啟原文', { description: errorText(err) });
    }
  };

  if (canManage === null) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 檢查權限…
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
        <Lock className="mx-auto mb-3 h-6 w-6" />
        AI 提取結果含成本價，只限 admin／傢俬組查看。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      <aside className="flex w-72 shrink-0 flex-col rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">供應商文件</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void reloadDocs()} disabled={loadingDocs}>
            <RefreshCw className={cn('h-3.5 w-3.5', loadingDocs && 'animate-spin')} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {docs.length === 0 && !loadingDocs && (
            <p className="p-4 text-xs text-muted-foreground">
              未有 AI 提取結果。到「上載報價PDF」上載並解析供應商 PDF。
            </p>
          )}
          {docs.map((d) => {
            const pending = d.pending[0]?.count ?? 0;
            const total = d.total[0]?.count ?? 0;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDocId(d.id)}
                className={cn(
                  'w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-muted/60',
                  d.id === docId && 'bg-muted',
                )}
              >
                <div className="truncate font-medium">{d.factory_name || '未指定廠家'}</div>
                <div className="truncate text-xs text-muted-foreground">{d.title ?? '—'}</div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className={cn(pending > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                    {pending > 0 ? `${pending} 待審` : '已審完'}
                  </span>
                  <span className="text-muted-foreground">/ {total} 項</span>
                  <span className="text-muted-foreground">· {d.doc_type === 'catalog' ? '目錄' : '報價單'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border">
        {!doc ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">選擇左邊的文件</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <div className="mr-auto min-w-0">
                <div className="truncate text-sm font-medium">
                  {doc.factory_name} · {doc.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  文件幣種：{doc.currency ?? '未設定'} · {doc.page_count ?? '?'} 頁
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleOpenSource(null)}>
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> 原文 PDF
              </Button>
              <Button
                size="sm"
                disabled={busy || importable.length === 0}
                title="把已通過的項目寫入產品庫（型號＋廠家相同即沿用既有產品，只追加報價）"
                onClick={() => void handleImport()}
              >
                <PackagePlus className="mr-1 h-3.5 w-3.5" /> 匯入產品庫
                {importable.length > 0 && <span className="ml-1 opacity-80">{importable.length}</span>}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              {FILTERS.map((f) => (
                <Button
                  key={f.id}
                  size="sm"
                  variant={filter === f.id ? 'default' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setFilter(f.id);
                    setSelected(new Set());
                  }}
                >
                  {f.label} <span className="ml-1 opacity-70">{counts[f.id]}</span>
                </Button>
              ))}
              <div className="relative ml-auto w-48">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="型號／名稱"
                  className="h-7 pl-7 text-xs"
                />
              </div>
            </div>

            {selected.size > 0 && (
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
                <span>已選 {selected.size} 項</span>
                <Button size="sm" className="h-7" disabled={busy} onClick={() => void handleBatch('approved')}>
                  <Check className="mr-1 h-3.5 w-3.5" /> 批量通過
                </Button>
                <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void handleBatch('rejected')}>
                  <X className="mr-1 h-3.5 w-3.5" /> 批量拒絕
                </Button>
                <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => void handleBatch('pending')}>
                  退回待審
                </Button>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              {loadingItems ? (
                <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="w-8 px-3 py-2">
                        <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="全選" />
                      </th>
                      <th className="w-14 py-2" />
                      <th className="py-2 text-left font-medium">型號／名稱</th>
                      <th className="py-2 text-left font-medium">尺寸 (mm)</th>
                      <th className="py-2 text-right font-medium">成本價</th>
                      <th className="py-2 text-center font-medium">頁</th>
                      <th className="py-2 text-center font-medium">置信度</th>
                      <th className="py-2 text-left font-medium">標記</th>
                      <th className="py-2 text-left font-medium">狀態</th>
                      <th className="w-28 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => {
                      const p = effectiveProduct(item);
                      const main = item.main_image_id ? imageById.get(item.main_image_id) : undefined;
                      const locked = !!item.imported_product_id;
                      const conf = item.confidence ?? 0;
                      return (
                        <tr
                          key={item.id}
                          className={cn(
                            'border-b border-border/60 align-top hover:bg-muted/30',
                            item.status === 'pending' && item.needs_attention && 'bg-amber-500/5',
                          )}
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={selected.has(item.id)}
                              disabled={locked}
                              onCheckedChange={() => toggleOne(item.id)}
                              aria-label="選取"
                            />
                          </td>
                          <td className="py-2">
                            {main ? (
                              <LoadingImage src={main.public_url} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
                                <ImageOff className="h-4 w-4" />
                              </div>
                            )}
                          </td>
                          <td className="max-w-[16rem] py-2 pr-2">
                            <div className="font-medium">{p.model ?? <span className="text-destructive">缺型號</span>}</div>
                            <div className="truncate text-xs text-muted-foreground">{p.name}</div>
                          </td>
                          <td className="py-2 pr-2 text-xs">{sizeText(p)}</td>
                          <td className="py-2 pr-2 text-right text-xs tabular-nums">
                            {priceText(p, doc.currency)}
                            {(p.other_prices?.length ?? 0) > 0 && (
                              <div className="text-muted-foreground">+{p.other_prices!.length} 個價</div>
                            )}
                          </td>
                          <td className="py-2 text-center text-xs">
                            <button
                              type="button"
                              className="text-primary underline-offset-2 hover:underline"
                              onClick={() => void handleOpenSource(item.page_no)}
                            >
                              {item.page_no ?? '—'}
                            </button>
                          </td>
                          <td
                            className={cn(
                              'py-2 text-center text-xs tabular-nums',
                              conf < 0.7 ? 'text-destructive' : conf < 0.9 ? 'text-amber-600' : 'text-emerald-600',
                            )}
                          >
                            {Math.round(conf * 100)}%
                          </td>
                          <td className="max-w-[14rem] py-2 pr-2">
                            <div className="flex flex-wrap gap-1">
                              {item.flags.map((f) => (
                                <Badge
                                  key={f}
                                  variant="outline"
                                  className={cn(
                                    'px-1.5 py-0 text-[10px] font-normal',
                                    INFO_FLAGS.has(f)
                                      ? 'text-muted-foreground'
                                      : 'border-amber-500/40 text-amber-700',
                                  )}
                                >
                                  {FLAG_LABELS[f] ?? f}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="py-2 pr-2">
                            <Badge variant="outline" className={cn('text-[11px]', STATUS_BADGE[item.status].className)}>
                              {locked ? '已匯入' : STATUS_BADGE[item.status].label}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={locked}
                                title="修正"
                                onClick={() => setEditing(item)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-emerald-600"
                                disabled={locked || busy || item.status === 'approved'}
                                title="通過"
                                onClick={() => void handleSingle(item, 'approved')}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground"
                                disabled={locked || busy || item.status === 'rejected'}
                                title="拒絕"
                                onClick={() => void handleSingle(item, 'rejected')}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-12 text-center text-sm text-muted-foreground">
                          沒有符合條件的項目
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </section>

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
            refreshDocCounts();
          }}
        />
      )}
    </div>
  );
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            修正提取結果
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onOpenSource}>
              原文第 {item.page_no ?? '?'} 頁 <ExternalLink className="ml-1 h-3 w-3" />
            </Button>
          </DialogTitle>
        </DialogHeader>

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

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => void save('rejected')}>
            拒絕
          </Button>
          <Button variant="secondary" disabled={saving} onClick={() => void save(item.status)}>
            只保存
          </Button>
          <Button disabled={saving} onClick={() => void save('approved')}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            保存並通過
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CascadingCategorySelector, type CategorySelection } from '@/components/dashboard/CascadingCategorySelector';
import { fetchProductCategoryPairs, type ProductCategoryPair } from '@/lib/productCategoryOptions';
import {
  categoryLabel,
  decideDesignerCatalogItems,
  designerCatalogPdfUrl,
  listDesignerCatalogBatches,
  listDesignerCatalogItems,
  setDesignerCatalogCategory,
  updateDesignerCatalogItem,
  type DesignerBatchStatus,
  type DesignerCatalogBatch,
  type DesignerCatalogItem,
  type DesignerCatalogItemPatch,
} from '@/lib/designerCatalogReview';

type BatchFilter = 'pending' | 'partial' | 'approved' | 'rejected' | 'failed' | 'all';

const FILTERS: { id: BatchFilter; label: string }[] = [
  { id: 'pending', label: '待審' },
  { id: 'partial', label: '部分完成' },
  { id: 'approved', label: '已入庫' },
  { id: 'rejected', label: '已拒絕' },
  { id: 'failed', label: '失敗' },
  { id: 'all', label: '全部' },
];

const BATCH_LABEL: Record<DesignerBatchStatus, string> = {
  parsing: '解析中',
  pending: '待審核',
  partial: '部分完成',
  approved: '已全部入庫',
  rejected: '已全部拒絕',
  failed: '失敗',
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-HK', { hour12: false });
}

function selectorTree(pairs: ProductCategoryPair[]) {
  const built: { id: string; name: string; parent_id: string | null; level: number; sort_order: number }[] = [];
  const level1Ids = new Map<string, string>();
  let order = 0;
  for (const pair of pairs) {
    if (!level1Ids.has(pair.level1)) {
      const id = `L1::${pair.level1}`;
      level1Ids.set(pair.level1, id);
      built.push({ id, name: pair.level1, parent_id: null, level: 1, sort_order: order });
      order += 1;
    }
    if (pair.level2) {
      built.push({
        id: `L2::${pair.level1}::${pair.level2}`,
        name: pair.level2,
        parent_id: level1Ids.get(pair.level1) ?? null,
        level: 2,
        sort_order: order,
      });
      order += 1;
    }
  }
  return built;
}

function pairId(pairs: ProductCategoryPair[], selection: CategorySelection): string | null {
  const hits = pairs.filter((pair) => pair.level1 === selection.level1 && pair.level2 === selection.level2 && pair.id);
  return hits.length === 1 ? hits[0].id ?? null : null;
}

function matchesFilter(batch: DesignerCatalogBatch, filter: BatchFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'pending') return batch.status === 'pending' || batch.status === 'parsing';
  return batch.status === filter;
}

export function DesignerCatalogReviewView() {
  const [pairs, setPairs] = useState<ProductCategoryPair[]>([]);
  const [batches, setBatches] = useState<DesignerCatalogBatch[]>([]);
  const [filter, setFilter] = useState<BatchFilter>('pending');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [items, setItems] = useState<DesignerCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [reason, setReason] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');

  const tree = useMemo(() => selectorTree(pairs), [pairs]);
  const visibleBatches = batches.filter((batch) => matchesFilter(batch, filter));
  const batch = batches.find((row) => row.id === batchId) ?? null;
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const canApprove = selectedItems.length > 0 && selectedItems.every((item) => item.status === 'pending' && item.product_category_id);

  const reloadBatches = useCallback(async () => {
    const next = await listDesignerCatalogBatches();
    setBatches(next);
    setBatchId((current) => current ?? next.find((row) => row.status === 'pending' || row.status === 'parsing')?.id ?? next[0]?.id ?? null);
  }, []);

  const reloadItems = useCallback(async (id: string) => {
    setLoadingItems(true);
    try {
      const next = await listDesignerCatalogItems(id);
      setItems(next);
      setSelected([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchProductCategoryPairs(), reloadBatches()])
      .then(([nextPairs]) => {
        if (!cancelled) setPairs(nextPairs);
      })
      .catch((err) => {
        if (!cancelled) toast.error('讀取待審目錄失敗', { description: errorText(err) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadBatches]);

  useEffect(() => {
    if (!batchId) {
      setItems([]);
      return;
    }
    reloadItems(batchId).catch((err) => toast.error('讀取產品失敗', { description: errorText(err) }));
  }, [batchId, reloadItems]);

  const refresh = async () => {
    await reloadBatches();
    if (batchId) await reloadItems(batchId);
  };

  const runDecide = async (ids: string[], decision: 'approve' | 'reject', note?: string) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const result = await decideDesignerCatalogItems(ids, decision, note);
      if (decision === 'approve') {
        toast.success(`已入庫 ${result.approved} 件`, {
          description: result.blocked ? `${result.blocked} 件未處理（未分類或已審過）` : undefined,
        });
      } else {
        toast.success(`已拒絕 ${result.rejected} 件`);
      }
      setRejectIds(null);
      setReason('');
      await refresh();
    } catch (err) {
      toast.error('審核失敗', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const applyBulkCategory = async (selection: CategorySelection) => {
    const id = pairId(pairs, selection);
    setBulkCategory(selection.level2 || selection.level1);
    if (!id) {
      toast.error('這個分類不在現有產品分類裡');
      return;
    }
    const pendingIds = selectedItems.filter((item) => item.status === 'pending').map((item) => item.id);
    if (pendingIds.length === 0) return;
    setBusy(true);
    try {
      const updated = await setDesignerCatalogCategory(pendingIds, id);
      toast.success(`已設定 ${updated} 件產品的分類`);
      await reloadItems(batchId!);
    } catch (err) {
      toast.error('設定分類失敗', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div>
        <h1 className="text-lg font-semibold">設計師目錄審核</h1>
        <p className="text-xs text-muted-foreground">
          設計師上載的目錄停在這裡。通過後才寫入產品庫；拒絕的產品會保留，並記下原因。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={filter === entry.id ? 'default' : 'outline'}
            className="h-8"
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="min-h-0 space-y-2 overflow-y-auto">
            {visibleBatches.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">沒有符合的批次</p>
            ) : visibleBatches.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setBatchId(row.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs ${row.id === batchId ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <div className="font-medium">{row.factory_name}</div>
                <div className="truncate text-muted-foreground">{row.file_name}</div>
                <div className="mt-1 text-muted-foreground">
                  {row.uploader_name || row.uploader_email || '設計師'} · {formatTime(row.created_at)}
                </div>
                <div className="mt-1">
                  {BATCH_LABEL[row.status]} · 待審 {row.pending_count} / {row.item_count}
                </div>
              </button>
            ))}
          </div>

          <div className="min-h-0 overflow-y-auto rounded-md border border-border">
            {!batch ? (
              <p className="p-6 text-sm text-muted-foreground">選擇左邊的批次。</p>
            ) : (
              <div className="space-y-3 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{batch.factory_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {batch.file_name} · {formatTime(batch.created_at)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      designerCatalogPdfUrl(batch.storage_path)
                        .then((url) => window.open(url, '_blank', 'noopener'))
                        .catch((err) => toast.error('無法開啟 PDF', { description: errorText(err) }));
                    }}
                  >
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    原始 PDF
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox
                    checked={items.length > 0 && selected.length === items.length}
                    onCheckedChange={(checked) => setSelected(checked ? items.map((item) => item.id) : [])}
                  />
                  <span className="text-xs text-muted-foreground">已選 {selected.length}</span>
                  <div className="min-w-[14rem]">
                    <CascadingCategorySelector
                      categories={tree}
                      value={bulkCategory}
                      placeholder="設定已選產品的分類"
                      onSelectionChange={(selection) => { void applyBulkCategory(selection); }}
                    />
                  </div>
                  <Button size="sm" disabled={busy || !canApprove} onClick={() => runDecide(selected, 'approve')}>
                    通過已選
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || selectedItems.every((item) => item.status !== 'pending')}
                    onClick={() => {
                      setReason('');
                      setRejectIds(selectedItems.filter((item) => item.status === 'pending').map((item) => item.id));
                    }}
                  >
                    拒絕已選
                  </Button>
                </div>
                {loadingItems ? (
                  <p className="text-sm text-muted-foreground">載入產品…</p>
                ) : items.map((item) => (
                  <ItemCard
                    key={`${item.id}-${item.status}-${item.product_category_id ?? ''}`}
                    item={item}
                    pairs={pairs}
                    tree={tree}
                    checked={selected.includes(item.id)}
                    disabled={busy}
                    onChecked={(checked) => {
                      setSelected((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id));
                    }}
                    onSave={async (patch) => {
                      await updateDesignerCatalogItem(item.id, patch);
                      await reloadItems(item.batch_id);
                    }}
                    onApprove={() => runDecide([item.id], 'approve')}
                    onReject={() => {
                      setReason('');
                      setRejectIds([item.id]);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={rejectIds !== null} onOpenChange={(open) => { if (!open) setRejectIds(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒絕產品</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="請填寫拒絕原因。這段文字會保留給上載的設計師查看。"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectIds(null)}>取消</Button>
            <Button
              disabled={busy || !reason.trim() || !rejectIds?.length}
              onClick={() => rejectIds && runDecide(rejectIds, 'reject', reason.trim())}
            >
              確認拒絕
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemCard({
  item,
  pairs,
  tree,
  checked,
  disabled,
  onChecked,
  onSave,
  onApprove,
  onReject,
}: {
  item: DesignerCatalogItem;
  pairs: ProductCategoryPair[];
  tree: ReturnType<typeof selectorTree>;
  checked: boolean;
  disabled: boolean;
  onChecked: (checked: boolean) => void;
  onSave: (patch: DesignerCatalogItemPatch) => Promise<void>;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const [saving, setSaving] = useState(false);
  const pending = item.status === 'pending';
  const displayCategory = draft.level2_category || draft.level1_category || '';

  const save = async (silent = false) => {
    setSaving(true);
    try {
      await onSave({
        title: draft.title,
        description: draft.description,
        model_number: draft.model_number,
        material: draft.material,
        color: draft.color,
        dimensions_text: draft.dimensions_text,
        width_mm: draft.width_mm,
        depth_mm: draft.depth_mm,
        height_mm: draft.height_mm,
        price: draft.price,
        currency: draft.currency,
        product_category_id: draft.product_category_id,
      });
      if (!silent) toast.success('已儲存');
      return true;
    } catch (err) {
      toast.error('儲存失敗', { description: errorText(err) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`rounded-md border p-3 ${item.product_category_id ? 'border-border' : 'border-destructive'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Checkbox checked={checked} onCheckedChange={(value) => onChecked(value === true)} />
        {item.image_url && (
          <img src={item.image_url} alt={item.title} className="h-14 w-14 rounded object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{item.title}</div>
          <div className="text-xs text-muted-foreground">
            {item.status === 'pending' ? '待審核' : item.status === 'approved' ? '已入庫' : '已拒絕'}
            {item.page_no ? ` · 第 ${item.page_no} 頁` : ''}
            {!draft.product_category_id && ' · 未分類'}
          </div>
        </div>
        {pending && (
          <>
            <Button size="sm" variant="outline" disabled={disabled || saving} onClick={() => { void save(); }}>儲存</Button>
            <Button
              size="sm"
              disabled={disabled || saving || !draft.product_category_id}
              onClick={async () => {
                if (await save(true)) onApprove();
              }}
            >
              通過
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || saving} onClick={onReject}>拒絕</Button>
          </>
        )}
      </div>
      {item.rejection_reason && <p className="mb-2 text-xs text-destructive">原因：{item.rejection_reason}</p>}
      {pending ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="名稱" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
          <Field label="型號" value={draft.model_number} onChange={(model_number) => setDraft({ ...draft, model_number })} />
          <Field label="材質" value={draft.material} onChange={(material) => setDraft({ ...draft, material })} />
          <Field label="顏色" value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
          <Field label="尺寸文字" value={draft.dimensions_text} onChange={(dimensions_text) => setDraft({ ...draft, dimensions_text })} />
          <NumberField label="價格" value={draft.price} onChange={(price) => setDraft({ ...draft, price })} />
          <NumberField label="闊 mm" value={draft.width_mm} onChange={(width_mm) => setDraft({ ...draft, width_mm })} />
          <NumberField label="深 mm" value={draft.depth_mm} onChange={(depth_mm) => setDraft({ ...draft, depth_mm })} />
          <NumberField label="高 mm" value={draft.height_mm} onChange={(height_mm) => setDraft({ ...draft, height_mm })} />
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="text-muted-foreground">產品分類</span>
            <CascadingCategorySelector
              categories={tree}
              value={displayCategory}
              placeholder="選擇現有分類"
              showClear
              onValueChange={(value) => {
                if (!value) setDraft({ ...draft, product_category_id: null, level1_category: null, level2_category: null });
              }}
              onSelectionChange={(selection) => {
                const id = pairId(pairs, selection);
                setDraft({
                  ...draft,
                  product_category_id: id,
                  level1_category: id ? selection.level1 : null,
                  level2_category: id ? selection.level2 || null : null,
                });
              }}
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="text-muted-foreground">描述</span>
            <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {[item.model_number, item.material, categoryLabel(item) || '未分類'].filter(Boolean).join(' · ')}
        </p>
      )}
    </article>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        value={value ?? ''}
        inputMode="decimal"
        onChange={(event) => {
          const text = event.target.value.trim();
          if (!text) {
            onChange(null);
            return;
          }
          const number = Number(text);
          onChange(Number.isFinite(number) ? number : null);
        }}
      />
    </label>
  );
}

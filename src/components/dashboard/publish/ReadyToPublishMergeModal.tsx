import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  Check, ChevronLeft, ChevronRight, GripVertical, Loader2, Package, Plus, Search, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { Product } from '@/types/product';
import {
  assignDuplicateMergeSkus,
  dedupeImageUrls,
  dedupeImageUrlsPreserveOrder,
  imageDedupeKey,
  isHttpUrl,
} from '@/lib/productMergeImages';

interface RtsVariant {
  id?: string;
  sku?: string;
  price?: string | number;
  option1?: string;
  inventory_quantity?: number;
  image_src?: string;
}

interface RtsProductRow {
  id: string;
  product_id: string;
  title: string | null;
  vendor: string | null;
  image_url: string | null;
  image_url_2?: string | null;
  image_url_3?: string | null;
  images?: { src?: string }[] | null;
  variants?: RtsVariant[] | null;
  price: number | null;
  sku?: string | null;
  dimension_l_mm?: number | null;
  dimension_w_mm?: number | null;
  dimension_h_mm?: number | null;
}

export interface RtsMergeVariantRow {
  key: string;
  rts_id: string;
  product_id: string;
  sku: string;
  price: number;
  size: string;
  option1: string;
  inventory: number;
  imageSrc: string | null;
}

const PICKER_PAGE_SIZE = 25;
const ROW_DRAG_MIME = 'application/x-rts-merge-row-key';

const RTS_SELECT =
  'id, product_id, title, vendor, image_url, image_url_2, image_url_3, images, variants, price, sku, dimension_l_mm, dimension_w_mm, dimension_h_mm';

function resolveSize(row: RtsProductRow, variant?: RtsVariant): string {
  const dims = [row.dimension_l_mm, row.dimension_w_mm, row.dimension_h_mm]
    .filter((n) => n != null)
    .join('x');
  if (dims) return dims;
  const opt = (variant?.option1 || '').trim();
  if (opt) return opt;
  return 'Default Title';
}

function resolveSku(row: RtsProductRow, variant?: RtsVariant): string {
  const vSku = (variant?.sku || '').trim();
  if (vSku) return vSku;
  return (row.sku || '').trim();
}

function resolvePrice(row: RtsProductRow, variant?: RtsVariant): number {
  const vp = variant?.price;
  if (vp != null && vp !== '') {
    const n = typeof vp === 'string' ? parseFloat(vp) : vp;
    if (Number.isFinite(n)) return n;
  }
  if (row.price != null && Number.isFinite(Number(row.price))) return Number(row.price);
  return 0;
}

/** Identity for picker dedupe — only same SKU *and* same size are hidden. */
function mergeVariantIdentityKey(sku: string, size: string): string {
  return `${sku.trim().toLowerCase()}|${size.trim().toLowerCase()}`;
}

function pickableRowsFromRtsProduct(
  row: RtsProductRow,
  addedVariantKeys: Set<string>,
): RtsMergeVariantRow[] {
  return rowsFromRtsProduct(row).filter(
    (variantRow) => !addedVariantKeys.has(mergeVariantIdentityKey(variantRow.sku, variantRow.size)),
  );
}

function isPickableRtsProduct(
  row: RtsProductRow,
  hostRtsId: string,
  addedVariantKeys: Set<string>,
): boolean {
  if (row.id === hostRtsId) return false;
  return pickableRowsFromRtsProduct(row, addedVariantKeys).length > 0;
}

function collectRtsImageUrls(row: RtsProductRow): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (url: string | null | undefined) => {
    if (!isHttpUrl(url)) return;
    const key = imageDedupeKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(url);
  };
  add(row.image_url);
  add(row.image_url_2);
  add(row.image_url_3);
  for (const im of row.images ?? []) add(im?.src);
  return out;
}

function resolveRtsVariantImageSrc(row: RtsProductRow, variant?: RtsVariant): string | null {
  if (isHttpUrl(variant?.image_src)) return variant!.image_src!;
  return collectRtsImageUrls(row)[0] ?? null;
}

function rowsFromRtsProduct(row: RtsProductRow): RtsMergeVariantRow[] {
  const variants = Array.isArray(row.variants) && row.variants.length > 0
    ? row.variants
    : [undefined];
  return variants.map((v, idx) => {
    const size = resolveSize(row, v);
    return {
      key: `${row.id}-${v?.id ?? idx}`,
      rts_id: row.id,
      product_id: row.product_id,
      sku: resolveSku(row, v),
      price: resolvePrice(row, v),
      size,
      option1: (v?.option1 || size).trim(),
      inventory: v?.inventory_quantity ?? 100,
      imageSrc: resolveRtsVariantImageSrc(row, v),
    };
  });
}

function buildGalleryFromRtsProducts(
  productOrder: string[],
  productByRtsId: Map<string, RtsProductRow>,
): string[] {
  const urls: string[] = [];
  for (const rtsId of productOrder) {
    const product = productByRtsId.get(rtsId);
    if (!product) continue;
    urls.push(...collectRtsImageUrls(product));
  }
  return dedupeImageUrls(urls);
}

function appendRtsProductImages(prev: string[], product: RtsProductRow): string[] {
  return dedupeImageUrls([...prev, ...collectRtsImageUrls(product)]);
}

function MergeVariantRowView({
  row,
  isHost,
  dragOver,
  rowDropTarget,
  rowDragging,
  onRowDragStart,
  onRowDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
  onDragOver,
  onDragLeave,
  onImageDrop,
  onUpdate,
  onDelete,
}: {
  row: RtsMergeVariantRow;
  isHost?: boolean;
  dragOver?: boolean;
  rowDropTarget?: boolean;
  rowDragging?: boolean;
  onRowDragStart: (e: DragEvent) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (e: DragEvent) => void;
  onRowDragLeave: () => void;
  onRowDrop: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onImageDrop: (e: DragEvent) => void;
  onUpdate: (updates: Partial<RtsMergeVariantRow>) => void;
  onDelete: () => void;
}) {
  return (
    <div
      onDragOver={onRowDragOver}
      onDragLeave={onRowDragLeave}
      onDrop={onRowDrop}
      className={cn(
        'rounded-lg border p-3 transition-colors',
        isHost ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30',
        rowDropTarget && 'ring-2 ring-primary/40',
        rowDragging && 'opacity-50',
      )}
    >
      {isHost && (
        <div className="mb-2 flex items-center gap-1.5">
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-body text-[10px] font-semibold text-primary">主產品</span>
          <span className="font-body text-[10px] text-muted-foreground">此為上傳到 Shopify 的主體產品（第一行）</span>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          draggable
          onDragStart={onRowDragStart}
          onDragEnd={onRowDragEnd}
          className="mt-5 flex h-16 w-6 shrink-0 cursor-grab items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground hover:bg-muted active:cursor-grabbing"
          title="拖曳調整順序（第一行為主產品）"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="shrink-0 space-y-1">
          <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
            產品主圖
          </label>
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onImageDrop}
            className={cn(
              'flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border-2 border-dashed bg-background transition-colors',
              dragOver ? 'border-primary bg-primary/10' : 'border-border',
            )}
          >
            {row.imageSrc ? (
              <img src={row.imageSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package className="h-5 w-5 text-muted-foreground/40" />
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1 grid grid-cols-6 gap-2">
          <div className="space-y-1">
            <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">ID</label>
            <Input
              value={row.rts_id.slice(-8)}
              readOnly
              className="h-7 text-xs font-mono-data bg-muted/50"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">SKU</label>
            <Input
              value={row.sku}
              onChange={(e) => onUpdate({ sku: e.target.value })}
              className="h-7 text-xs font-mono-data bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">售價</label>
            <Input
              type="number"
              step="0.01"
              value={row.price}
              onChange={(e) => onUpdate({ price: parseFloat(e.target.value) || 0 })}
              className="h-7 text-xs font-mono-data bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">尺寸</label>
            <Input
              value={row.size}
              onChange={(e) => onUpdate({ size: e.target.value, option1: e.target.value })}
              className="h-7 text-xs font-mono-data bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">Option1</label>
            <Input
              value={row.option1}
              onChange={(e) => onUpdate({ option1: e.target.value, size: e.target.value })}
              className="h-7 text-xs font-mono-data bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">庫存</label>
            <Input
              type="number"
              value={row.inventory}
              onChange={(e) => onUpdate({ inventory: parseInt(e.target.value, 10) || 0 })}
              className="h-7 text-xs font-mono-data bg-background"
            />
          </div>
        </div>
      </div>
      {!isHost && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-body text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
            移除
          </button>
        </div>
      )}
    </div>
  );
}

export function ReadyToPublishMergeModal({
  product,
  open,
  onOpenChange,
  onSaved,
}: {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<RtsMergeVariantRow[]>([]);
  const [productCache, setProductCache] = useState<Map<string, RtsProductRow>>(new Map());
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerFactory, setPickerFactory] = useState('');
  const [pickerPage, setPickerPage] = useState(0);
  const [pickerTotal, setPickerTotal] = useState(0);
  const [pickerRows, setPickerRows] = useState<RtsProductRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerFactories, setPickerFactories] = useState<string[]>([]);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [rowDropTargetKey, setRowDropTargetKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const hostRow = rows[0] ?? null;
  const hostRtsId = hostRow?.rts_id ?? product?.id ?? '';
  const hostTitle = productCache.get(hostRtsId)?.title ?? product?.title ?? '';

  const loadMergeState = useCallback(async () => {
    if (!product) return;
    setLoading(true);
    try {
      const hostRtsId = product.id;
      const { data: hostRow, error: hostErr } = await supabase
        .from('ready_to_shopify')
        .select(RTS_SELECT)
        .eq('id', hostRtsId)
        .maybeSingle();
      if (hostErr || !hostRow) {
        toast.error('讀取產品失敗', { description: hostErr?.message });
        return;
      }

      const host = hostRow as RtsProductRow;
      const cache = new Map<string, RtsProductRow>();
      cache.set(host.id, host);

      const mergedRtsIds = (Array.isArray(host.variants) ? host.variants : [])
        .map((v) => String(v.id ?? ''))
        .filter((id) => id && id !== host.id);

      if (mergedRtsIds.length > 0) {
        const { data: subRows } = await supabase
          .from('ready_to_shopify')
          .select(RTS_SELECT)
          .in('id', mergedRtsIds);
        for (const sub of (subRows ?? []) as RtsProductRow[]) {
          cache.set(sub.id, sub);
        }
      }

      const order: string[] = [host.id];
      for (const rtsId of mergedRtsIds) {
        if (!order.includes(rtsId)) order.push(rtsId);
      }

      const allRows: RtsMergeVariantRow[] = [];
      if (Array.isArray(host.variants) && host.variants.length > 0) {
        for (const v of host.variants) {
          const rtsId = String(v.id ?? host.id);
          const srcRow = cache.get(rtsId) ?? host;
          const size = (v.option1 || resolveSize(srcRow, v)).trim();
          allRows.push({
            key: `${rtsId}-${v.sku ?? size}`,
            rts_id: rtsId,
            product_id: srcRow.product_id,
            sku: (v.sku || resolveSku(srcRow, v)).trim(),
            price: resolvePrice(srcRow, { ...v, price: v.price }),
            size,
            option1: size,
            inventory: v.inventory_quantity ?? 100,
            imageSrc: isHttpUrl(v.image_src) ? v.image_src! : resolveRtsVariantImageSrc(srcRow, v),
          });
        }
      } else {
        allRows.push(...rowsFromRtsProduct(host));
      }

      setRows(assignDuplicateMergeSkus(allRows));
      setProductCache(cache);
      setGalleryUrls(buildGalleryFromRtsProducts(order, cache));
    } finally {
      setLoading(false);
    }
  }, [product]);

  useEffect(() => {
    if (!open || !product) return;
    setShowPicker(false);
    setPickerSearch('');
    setPickerFactory('');
    setPickerPage(0);
    void loadMergeState();
  }, [open, product, loadMergeState]);

  const addedVariantKeys = useMemo(
    () => new Set(rows.map((r) => mergeVariantIdentityKey(r.sku, r.size))),
    [rows],
  );

  const visiblePickerRows = useMemo(
    () => pickerRows.filter((p) => isPickableRtsProduct(p, hostRtsId, addedVariantKeys)),
    [pickerRows, hostRtsId, addedVariantKeys],
  );

  const loadPicker = useCallback(async () => {
    if (!showPicker || !hostRtsId) return;
    setPickerLoading(true);
    try {
      const from = pickerPage * PICKER_PAGE_SIZE;
      const to = from + PICKER_PAGE_SIZE - 1;

      let q = supabase
        .from('ready_to_shopify')
        .select(RTS_SELECT, { count: 'exact' })
        .eq('furniture_group_checked', true)
        .is('configurable', null)
        .neq('id', hostRtsId)
        .order('title', { ascending: true })
        .range(from, to);

      const term = pickerSearch.trim();
      if (term) {
        q = q.or(`title.ilike.%${term}%,sku.ilike.%${term}%`);
      }
      if (pickerFactory) {
        q = q.eq('vendor', pickerFactory);
      }

      const { data, error, count } = await q;
      if (error) {
        toast.error('讀取產品列表失敗', { description: error.message });
        setPickerRows([]);
        setPickerTotal(0);
        return;
      }
      setPickerRows((data ?? []) as RtsProductRow[]);
      setPickerTotal(count ?? 0);

      if (pickerFactories.length === 0) {
        const { data: vendorRows } = await supabase
          .from('ready_to_shopify')
          .select('vendor')
          .eq('furniture_group_checked', true)
          .is('configurable', null)
          .not('vendor', 'is', null);
        const vendors = [...new Set((vendorRows ?? []).map((r) => String(r.vendor).trim()).filter(Boolean))].sort();
        setPickerFactories(vendors);
      }
    } finally {
      setPickerLoading(false);
    }
  }, [showPicker, hostRtsId, pickerPage, pickerSearch, pickerFactory, pickerFactories.length]);

  useEffect(() => {
    void loadPicker();
  }, [loadPicker]);

  const totalPickerPages = Math.max(1, Math.ceil(pickerTotal / PICKER_PAGE_SIZE));

  const handleGalleryDragStart = (e: DragEvent, url: string) => {
    e.dataTransfer.setData('text/uri-list', url);
    e.dataTransfer.setData('text/plain', url);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleRowDrop = (key: string, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverKey(null);
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!isHttpUrl(url)) return;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, imageSrc: url } : r)));
  };

  const handleRowReorderStart = (key: string, e: DragEvent) => {
    e.dataTransfer.setData(ROW_DRAG_MIME, key);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingRowKey(key);
  };

  const handleRowReorderOver = (key: string, e: DragEvent) => {
    if (!e.dataTransfer.types.includes(ROW_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setRowDropTargetKey(key);
  };

  const handleRowReorderDrop = (targetKey: string, e: DragEvent) => {
    if (!e.dataTransfer.types.includes(ROW_DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    const sourceKey = e.dataTransfer.getData(ROW_DRAG_MIME);
    setDraggingRowKey(null);
    setRowDropTargetKey(null);
    if (!sourceKey || sourceKey === targetKey) return;
    setRows((prev) => {
      const fromIdx = prev.findIndex((r) => r.key === sourceKey);
      const toIdx = prev.findIndex((r) => r.key === targetKey);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return assignDuplicateMergeSkus(next);
    });
  };

  const removeVariantRow = (key: string) => {
    setRows((prev) => {
      const row = prev.find((r) => r.key === key);
      if (!row) return prev;
      const next = assignDuplicateMergeSkus(prev.filter((r) => r.key !== key));
      const stillHasProduct = next.some((r) => r.rts_id === row.rts_id);
      if (!stillHasProduct) {
        setProductCache((cache) => {
          const rtsProduct = cache.get(row.rts_id);
          if (rtsProduct) {
            const urlsToRemove = new Set(collectRtsImageUrls(rtsProduct));
            setGalleryUrls((g) => g.filter((u) => !urlsToRemove.has(u)));
            const nextCache = new Map(cache);
            nextCache.delete(row.rts_id);
            return nextCache;
          }
          return cache;
        });
      }
      return next;
    });
  };

  const removeGalleryImage = (url: string) => {
    setGalleryUrls((prev) => prev.filter((u) => u !== url));
    setRows((prev) => prev.map((r) => (r.imageSrc === url ? { ...r, imageSrc: null } : r)));
  };

  const addProduct = (rtsProduct: RtsProductRow) => {
    const newRows = pickableRowsFromRtsProduct(rtsProduct, addedVariantKeys);
    if (newRows.length === 0) {
      toast.error('此規格已在變體列表中');
      return;
    }
    setProductCache((prev) => {
      const next = new Map(prev);
      next.set(rtsProduct.id, rtsProduct);
      return next;
    });
    setGalleryUrls((prev) => appendRtsProductImages(prev, rtsProduct));
    setRows((prev) => assignDuplicateMergeSkus([...prev, ...newRows]));
    setShowPicker(false);
    setPickerSearch('');
    setPickerFactory('');
    setPickerPage(0);
  };

  const handleComplete = async () => {
    if (!hostRow || !product) return;
    if (rows.length < 1) {
      toast.error('至少需要 1 個規格');
      return;
    }
    const hostProductId = hostRow.product_id;
    const hostRtsId = hostRow.rts_id;
    const parentSku = hostRow.sku.trim();
    if (!parentSku) {
      toast.error('主產品 SKU 不可為空');
      return;
    }
    for (const r of rows) {
      if (!r.sku.trim() || !r.option1.trim()) {
        toast.error('每個規格都需要 SKU 與 Option1');
        return;
      }
    }

    setIsSaving(true);
    const toastId = toast.loading('正在儲存變體合併…');
    try {
      const dedupedGallery = dedupeImageUrlsPreserveOrder(galleryUrls);
      const primary = dedupedGallery[0] || null;

      const shopifyVariants = rows.map((r) => {
        let imageSrc = r.imageSrc || undefined;
        if (imageSrc && primary && imageDedupeKey(imageSrc) === imageDedupeKey(primary)) {
          imageSrc = primary;
        }
        return {
          id: r.rts_id,
          sku: r.sku.trim(),
          price: r.price,
          title: r.option1 || r.size,
          option1: r.option1 || r.size,
          option2: null,
          compare_at_price: null,
          inventory_quantity: r.inventory ?? 100,
          image_src: imageSrc || null,
        };
      });

      const minPrice = Math.min(...rows.map((r) => r.price));

      const { data: existingRow } = await supabase
        .from('ready_to_shopify')
        .select('variants')
        .eq('product_id', hostProductId)
        .maybeSingle();
      const prevMergedRtsIds: string[] = Array.isArray(existingRow?.variants)
        ? (existingRow!.variants as RtsVariant[])
            .map((v) => String(v.id ?? ''))
            .filter((id) => id && id !== hostRtsId)
        : [];

      const currentMergedRtsIds = rows
        .filter((r) => r.rts_id !== hostRtsId)
        .map((r) => r.rts_id);

      const { error } = await supabase
        .from('ready_to_shopify')
        .update({
          variants: shopifyVariants,
          sku: parentSku,
          price: minPrice,
          image_url: primary,
          image_url_2: dedupedGallery[1] || null,
          image_url_3: dedupedGallery[2] || null,
          images: dedupedGallery.length > 0
            ? dedupedGallery.map((src, i) => ({ src, position: i + 1 }))
            : null,
          configurable: null,
        })
        .eq('product_id', hostProductId);

      if (error) {
        toast.error('儲存失敗', { id: toastId, description: error.message });
        return;
      }

      if (currentMergedRtsIds.length > 0) {
        await supabase
          .from('ready_to_shopify')
          .update({ furniture_group_checked: null, configurable: parentSku })
          .in('id', currentMergedRtsIds);
      }

      const restoredRtsIds = prevMergedRtsIds.filter((id) => !currentMergedRtsIds.includes(id));
      if (restoredRtsIds.length > 0) {
        await supabase
          .from('ready_to_shopify')
          .update({ furniture_group_checked: true, variants: [], configurable: null })
          .in('id', restoredRtsIds);
      }

      const descParts: string[] = [`已儲存 ${rows.length} 個變體`];
      if (currentMergedRtsIds.length > 0) descParts.push(`${currentMergedRtsIds.length} 件已合併`);
      if (restoredRtsIds.length > 0) descParts.push(`${restoredRtsIds.length} 件已還原為單獨產品`);
      toast.success('變體已儲存', { id: toastId, description: descParts.join('，'), duration: 6000 });
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error('儲存失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isSaving) onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between pr-6">
            <div>
              <DialogTitle className="font-display">
                變體 — {hostTitle}
              </DialogTitle>
              <DialogDescription className="font-body text-xs">
                拖曳左側握把調整順序（第一行為主產品）。相同 SKU 會按售價由低至高自動編號（最低保留原 SKU，其餘為 -1、-2…）；不同 SKU 則維持不變。拖曳縮圖至各規格「產品主圖」。
              </DialogDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-1.5 font-display text-xs"
              disabled={isSaving || loading || rows.length < 1}
              onClick={() => void handleComplete()}
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              完成
            </Button>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            {galleryUrls.length > 0 && (
              <div className="mt-2 space-y-2">
                <p className="font-body text-[10px] text-muted-foreground">
                  拖曳縮圖至下方各規格的「產品主圖」；點擊縮圖可在新視窗查看原圖。第一張為 Shopify 主圖。
                </p>
                <div className="grid grid-cols-6 gap-2">
                  {galleryUrls.map((url, idx) => (
                    <div key={url} className="flex flex-col items-center gap-0.5">
                      {idx === 0 ? (
                        <span className="font-body text-[9px] font-semibold text-primary leading-none">
                          Shopify主圖
                        </span>
                      ) : (
                        <span className="h-[13px]" aria-hidden />
                      )}
                      <div className="relative aspect-square w-full">
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => handleGalleryDragStart(e, url)}
                          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                          className="h-full w-full overflow-hidden rounded-md border border-border bg-muted/30 hover:ring-2 hover:ring-primary/40 transition-shadow cursor-grab active:cursor-grabbing"
                          title="拖曳至規格主圖，或點擊放大"
                        >
                          <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeGalleryImage(url);
                          }}
                          className="absolute top-0.5 right-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white hover:bg-destructive transition-colors"
                          title="移除此圖片"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 mt-2">
              {rows.map((row, idx) => (
                <MergeVariantRowView
                  key={row.key}
                  row={row}
                  isHost={idx === 0}
                  dragOver={dragOverKey === row.key}
                  rowDropTarget={rowDropTargetKey === row.key}
                  rowDragging={draggingRowKey === row.key}
                  onRowDragStart={(e) => handleRowReorderStart(row.key, e)}
                  onRowDragEnd={() => {
                    setDraggingRowKey(null);
                    setRowDropTargetKey(null);
                  }}
                  onRowDragOver={(e) => handleRowReorderOver(row.key, e)}
                  onRowDragLeave={() => {
                    if (rowDropTargetKey === row.key) setRowDropTargetKey(null);
                  }}
                  onRowDrop={(e) => handleRowReorderDrop(row.key, e)}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(ROW_DRAG_MIME)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setDragOverKey(row.key);
                  }}
                  onDragLeave={() => setDragOverKey(null)}
                  onImageDrop={(e) => handleRowDrop(row.key, e)}
                  onUpdate={(updates) => {
                    setRows((prev) => {
                      const next = prev.map((r) => (r.key === row.key ? { ...r, ...updates } : r));
                      return assignDuplicateMergeSkus(next);
                    });
                  }}
                  onDelete={() => removeVariantRow(row.key)}
                />
              ))}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowPicker(true);
                  setPickerSearch('');
                  setPickerFactory('');
                  setPickerPage(0);
                }}
                className="gap-1.5 text-xs font-body"
              >
                <Plus className="h-3 w-3" />
                加入產品
              </Button>
            </div>

            {showPicker && (
              <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-semibold">選擇產品</span>
                  <button
                    type="button"
                    onClick={() => setShowPicker(false)}
                    className="rounded p-1 hover:bg-accent text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                    <Input
                      value={pickerSearch}
                      onChange={(e) => { setPickerSearch(e.target.value); setPickerPage(0); }}
                      placeholder="搜尋產品名稱或 SKU…"
                      className="pl-8 h-8 text-xs font-body"
                    />
                  </div>
                  <select
                    value={pickerFactory}
                    onChange={(e) => { setPickerFactory(e.target.value); setPickerPage(0); }}
                    className="rounded-md border border-border bg-background px-2 py-1 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 h-8"
                  >
                    <option value="">所有廠家</option>
                    {pickerFactories.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>

                {pickerLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {visiblePickerRows.length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted-foreground font-body">找不到產品</div>
                    ) : visiblePickerRows.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProduct(p)}
                        className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent transition-colors"
                      >
                        <div className="h-8 w-8 shrink-0 rounded overflow-hidden border border-border bg-muted/30">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Package className="h-3 w-3 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-body text-xs font-medium truncate">{p.title || '(未命名)'}</div>
                          <div className="font-mono-data text-[10px] text-muted-foreground">
                            {p.vendor || '—'} · {(p.sku || '').trim() || '—'}
                            {resolveSize(p) !== 'Default Title' ? ` · ${resolveSize(p)}` : ''}
                          </div>
                        </div>
                        <div className="font-mono-data text-xs text-foreground shrink-0">
                          {p.price != null ? `$${Number(p.price).toLocaleString()}` : '—'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {totalPickerPages > 1 && (
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={pickerPage === 0 || pickerLoading}
                      onClick={() => setPickerPage((p) => Math.max(0, p - 1))}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-body hover:bg-accent disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3 w-3" />上一頁
                    </button>
                    <span className="font-mono-data text-xs text-muted-foreground">
                      {pickerPage + 1} / {totalPickerPages}
                    </span>
                    <button
                      type="button"
                      disabled={pickerPage >= totalPickerPages - 1 || pickerLoading}
                      onClick={() => setPickerPage((p) => Math.min(totalPickerPages - 1, p + 1))}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-body hover:bg-accent disabled:opacity-40"
                    >
                      下一頁<ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

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

interface ShopifyVariant {
  id?: string | number;
  option1?: string;
  sku?: string;
  price?: string | number;
  inventory_quantity?: number;
  image_id?: string | number | null;
}

interface ShopifyImage {
  id?: string | number;
  src?: string;
  variant_ids?: (string | number)[];
}

interface ShopifyProductRow {
  id: string;
  shopify_product_id: string;
  title: string | null;
  vendor: string | null;
  image_url: string | null;
  images?: ShopifyImage[] | null;
  variants?: ShopifyVariant[] | null;
  price: number | null;
  sku?: string | null;
  status?: string | null;
  'my_fields.normal_size'?: string | null;
}

export interface MergeHostProduct {
  shopify_product_id: string;
  title: string;
  raw: ShopifyProductRow;
}

export interface MergeVariantRow {
  key: string;
  shopify_product_id: string;
  shopify_row_id: string;
  variant_id?: string | number;
  sku: string;
  price: number;
  size: string;
  option1: string;
  inventory: number;
  imageSrc: string | null;
}

const PICKER_PAGE_SIZE = 25;
const ROW_DRAG_MIME = 'application/x-merge-row-key';

function isHttpUrl(src: unknown): src is string {
  return typeof src === 'string' && /^https?:\/\//.test(src);
}

function normalizeImageUrl(src: string): string {
  try {
    const u = new URL(src);
    return `${u.origin}${u.pathname}`;
  } catch {
    return src.split('?')[0] ?? src;
  }
}

function imageDedupeKey(src: string): string {
  return normalizeImageUrl(src).replace(
    /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[a-z0-9]+$)/i,
    '',
  );
}

function dedupeImageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!isHttpUrl(url)) continue;
    const key = imageDedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function collectProductImageUrls(product: ShopifyProductRow): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (url: string | null | undefined) => {
    if (!isHttpUrl(url)) return;
    const key = imageDedupeKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(url);
  };
  add(product.image_url);
  for (const im of product.images ?? []) add(im.src);
  return out;
}

function resolveVariantImageSrc(
  row: ShopifyProductRow,
  variant?: ShopifyVariant,
): string | null {
  const images = row.images ?? [];
  const vid = variant?.id != null ? String(variant.id) : '';
  if (vid) {
    const imageId = variant?.image_id;
    if (imageId != null) {
      const linked = images.find((im) => String(im.id) === String(imageId));
      if (isHttpUrl(linked?.src)) return linked.src;
    }
    const byVariantIds = images.find(
      (im) => Array.isArray(im.variant_ids) && im.variant_ids.some((id) => String(id) === vid),
    );
    if (isHttpUrl(byVariantIds?.src)) return byVariantIds.src;
  }
  if (isHttpUrl(row.image_url)) return row.image_url;
  const first = images.find((im) => isHttpUrl(im.src));
  return first?.src ?? null;
}

function resolveSize(row: ShopifyProductRow, variant?: ShopifyVariant): string {
  const fromField = (row['my_fields.normal_size'] || '').trim();
  if (fromField) return fromField;
  const opt = (variant?.option1 || '').trim();
  if (opt) return opt;
  return 'Default Title';
}

function resolveSku(row: ShopifyProductRow, variant?: ShopifyVariant): string {
  const vSku = (variant?.sku || '').trim();
  if (vSku) return vSku;
  return (row.sku || '').trim();
}

function resolvePrice(row: ShopifyProductRow, variant?: ShopifyVariant): number {
  const vp = variant?.price;
  if (vp != null && vp !== '') {
    const n = typeof vp === 'string' ? parseFloat(vp) : vp;
    if (Number.isFinite(n)) return n;
  }
  if (row.price != null && Number.isFinite(Number(row.price))) return Number(row.price);
  return 0;
}

/**
 * When multiple merge rows share the same SKU, keep the lowest-price row on the base SKU;
 * others become `{base}-1`, `{base}-2`, … (ties broken by size label).
 * Rows with unique SKUs are unchanged.
 */
function assignDuplicateMergeSkus(rows: MergeVariantRow[]): MergeVariantRow[] {
  if (rows.length === 0) return rows;
  const next = rows.map((r) => ({ ...r }));
  const groups = new Map<string, number[]>();
  next.forEach((row, idx) => {
    const sku = row.sku.trim();
    if (!sku) return;
    const list = groups.get(sku) ?? [];
    list.push(idx);
    groups.set(sku, list);
  });
  for (const [baseSku, indices] of groups) {
    if (indices.length <= 1) continue;
    const sorted = [...indices].sort((a, b) => {
      const priceDiff = next[a].price - next[b].price;
      if (priceDiff !== 0) return priceDiff;
      return next[a].size.localeCompare(next[b].size, 'zh-Hant');
    });
    sorted.forEach((idx, rank) => {
      next[idx] = {
        ...next[idx],
        sku: rank === 0 ? baseSku : `${baseSku}-${rank}`,
      };
    });
  }
  return next;
}

function rowsFromProduct(row: ShopifyProductRow): MergeVariantRow[] {
  const variants = Array.isArray(row.variants) && row.variants.length > 0
    ? row.variants
    : [undefined];
  return variants.map((v, idx) => {
    const size = resolveSize(row, v);
    return {
      key: `${row.shopify_product_id}-${v?.id ?? idx}`,
      shopify_product_id: row.shopify_product_id,
      shopify_row_id: row.id,
      variant_id: v?.id,
      sku: resolveSku(row, v),
      price: resolvePrice(row, v),
      size,
      option1: size,
      inventory: v?.inventory_quantity ?? 100,
      imageSrc: resolveVariantImageSrc(row, v),
    };
  });
}

function buildGalleryFromProducts(
  productOrder: string[],
  productByShopifyId: Map<string, ShopifyProductRow>,
): string[] {
  const urls: string[] = [];
  for (const shopifyId of productOrder) {
    const product = productByShopifyId.get(shopifyId);
    if (!product) continue;
    urls.push(...collectProductImageUrls(product));
  }
  return dedupeImageUrls(urls);
}

function appendProductImages(
  prev: string[],
  product: ShopifyProductRow,
): string[] {
  return dedupeImageUrls([...prev, ...collectProductImageUrls(product)]);
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
  row: MergeVariantRow;
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
  onUpdate: (updates: Partial<MergeVariantRow>) => void;
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
          <span className="font-body text-[10px] text-muted-foreground">此為合併後保留的 Shopify 主體產品（第一行）</span>
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
              value={row.shopify_product_id.slice(-8)}
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

export function PublishedProductMergeModal({
  products,
  open,
  onOpenChange,
  onMerged,
}: {
  products: MergeHostProduct[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}) {
  const [rows, setRows] = useState<MergeVariantRow[]>([]);
  const [productCache, setProductCache] = useState<Map<string, ShopifyProductRow>>(new Map());
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerFactory, setPickerFactory] = useState('');
  const [pickerPage, setPickerPage] = useState(0);
  const [pickerTotal, setPickerTotal] = useState(0);
  const [pickerRows, setPickerRows] = useState<ShopifyProductRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerFactories, setPickerFactories] = useState<string[]>([]);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [rowDropTargetKey, setRowDropTargetKey] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const hostRow = rows[0] ?? null;
  const hostShopifyId = hostRow?.shopify_product_id ?? products[0]?.shopify_product_id ?? '';
  const hostTitle = productCache.get(hostShopifyId)?.title ?? products[0]?.title ?? '';

  useEffect(() => {
    if (!open || products.length === 0) return;
    const cache = new Map<string, ShopifyProductRow>();
    const allRows: MergeVariantRow[] = [];
    const order: string[] = [];
    for (const p of products) {
      cache.set(p.raw.shopify_product_id, p.raw);
      if (!order.includes(p.raw.shopify_product_id)) {
        order.push(p.raw.shopify_product_id);
      }
      allRows.push(...rowsFromProduct(p.raw));
    }
    setRows(assignDuplicateMergeSkus(allRows));
    setProductCache(cache);
    setGalleryUrls(buildGalleryFromProducts(order, cache));
    setShowPicker(false);
    setPickerSearch('');
    setPickerFactory('');
    setPickerPage(0);
  }, [open, products]);

  const addedShopifyIds = useMemo(
    () => new Set(rows.map((r) => r.shopify_product_id)),
    [rows],
  );

  const loadPicker = useCallback(async () => {
    if (!showPicker || !hostShopifyId) return;
    setPickerLoading(true);
    try {
      const from = pickerPage * PICKER_PAGE_SIZE;
      const to = from + PICKER_PAGE_SIZE - 1;
      const excludeIds = [...addedShopifyIds];

      let q = supabase
        .from('shopify_products')
        .select(
          'id, shopify_product_id, title, vendor, image_url, images, variants, price, sku, status',
          { count: 'exact' },
        )
        .is('configurable', null)
        .neq('shopify_product_id', hostShopifyId)
        .order('title', { ascending: true })
        .range(from, to);

      if (excludeIds.length > 0) {
        const quoted = excludeIds.map((id) => `"${id}"`).join(',');
        q = q.not('shopify_product_id', 'in', `(${quoted})`);
      }
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
      setPickerRows((data ?? []) as ShopifyProductRow[]);
      setPickerTotal(count ?? 0);

      if (pickerFactories.length === 0) {
        const { data: vendorRows } = await supabase
          .from('shopify_products')
          .select('vendor')
          .is('configurable', null)
          .not('vendor', 'is', null);
        const vendors = [...new Set((vendorRows ?? []).map((r) => String(r.vendor).trim()).filter(Boolean))].sort();
        setPickerFactories(vendors);
      }
    } finally {
      setPickerLoading(false);
    }
  }, [showPicker, hostShopifyId, pickerPage, pickerSearch, pickerFactory, addedShopifyIds, pickerFactories.length]);

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
      return next;
    });
  };

  const removeVariantRow = (key: string) => {
    setRows((prev) => {
      const row = prev.find((r) => r.key === key);
      if (!row) return prev;
      const next = prev.filter((r) => r.key !== key);
      const stillHasProduct = next.some((r) => r.shopify_product_id === row.shopify_product_id);
      if (!stillHasProduct) {
        setProductCache((cache) => {
          const product = cache.get(row.shopify_product_id);
          if (product) {
            const urlsToRemove = new Set(collectProductImageUrls(product));
            setGalleryUrls((g) => g.filter((u) => !urlsToRemove.has(u)));
            const nextCache = new Map(cache);
            nextCache.delete(row.shopify_product_id);
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

  const addProduct = (product: ShopifyProductRow) => {
    const newRows = rowsFromProduct(product);
    setProductCache((prev) => {
      const next = new Map(prev);
      next.set(product.shopify_product_id, product);
      return next;
    });
    setGalleryUrls((prev) => appendProductImages(prev, product));
    setRows((prev) => assignDuplicateMergeSkus([...prev, ...newRows]));
    setShowPicker(false);
    setPickerSearch('');
    setPickerFactory('');
    setPickerPage(0);
  };

  const handleComplete = async () => {
    if (!hostRow || rows.length < 2) {
      toast.error('至少需要 2 個規格才能合併');
      return;
    }
    const parentShopifyId = hostRow.shopify_product_id;
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

    setIsMerging(true);
    const toastId = toast.loading('正在合併 Shopify 產品…');
    try {
      const dedupedGallery = dedupeImageUrls(galleryUrls);
      const payload = {
        parent_shopify_product_id: parentShopifyId,
        parent_sku: parentSku,
        primary_image_src: dedupedGallery[0] || undefined,
        gallery_urls: dedupedGallery.length > 0 ? dedupedGallery : undefined,
        variants: rows.map((r) => {
          const primary = dedupedGallery[0];
          let imageSrc = r.imageSrc || undefined;
          if (imageSrc && primary && imageDedupeKey(imageSrc) === imageDedupeKey(primary)) {
            imageSrc = primary;
          }
          return {
            size: r.option1 || r.size,
            price: r.price,
            sku: r.sku.trim(),
            shopify_product_id: r.shopify_product_id,
            variant_id: r.shopify_product_id === parentShopifyId ? r.variant_id : undefined,
            image_src: imageSrc,
          };
        }),
      };

      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-merge-shopify-product-variants',
        { body: payload },
      );

      if (error || data?.error || data?.success === false) {
        const msg = data?.error || error?.message || '合併失敗';
        toast.error('合併失敗', { id: toastId, description: String(msg).slice(0, 200), duration: 8000 });
        return;
      }

      toast.success('產品已合併', {
        id: toastId,
        description: `共 ${data.variant_count ?? rows.length} 個規格 · 已下架 ${(data.archived_on_shopify ?? data.deleted_on_shopify ?? []).length} 件子產品`,
        duration: 8000,
      });
      onOpenChange(false);
      onMerged?.();
    } catch (e) {
      toast.error('合併失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
      });
    } finally {
      setIsMerging(false);
    }
  };

  if (products.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isMerging) onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between pr-6">
            <div>
              <DialogTitle className="font-display">
                合併產品 — {hostTitle}
              </DialogTitle>
              <DialogDescription className="font-body text-xs">
                拖曳左側握把調整順序（第一行為主產品）。相同 SKU 會按售價由低至高自動編號（最低保留原 SKU，其餘為 -1、-2…）；不同 SKU 則維持不變。
              </DialogDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-1.5 font-display text-xs"
              disabled={isMerging || rows.length < 2}
              onClick={() => void handleComplete()}
            >
              {isMerging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              完成
            </Button>
          </div>
        </DialogHeader>

        {galleryUrls.length > 0 && (
          <div className="mt-2 space-y-2">
            <p className="font-body text-[10px] text-muted-foreground">
              拖曳縮圖至下方各規格的「產品主圖」；點擊縮圖可在新視窗查看原圖
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
                setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...updates } : r)));
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
                {pickerRows.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground font-body">找不到產品</div>
                ) : pickerRows.map((p) => (
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
                        {p.vendor || '—'} · {(p.sku || resolveSku(p)).trim() || '—'}
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
      </DialogContent>
    </Dialog>
  );
}

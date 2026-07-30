import { useState, useEffect, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  X, Loader2, Package, Tag, DollarSign, Ruler, Boxes, Store, RefreshCw, ImageIcon, Search,
  Factory, ChevronsUpDown, Check, GripVertical, ChevronLeft, ChevronRight, ZoomIn,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { normalizeBodyHtmlForShopify } from '@/lib/bodyHtml';
import { resolveMirrorGalleryUrlsInSavedOrder, resolveMirrorPrimaryImageUrl, sortShopifyImages } from '@/lib/shopifyMirrorImages';
import { toast } from 'sonner';
import { PUBLISH_STATE_META, type PublishState } from '@/constants/analytics-mock';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { CategoryTagPicker, type BwfCat } from './CategoryTagPicker';
import { MANUFACTURERS } from '@/constants/manufacturers';
import { fetchFactoriesWithIds, type FactoryItem } from '@/lib/factorySupabase';
import { buildMoreImageMetafieldColumns } from '@/lib/shopifyMetafieldImages';
import { syncShopifyProductToProduct } from '@/lib/rtsProductSync';

interface ShopifyVariant {
  id?: string | number;
  title?: string;
  option1?: string;
  option2?: string;
  option3?: string;
  sku?: string;
  price?: string | number;
  inventory_quantity?: number;
  image_id?: string | number | null;
}

interface ShopifyImage {
  id?: string | number;
  src?: string;
  alt?: string;
  position?: number;
  width?: number;
  height?: number;
  variant_ids?: (string | number)[];
}

export interface PublishedProductRow {
  id: string;
  shopify_product_id: string;
  source_product_id?: string | null;
  title: string | null;
  body_html?: string | null;
  vendor: string | null;
  product_type: string | null;
  handle?: string | null;
  status: string | null;
  published_at: string | null;
  image_url: string | null;
  images?: ShopifyImage[] | null;
  variants?: ShopifyVariant[] | null;
  tags?: string[] | null;
  sku?: string | null;
  price: number | null;
  compare_at_price?: number | null;
  shopify_created_at?: string | null;
  shopify_updated_at: string | null;
  imported_at: string;
  shop_domain?: string | null;
  'my_fields.normal_size'?: string | null;
  'my_fields.materials'?: string | null;
  shopify_page_title?: string | null;
  shopify_page_description?: string | null;
  shopify_url?: string | null;
}

export interface PublishedDisplayProduct {
  id: string;
  shopify_product_id: string;
  title: string;
  state: PublishState;
  raw: PublishedProductRow;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '—';
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(num)) return '—';
  return `$${num.toLocaleString()}`;
}

function variantLabel(v: ShopifyVariant): string {
  const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(' / ');
  return opts || v.title || 'Default';
}

function variantEditKey(v: ShopifyVariant, index: number): string {
  return v.id != null ? String(v.id) : `index-${index}`;
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

function resolveImageIdForSrc(
  src: string,
  images: ShopifyImage[],
  fallbackImageUrl?: string | null,
): string | number | null {
  const norm = imageDedupeKey(src);
  for (const im of images) {
    if (im.src && imageDedupeKey(im.src) === norm && im.id != null) {
      return im.id;
    }
  }
  if (fallbackImageUrl && imageDedupeKey(fallbackImageUrl) === norm) {
    const first = images.find((im) => im.id != null);
    if (first?.id != null) return first.id;
  }
  return null;
}

/** Resolve variant thumbnail from mirror data (variants.image_id ↔ images[].id / variant_ids). */
function resolveVariantImageUrl(
  variant: ShopifyVariant,
  images: ShopifyImage[],
  fallback?: string | null,
): string | null {
  const variantId = variant.id != null ? String(variant.id) : '';
  const imageId = variant.image_id != null ? String(variant.image_id) : '';

  if (imageId) {
    const byId = images.find((im) => im.id != null && String(im.id) === imageId);
    if (byId?.src) return byId.src;
  }

  if (variantId) {
    const byVariantIds = images.find(
      (im) => Array.isArray(im.variant_ids) && im.variant_ids.some((id) => String(id) === variantId),
    );
    if (byVariantIds?.src) return byVariantIds.src;
  }

  return fallback ?? images[0]?.src ?? null;
}

function ReadOnlyField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn('text-xs text-foreground break-all', mono && 'font-mono-data')}>
        {value || <span className="text-muted-foreground/50">—</span>}
      </div>
    </div>
  );
}

export function PublishedProductDetailModal({
  product,
  onClose,
  onSaved,
  canGoPrev = false,
  canGoNext = false,
  onGoPrev,
  onGoNext,
}: {
  product: PublishedDisplayProduct;
  onClose: () => void;
  onSaved: () => void;
  /** Previous product on the current list page. */
  canGoPrev?: boolean;
  /** Next product on the current list page. */
  canGoNext?: boolean;
  onGoPrev?: () => void;
  onGoNext?: () => void;
}) {
  const r = product.raw;
  const [isSaving, setIsSaving] = useState(false);
  const [selectedImg, setSelectedImg] = useState<string | null>(null);
  const [mediaLightboxSrc, setMediaLightboxSrc] = useState<string | null>(null);
  const [variantLightboxSrc, setVariantLightboxSrc] = useState<string | null>(null);
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  const [bwfCats, setBwfCats] = useState<BwfCat[]>([]);

  const [editTitle, setEditTitle] = useState('');
  const [editBodyHtml, setEditBodyHtml] = useState('');
  const [editVendor, setEditVendor] = useState('');
  const [editL1, setEditL1] = useState('');
  const [editL2, setEditL2] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCompareAtPrice, setEditCompareAtPrice] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNormalSize, setEditNormalSize] = useState('');
  const [editMaterials, setEditMaterials] = useState('');
  const [editSeoTitle, setEditSeoTitle] = useState('');
  const [editSeoDesc, setEditSeoDesc] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editVariantSkus, setEditVariantSkus] = useState<Record<string, string>>({});
  const [editVariantImageSrc, setEditVariantImageSrc] = useState<Record<string, string>>({});
  const [variantImagePickerKey, setVariantImagePickerKey] = useState<string | null>(null);
  const [editFallbackSku, setEditFallbackSku] = useState('');
  const [manufacturerOpen, setManufacturerOpen] = useState(false);
  const [manufacturerSearch, setManufacturerSearch] = useState('');
  const [manufacturerList, setManufacturerList] = useState<string[]>(MANUFACTURERS);
  const [factoryItemsList, setFactoryItemsList] = useState<FactoryItem[]>([]);
  const [manufacturerListLoading, setManufacturerListLoading] = useState(true);
  const [editImages, setEditImages] = useState<string[]>([]);
  const [dragImgIndex, setDragImgIndex] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from('product_category')
      .select('level1, level2, sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data: cats }) => { if (cats) setCategoryPairs(cats as { level1: string; level2: string }[]); });
    supabase
      .from('bwf_product_categories')
      .select('id,name,parent_id,level,sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data }) => { if (data) setBwfCats(data); });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setManufacturerListLoading(true);
      const fetched = await fetchFactoriesWithIds();
      if (cancelled) return;
      if (fetched.length > 0) {
        setFactoryItemsList(fetched);
        setManufacturerList(fetched.map((f) => f.display_name));
      } else {
        setFactoryItemsList([]);
        setManufacturerList(MANUFACTURERS);
      }
      setManufacturerListLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const ptParts = (r.product_type || '').split(' / ');
    setEditTitle(r.title || '');
    setEditBodyHtml(normalizeBodyHtmlForShopify(r.body_html || ''));
    setEditVendor(r.vendor || '');
    setEditL1(ptParts[0] || '');
    setEditL2(ptParts[1] || '');
    setEditPrice(r.price != null ? String(r.price) : '');
    setEditCompareAtPrice(r.compare_at_price != null ? String(r.compare_at_price) : '');
    setEditTags(Array.isArray(r.tags) ? r.tags : []);
    setEditNormalSize(r['my_fields.normal_size'] || '');
    setEditMaterials(r['my_fields.materials'] || '');
    setEditSeoTitle(r.shopify_page_title ?? '');
    setEditSeoDesc(r.shopify_page_description ?? '');
    setEditHandle(r.shopify_url ?? '');
    setEditVariantSkus(
      (Array.isArray(r.variants) ? r.variants : []).reduce<Record<string, string>>((acc, v, i) => {
        acc[variantEditKey(v, i)] = v.sku || '';
        return acc;
      }, {})
    );
    const imgs = Array.isArray(r.images) ? r.images : [];
    setEditVariantImageSrc(
      (Array.isArray(r.variants) ? r.variants : []).reduce<Record<string, string>>((acc, v, i) => {
        const key = variantEditKey(v, i);
        const src = resolveVariantImageUrl(v, imgs, r.image_url);
        if (src) acc[key] = src;
        return acc;
      }, {})
    );
    setEditFallbackSku(r.sku || '');
    const gallery = resolveMirrorGalleryUrlsInSavedOrder(r);
    setEditImages(gallery);
    setSelectedImg(gallery[0] || resolveMirrorPrimaryImageUrl(r) || null);
    setDragImgIndex(null);
  }, [r]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mediaLightboxSrc) {
        setMediaLightboxSrc(null);
        return;
      }
      if (variantLightboxSrc) {
        setVariantLightboxSrc(null);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, mediaLightboxSrc, variantLightboxSrc]);

  const level1Options = useMemo(
    () => Array.from(new Set(categoryPairs.map((p) => p.level1))),
    [categoryPairs]
  );
  const getLevel2Options = (l1: string) =>
    Array.from(new Set(categoryPairs.filter((p) => p.level1 === l1 && p.level2).map((p) => p.level2)));

  const filteredManufacturers = useMemo(() => {
    if (!manufacturerSearch.trim()) return manufacturerList;
    const q = manufacturerSearch.toLowerCase();
    return manufacturerList.filter((m) => {
      if (m.toLowerCase().includes(q)) return true;
      const item = factoryItemsList.find((f) => f.display_name === m);
      return !!item?.factory_id && item.factory_id.toLowerCase().includes(q);
    });
  }, [manufacturerSearch, manufacturerList, factoryItemsList]);

  const sortedImgs = useMemo(() => sortShopifyImages(r.images) as ShopifyImage[], [r.images]);

  const handleImageReorderDrop = useCallback((targetIndex: number) => {
    if (dragImgIndex === null || dragImgIndex === targetIndex) {
      setDragImgIndex(null);
      return;
    }
    setEditImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragImgIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragImgIndex(null);
  }, [dragImgIndex]);

  const clearImageDrag = useCallback(() => setDragImgIndex(null), []);

  const displayImg = (selectedImg && editImages.includes(selectedImg)) ? selectedImg : (editImages[0] || '');
  const variants: ShopifyVariant[] = Array.isArray(r.variants) ? r.variants : [];
  const showVariantMainImageCol = variants.length >= 2;

  const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-body text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors';
  const textareaCls = `${inputCls} resize-y`;

  const handleSave = async () => {
    const shopifyId = r.shopify_product_id;
    if (!shopifyId) { toast.error('此產品沒有 Shopify ID，無法儲存'); return; }
    setIsSaving(true);
    const toastId = toast.loading('正在儲存...');
    try {
      const priceNum = editPrice !== '' ? parseFloat(editPrice) : null;
      const compareNum = editCompareAtPrice !== '' ? parseFloat(editCompareAtPrice) : null;
      const productType = [editL1, editL2].filter(Boolean).join(' / ') || null;
      const handleNorm = editHandle.trim() || null;
      const preservedImages = editImages.length > 0
        ? editImages.map((src, i) => {
          const existing = sortedImgs.find(
            (im) => im.src && imageDedupeKey(im.src) === imageDedupeKey(src),
          );
          if (existing) {
            return {
              id: existing.id,
              src,
              alt: existing.alt ?? '',
              width: existing.width,
              height: existing.height,
              position: i + 1,
              variant_ids: existing.variant_ids,
            };
          }
          return { src, position: i + 1 };
        })
        : null;

      const updatedVariants = (Array.isArray(r.variants) ? r.variants : []).map((v, i) => {
        const key = variantEditKey(v, i);
        const selectedSrc = editVariantImageSrc[key];
        const imageId = selectedSrc
          ? resolveImageIdForSrc(selectedSrc, sortedImgs, editImages[0] ?? r.image_url)
          : v.image_id;
        return {
          ...v,
          sku: editVariantSkus[key] ?? v.sku ?? '',
          ...(imageId != null ? { image_id: imageId } : {}),
        };
      });

      const primarySku = updatedVariants.length === 0
        ? (editFallbackSku.trim() || null)
        : (updatedVariants.map(v => (v.sku || '').trim()).find(Boolean) || null);

      const updatePayload: Record<string, unknown> = {
        title: editTitle || null,
        body_html: normalizeBodyHtmlForShopify(editBodyHtml) || null,
        vendor: editVendor || null,
        product_type: productType,
        tags: editTags,
        price: priceNum,
        compare_at_price: compareNum,
        image_url: editImages[0] || resolveMirrorPrimaryImageUrl(r) || null,
        images: preservedImages,
        variants: updatedVariants.length > 0 ? updatedVariants : r.variants,
        sku: primarySku,
        shopify_page_title: editSeoTitle.trim() || null,
        shopify_page_description: editSeoDesc.trim() || null,
        shopify_url: handleNorm,
        handle: handleNorm,
        'my_fields.normal_size': editNormalSize.trim() || null,
        'my_fields.materials': editMaterials.trim() || null,
        ...buildMoreImageMetafieldColumns(editImages.slice(0, 4), editTitle),
      };

      const { error } = await supabase
        .from('shopify_products')
        .update(updatePayload)
        .eq('shopify_product_id', shopifyId);

      if (error) {
        toast.error('儲存失敗', {
          id: toastId,
          description: error.message,
          duration: 8000,
        });
        return;
      }

      if (r.source_product_id) {
        await syncShopifyProductToProduct(supabase, r.source_product_id, {
          title: updatePayload.title as string,
          body_html: updatePayload.body_html as string,
          vendor: updatePayload.vendor as string,
          product_type: updatePayload.product_type as string,
          tags: updatePayload.tags as string[],
          sku: updatePayload.sku as string,
          price: priceNum,
          compare_at_price: compareNum,
          image_url: updatePayload.image_url as string,
          images: updatePayload.images,
          'my_fields.materials': updatePayload['my_fields.materials'] as string,
        });
      }

      toast.success('已儲存至本地', {
        id: toastId,
        description: '按「與 Shopify 同步」將本地資料推送至 Shopify（圖片 metafield 會使用 Shopify CDN）。',
        duration: 5000,
      });
      onSaved();
      onClose();
    } catch (e) {
      toast.error('儲存失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
        duration: 8000,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col bg-background rounded-2xl shadow-2xl overflow-hidden border border-border"
        style={{ width: '1200px', height: '800px', maxWidth: '96vw', maxHeight: '96vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onClose}
              className="shrink-0 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              退出
            </button>
            <span className="text-muted-foreground/40">·</span>
            <span className="font-display text-sm font-semibold truncate text-foreground">{editTitle || product.title}</span>
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium', PUBLISH_STATE_META[product.state].className)}>
              {PUBLISH_STATE_META[product.state].label}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onGoPrev}
                disabled={!canGoPrev || isSaving}
                title="上一個產品"
                aria-label="上一個產品"
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-xl border transition-colors',
                  canGoPrev && !isSaving
                    ? 'border-border bg-card text-foreground hover:bg-accent'
                    : 'cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/40',
                )}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onGoNext}
                disabled={!canGoNext || isSaving}
                title="下一個產品"
                aria-label="下一個產品"
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-xl border transition-colors',
                  canGoNext && !isSaving
                    ? 'border-border bg-card text-foreground hover:bg-accent'
                    : 'cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/40',
                )}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={isSaving || !r.shopify_product_id}
              className="shrink-0 flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              儲存
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: media (primary) + Shopify meta at bottom */}
          <div className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-[22px] bg-muted/10">
            <div>
              <button
                type="button"
                disabled={!displayImg}
                onClick={() => { if (displayImg) setMediaLightboxSrc(displayImg); }}
                title={displayImg ? '點擊放大檢視' : undefined}
                className={cn(
                  'group relative flex h-[250px] w-[250px] max-w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-muted transition-colors mx-auto',
                  displayImg ? 'cursor-zoom-in hover:border-primary/50' : 'cursor-default',
                )}
              >
                {displayImg ? (
                  <>
                    <img src={displayImg} alt={editTitle} className="h-full w-full object-contain" />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <ZoomIn className="h-5 w-5" />
                      </span>
                    </span>
                  </>
                ) : (
                  <ImageIcon className="h-16 w-16 text-muted-foreground/30" />
                )}
              </button>
              {displayImg && (
                <p className="mt-1.5 text-[10.5px] text-muted-foreground/60">點擊上方圖片可放大檢視</p>
              )}
            </div>

            {editImages.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  <ImageIcon className="h-3 w-3" />
                  媒體 ({editImages.length})
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {editImages.map((src, i) => (
                    <div
                      key={src}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDragImgIndex(i);
                      }}
                      onDragEnd={clearImageDrag}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleImageReorderDrop(i)}
                      className={cn(
                        'group relative aspect-square w-full cursor-grab overflow-hidden rounded-lg border-2 bg-muted transition-all active:cursor-grabbing',
                        (selectedImg === src || (!selectedImg && i === 0) || displayImg === src)
                          ? 'border-primary ring-1 ring-primary/30'
                          : 'border-transparent hover:border-muted-foreground/40',
                        dragImgIndex === i && 'opacity-50',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedImg(src)}
                        className="h-full w-full"
                        title={i === 0 ? '切換至產品主圖' : `切換至圖片 ${i + 1}`}
                      >
                        <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
                      </button>
                      {i === 0 && (
                        <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-primary px-1 py-px text-[8px] font-bold leading-none text-primary-foreground">
                          主圖
                        </span>
                      )}
                      <span className="pointer-events-none absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <GripVertical className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10.5px] text-muted-foreground/60">
                  點擊縮圖可切換上方預覽；拖拉可調整順序，最左為產品主圖
                </p>
              </div>
            )}

            {/* Read-only Shopify metadata — secondary, pinned below media */}
            <section className="mt-auto rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <Store className="h-3.5 w-3.5" />
                Shopify 資訊（唯讀）
              </div>
              <ReadOnlyField label="Shopify ID" value={r.shopify_product_id} mono />
              <ReadOnlyField label="狀態" value={r.status} />
              <ReadOnlyField label="上架時間" value={r.published_at ? fmtDate(r.published_at) : null} />
              <ReadOnlyField label="導入時間" value={fmtDate(r.imported_at)} />
              <ReadOnlyField label="Shopify 建立" value={r.shopify_created_at ? fmtDate(r.shopify_created_at) : null} />
              <ReadOnlyField label="Shopify 更新" value={r.shopify_updated_at ? fmtDate(r.shopify_updated_at) : null} />
              {r.shop_domain && <ReadOnlyField label="店舖" value={r.shop_domain} mono />}
              {r.handle && <ReadOnlyField label="Handle" value={`/${r.handle}`} mono />}
            </section>
          </div>

          {/* Right: editable fields */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <section className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Package className="h-4 w-4 text-primary" />
                一般資料
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">產品名稱</label>
                <input className={inputCls} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="產品標題" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">產品描述</label>
                <textarea
                  className={textareaCls}
                  rows={8}
                  value={editBodyHtml}
                  onChange={(e) => setEditBodyHtml(e.target.value)}
                  placeholder="產品描述（支援 HTML）"
                />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Tag className="h-4 w-4 text-amber-500" />
                分類 / 廠商
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">一級分類</label>
                  <select className={`${inputCls} cursor-pointer`} value={editL1} onChange={(e) => { setEditL1(e.target.value); setEditL2(''); }}>
                    <option value="">— 請選擇 —</option>
                    {level1Options.map((l1) => <option key={l1} value={l1}>{l1}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">二級分類</label>
                  <select className={`${inputCls} cursor-pointer`} value={editL2} onChange={(e) => setEditL2(e.target.value)} disabled={!editL1}>
                    <option value="">— 請選擇 —</option>
                    {getLevel2Options(editL1).map((l2) => <option key={l2} value={l2}>{l2}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">廠商 (Vendor)</label>
                <Popover open={manufacturerOpen} onOpenChange={setManufacturerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={manufacturerOpen}
                      className={cn(
                        'h-10 w-full justify-between rounded-lg border-border bg-background px-3 font-body text-sm hover:bg-accent/50',
                        !editVendor && 'text-muted-foreground'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Factory className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                        <span className="truncate">
                          {editVendor || '選擇或輸入廠家名稱...'}
                        </span>
                        {(() => {
                          const item = factoryItemsList.find((f) => f.display_name === editVendor);
                          return item?.factory_id ? (
                            <span className="shrink-0 font-mono-data text-[10px] text-muted-foreground">({item.factory_id})</span>
                          ) : null;
                        })()}
                      </div>
                      <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" side="bottom" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="搜尋廠家..."
                        className="font-body text-sm"
                        value={manufacturerSearch}
                        onValueChange={setManufacturerSearch}
                      />
                      <CommandList>
                        {manufacturerListLoading ? (
                          <div className="flex items-center justify-center gap-2 py-6">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <span className="font-body text-xs text-muted-foreground">載入廠家列表...</span>
                          </div>
                        ) : (
                          <>
                            <CommandEmpty>
                              {manufacturerSearch.trim() ? (
                                <div className="px-2 py-3 text-center">
                                  <p className="font-body text-xs text-muted-foreground">找不到「{manufacturerSearch}」</p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="mt-2 gap-1.5 font-body text-xs text-primary"
                                    onClick={() => {
                                      setEditVendor(manufacturerSearch.trim());
                                      setManufacturerOpen(false);
                                      setManufacturerSearch('');
                                    }}
                                  >
                                    <Check className="h-3 w-3" />
                                    使用「{manufacturerSearch}」作為新廠家
                                  </Button>
                                </div>
                              ) : (
                                <p className="py-3 font-body text-xs text-muted-foreground">沒有找到廠家</p>
                              )}
                            </CommandEmpty>
                            <CommandGroup>
                              {filteredManufacturers.map((manufacturer) => {
                                const item = factoryItemsList.find((f) => f.display_name === manufacturer);
                                return (
                                  <CommandItem
                                    key={manufacturer}
                                    value={manufacturer}
                                    onSelect={() => {
                                      setEditVendor(manufacturer);
                                      setManufacturerOpen(false);
                                      setManufacturerSearch('');
                                    }}
                                    className="cursor-pointer font-body text-sm"
                                  >
                                    <Factory className="mr-2 h-3.5 w-3.5 text-muted-foreground/50" />
                                    <span className="truncate">{manufacturer}</span>
                                    {item?.factory_id && (
                                      <span className="ml-1 font-mono-data text-[10px] text-muted-foreground">({item.factory_id})</span>
                                    )}
                                    {editVendor === manufacturer && (
                                      <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                                    )}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">產品標籤</label>
                <CategoryTagPicker
                  tags={editTags}
                  categories={bwfCats}
                  onChange={setEditTags}
                />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <DollarSign className="h-4 w-4 text-green-500" />
                價格
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">售價 (HK$)</label>
                  <input className={inputCls} type="number" min="0" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Compare-at 價格 (HK$)</label>
                  <input className={inputCls} type="number" min="0" step="0.01" value={editCompareAtPrice} onChange={(e) => setEditCompareAtPrice(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Ruler className="h-4 w-4 text-sky-500" />
                尺寸與物料
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">產品尺寸（my_fields.normal_size）</label>
                <input className={inputCls} value={editNormalSize} onChange={(e) => setEditNormalSize(e.target.value)} placeholder="例如 1200(W)x600(D)x750(H)(mm)" />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Boxes className="h-3 w-3" />
                  產品物料
                </label>
                <Textarea
                  value={editMaterials}
                  onChange={(e) => setEditMaterials(e.target.value)}
                  rows={4}
                  className="min-h-[5.5rem] resize-y rounded-lg bg-background font-body text-sm"
                  placeholder="輸入產品物料..."
                />
              </div>
            </section>

            {/* Variants */}
            {variants.length > 0 && (
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="text-sm font-bold text-foreground">
                  規格 / Variants（{variants.length}）
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        {showVariantMainImageCol && (
                          <th className="w-14 px-2 py-2 text-center font-medium">主圖</th>
                        )}
                        <th className="px-3 py-2 text-left font-medium">規格</th>
                        <th className="px-3 py-2 text-left font-medium">SKU</th>
                        <th className="px-3 py-2 text-right font-medium">價錢</th>
                        <th className="px-3 py-2 text-right font-medium">庫存</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {variants.map((v, i) => {
                        const key = variantEditKey(v, i);
                        const thumbUrl = editVariantImageSrc[key]
                          ?? resolveVariantImageUrl(v, sortedImgs, r.image_url);
                        return (
                        <tr key={v.id ?? i} className="hover:bg-muted/30">
                          {showVariantMainImageCol && (
                            <td className="px-2 py-2 align-middle">
                              <button
                                type="button"
                                onClick={() => setVariantImagePickerKey(key)}
                                className={cn(
                                  'block h-10 w-10 shrink-0 overflow-hidden rounded-md border-2 border-dashed bg-muted transition-colors',
                                  'hover:border-primary hover:ring-2 hover:ring-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40',
                                )}
                                title="點擊從媒體選擇規格主圖"
                              >
                                {thumbUrl ? (
                                  <img
                                    src={thumbUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                  </div>
                                )}
                              </button>
                            </td>
                          )}
                          <td className="px-3 py-2 font-medium text-foreground align-middle">{variantLabel(v)}</td>
                          <td className="px-3 py-2">
                            <input
                              className="w-full min-w-[180px] rounded-md border border-border bg-background px-2 py-1.5 font-mono-data text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                              value={editVariantSkus[key] ?? ''}
                              onChange={(e) => setEditVariantSkus((prev) => ({ ...prev, [key]: e.target.value }))}
                              placeholder="輸入 SKU"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono-data">{fmtMoney(v.price ?? null)}</td>
                          <td className="px-3 py-2 text-right font-mono-data text-muted-foreground">{v.inventory_quantity ?? '—'}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {variants.length === 0 && (
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="text-sm font-bold text-foreground">SKU</div>
                <input
                  className={`${inputCls} font-mono-data`}
                  value={editFallbackSku}
                  onChange={(e) => setEditFallbackSku(e.target.value)}
                  placeholder="輸入 SKU"
                />
              </section>
            )}

            <section className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Search className="h-4 w-4 text-indigo-500" />
                搜尋引擎列表 (SEO)
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">頁面標題</label>
                <input
                  className={inputCls}
                  value={editSeoTitle}
                  onChange={(e) => setEditSeoTitle(e.target.value)}
                  placeholder="頁面標題"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Meta 描述</label>
                <textarea
                  className={textareaCls}
                  rows={3}
                  value={editSeoDesc}
                  onChange={(e) => setEditSeoDesc(e.target.value)}
                  placeholder="Meta 描述"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">網址控制代碼</label>
                <input
                  className={`${inputCls} font-mono`}
                  value={editHandle}
                  onChange={(e) => setEditHandle(e.target.value)}
                  placeholder="product-url-handle"
                />
              </div>
            </section>
          </div>
        </div>
      </div>

      {variantImagePickerKey && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setVariantImagePickerKey(null)}
        >
          <div
            className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-semibold text-foreground">選擇規格主圖</h3>
                <p className="mt-0.5 font-body text-[11px] text-muted-foreground">
                  從此產品的媒體中選一張作為該尺寸的主圖
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVariantImagePickerKey(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {editImages.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">此產品沒有可選媒體圖片</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {editImages.map((src) => {
                  const isSelected = variantImagePickerKey
                    && editVariantImageSrc[variantImagePickerKey] === src;
                  return (
                    <button
                      key={src}
                      type="button"
                      onClick={() => {
                        if (!variantImagePickerKey) return;
                        setEditVariantImageSrc((prev) => ({
                          ...prev,
                          [variantImagePickerKey]: src,
                        }));
                        setVariantImagePickerKey(null);
                      }}
                      className={cn(
                        'relative aspect-square overflow-hidden rounded-lg border-2 transition-all',
                        isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50',
                      )}
                    >
                      <img src={src} alt="" className="h-full w-full object-cover" />
                      {isSelected && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {variantImagePickerKey && editVariantImageSrc[variantImagePickerKey] && (
              <button
                type="button"
                onClick={() => setVariantLightboxSrc(editVariantImageSrc[variantImagePickerKey])}
                className="mt-3 text-[11px] text-primary hover:underline"
              >
                查看目前選中圖片原尺寸
              </button>
            )}
          </div>
        </div>
      )}

      {mediaLightboxSrc && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setMediaLightboxSrc(null)}
        >
          <button
            type="button"
            onClick={() => setMediaLightboxSrc(null)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="關閉"
          >
            <X className="h-4 w-4" />
          </button>
          <img
            src={mediaLightboxSrc}
            alt={editTitle || '產品圖片'}
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {variantLightboxSrc && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setVariantLightboxSrc(null)}
        >
          <button
            type="button"
            onClick={() => setVariantLightboxSrc(null)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="關閉"
          >
            <X className="h-4 w-4" />
          </button>
          <img
            src={variantLightboxSrc}
            alt="規格原圖"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

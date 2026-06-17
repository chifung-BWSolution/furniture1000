import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Sofa, Loader2, CheckCheck, ChevronRight, Image as ImageIcon,
  X, Package, Tag, DollarSign, Search, RotateCcw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FGItem {
  rtsId: string;
  productId: string;
  title: string;
  imageUrl: string;
  factory: string;
  productType: string;
  price: number | null;
  tags: string[];
}

interface FGDetail {
  id: string;
  product_id: string;
  title: string | null;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  price: number | null;
  compare_at_price: number | null;
  image_url: string | null;
  images: any[] | null;
  status: string | null;
  tags: string[] | null;
  shopify_product_id: string | null;
  shopify_page_title: string | null;
  shopify_page_description: string | null;
  shopify_url: string | null;
  handle: string | null;
  imported_at: string | null;
}

interface Props {
  onEnterReadyToPublish?: () => void;
}

// ─── Product Detail Modal ─────────────────────────────────────────────────────

function FGProductDetailModal({
  rtsId,
  onClose,
}: {
  rtsId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<FGDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImg, setSelectedImg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase
      .from('ready_to_shopify')
      .select(
        'id,product_id,title,body_html,vendor,product_type,price,compare_at_price,' +
        'image_url,images,status,tags,shopify_product_id,' +
        'shopify_page_title,shopify_page_description,shopify_url,handle,imported_at'
      )
      .eq('id', rtsId)
      .single()
      .then(({ data: row, error }) => {
        if (error || !row) {
          toast.error('讀取產品詳情失敗');
          onClose();
          return;
        }
        setData(row as FGDetail);
        setSelectedImg((row as FGDetail).image_url || null);
        setLoading(false);
      });
  }, [rtsId, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Build ordered image list: image_url first, then images[]
  const allImages: string[] = [];
  if (data?.image_url) allImages.push(data.image_url);
  if (Array.isArray(data?.images)) {
    for (const img of data.images) {
      const src: string = img?.src || img?.url || (typeof img === 'string' ? img : '');
      if (src && src !== data?.image_url) allImages.push(src);
    }
  }
  const displayImg = selectedImg || allImages[0] || '';

  const tagList: string[] = Array.isArray(data?.tags)
    ? data!.tags
    : typeof data?.tags === 'string' && data.tags
      ? (data.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      : [];

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
        {/* ── Modal Header ── */}
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
            <span className="font-display text-sm font-semibold truncate text-foreground">
              {data?.title ?? '讀取中…'}
            </span>
            {data?.shopify_product_id && (
              <span className="shrink-0 flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-green-700 dark:text-green-400">
                ✓ 已同步至全域
              </span>
            )}
          </div>
        </div>

        {/* ── Modal Body ── */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* ── Left Panel: Media + Meta ── */}
            <div className="flex w-[320px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-border p-6 bg-muted/10">
              {/* Main image */}
              <div className="aspect-square w-full overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center">
                {displayImg ? (
                  <img
                    src={displayImg}
                    alt={data.title ?? ''}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImageIcon className="h-16 w-16 text-muted-foreground/30" />
                )}
              </div>

              {/* Thumbnail strip */}
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  <ImageIcon className="h-3 w-3" />
                  媒體 ({allImages.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {allImages.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedImg(src)}
                      className={cn(
                        'h-14 w-14 overflow-hidden rounded-lg border-2 bg-muted transition-all',
                        selectedImg === src
                          ? 'border-primary ring-1 ring-primary/30'
                          : 'border-transparent hover:border-muted-foreground/40'
                      )}
                    >
                      <img src={src} alt={`媒體 ${i + 1}`} className="h-full w-full object-cover" />
                    </button>
                  ))}
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50">
                    <span className="text-xl text-muted-foreground/40">+</span>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  <Tag className="h-3 w-3" />
                  狀態
                </div>
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
                  {data.status || 'draft'}
                </span>
              </div>

              {/* Shopify Product ID */}
              {data.shopify_product_id && (
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Master ID
                  </div>
                  <div className="font-mono text-xs text-primary break-all">{data.shopify_product_id}</div>
                </div>
              )}

              {/* Created time */}
              {data.imported_at && (
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    建立時間
                  </div>
                  <div className="text-xs text-foreground">
                    {new Date(data.imported_at).toLocaleString('zh-TW')}
                  </div>
                </div>
              )}
            </div>

            {/* ── Right Panel: Product Info ── */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* 一般資料 */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Package className="h-4 w-4 text-primary" />
                  一般資料
                </div>

                {/* Title — ready_to_shopify.title */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    產品標題
                  </label>
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm font-body text-foreground min-h-[38px]">
                    {data.title || '—'}
                  </div>
                </div>

                {/* Description — ready_to_shopify.body_html */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    產品說明
                  </label>
                  <div
                    className="min-h-[140px] max-h-[220px] overflow-y-auto rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm font-body text-foreground prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{
                      __html: data.body_html || '<p style="color:var(--muted-foreground)">（無說明）</p>',
                    }}
                  />
                </div>
              </section>

              {/* 分類 / Collection */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Tag className="h-4 w-4 text-amber-500" />
                  分類 / Collection
                </div>
                {/* product_type — ready_to_shopify.product_type */}
                <div>
                  {data.product_type ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      {data.product_type}
                      <span className="text-primary/50">×</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">未設定</span>
                  )}
                  {data.product_type && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">{data.product_type}</p>
                  )}
                </div>
              </section>

              {/* 價格 */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  價格
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* price — ready_to_shopify.price */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">售價</label>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm font-mono-data">
                      {data.price != null ? `HK$ ${Number(data.price).toLocaleString()}` : '—'}
                    </div>
                  </div>
                  {/* compare_at_price — ready_to_shopify.compare_at_price */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Compare-at 價格</label>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm font-mono-data">
                      {data.compare_at_price != null ? `HK$ ${Number(data.compare_at_price).toLocaleString()}` : '—'}
                    </div>
                  </div>
                </div>
              </section>

              {/* 產品組織 (Product Organization) */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <span className="text-orange-500 text-base leading-none">⬡</span>
                  產品組織
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* product_type — ready_to_shopify.product_type */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">類型 (Type)</label>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                      {data.product_type || '—'}
                    </div>
                  </div>
                  {/* vendor — ready_to_shopify.vendor */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">廠家 (Vendor)</label>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                      {data.vendor || '—'}
                    </div>
                  </div>
                </div>
                {/* tags — ready_to_shopify.tags */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">標籤 (Tags)</label>
                  <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 min-h-[36px]">
                    {tagList.length > 0
                      ? tagList.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-body text-foreground border border-border/60"
                          >
                            {t}
                          </span>
                        ))
                      : <span className="text-xs text-muted-foreground">（無標籤）</span>
                    }
                  </div>
                </div>
              </section>

              {/* SEO — only shown when at least one SEO field exists */}
              {(data.shopify_page_title || data.shopify_page_description || data.shopify_url || data.handle) && (
                <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Search className="h-4 w-4 text-indigo-500" />
                    搜尋引擎列表 (Search engine listing)
                  </div>
                  {/* SEO preview card */}
                  <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-1">
                    <p className="text-[11px] text-muted-foreground">
                      example.com › products › {data.shopify_url || data.handle || '…'}
                    </p>
                    {/* shopify_page_title — ready_to_shopify.shopify_page_title */}
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      {data.shopify_page_title || data.title || '—'}
                    </p>
                    {/* shopify_page_description — ready_to_shopify.shopify_page_description */}
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {data.shopify_page_description
                        || (data.body_html ? data.body_html.replace(/<[^>]*>/g, ' ').slice(0, 160) : '—')}
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        SEO 標題 (shopify_page_title)
                      </label>
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                        {data.shopify_page_title || '—'}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        SEO 描述 (shopify_page_description)
                      </label>
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm min-h-[60px]">
                        {data.shopify_page_description || '—'}
                      </div>
                    </div>
                    {/* shopify_url — ready_to_shopify.shopify_url */}
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        URL Handle (shopify_url)
                      </label>
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm font-mono break-all">
                        {data.shopify_url || data.handle || '—'}
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function FurnitureGroupCheckView({ onEnterReadyToPublish }: Props) {
  const [items, setItems] = useState<FGItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detailRtsId, setDetailRtsId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('ready_to_shopify')
      .select('id,product_id,title,image_url,vendor,product_type,price,tags')
      .eq('furniture_group_checked', false)
      .order('imported_at', { ascending: false });

    if (error) {
      toast.error('讀取失敗', { description: error.message });
      setItems([]);
    } else {
      // Dedup by product_id — keep the most-recently-imported row per product
      const seen = new Set<string>();
      const deduped = (data || []).filter((r: any) => {
        if (r.product_id && seen.has(r.product_id)) return false;
        if (r.product_id) seen.add(r.product_id);
        return true;
      });
      setItems(deduped.map((r: any) => ({
        rtsId: r.id,
        productId: r.product_id,
        title: r.title || '(未命名)',
        imageUrl: r.image_url || '',
        factory: r.vendor || '—',
        productType: r.product_type || '—',
        price: r.price != null ? Number(r.price) : null,
        tags: Array.isArray(r.tags) ? r.tags : [],
      })));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRow = (id: string) =>
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(items.map(r => r.rtsId)) : new Set());

  const allSelected = items.length > 0 && items.every(r => selected.has(r.rtsId));

  const handleAddToReadyToPublish = async () => {
    if (selected.size === 0) { toast.message('請先勾選產品'); return; }
    const ids = Array.from(selected);
    setIsSubmitting(true);
    try {
      // Set furniture_group_checked=true → rows appear in 準備上載 query
      const { error: rtsError } = await supabase
        .from('ready_to_shopify')
        .update({ furniture_group_checked: true })
        .in('id', ids);
      if (rtsError) throw new Error(rtsError.message);

      // Also set ready_to_publish=true on products table
      const productIds = items
        .filter(r => ids.includes(r.rtsId))
        .map(r => r.productId)
        .filter(Boolean);
      if (productIds.length > 0) {
        await supabase
          .from('products')
          .update({ ready_to_publish: true })
          .in('id', productIds);
      }

      setItems(prev => prev.filter(r => !ids.includes(r.rtsId)));
      setSelected(new Set());
      toast.success('已加入準備上載', { description: `${ids.length} 件產品已移至「準備上載」` });
      onEnterReadyToPublish?.();
    } catch (e) {
      toast.error('操作失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isReverting, setIsReverting] = useState(false);

  const handleRevertAll = async () => {
    if (items.length === 0) return;
    if (!window.confirm(`確定要把全部 ${items.length} 件產品退回「產品文案」頁面嗎？`)) return;
    setIsReverting(true);
    try {
      const rtsIds = items.map(r => r.rtsId);
      const productIds = items.map(r => r.productId).filter(Boolean);

      // Delete rows from ready_to_shopify (removes from 傢俬組檢查)
      const { error: delErr } = await supabase
        .from('ready_to_shopify')
        .delete()
        .in('id', rtsIds);
      if (delErr) throw new Error(delErr.message);

      // Reset products so they reappear in 產品文案
      if (productIds.length > 0) {
        const { error: updErr } = await supabase
          .from('products')
          .update({
            copy_done: false,
            info_done: false,
            ready_to_publish: false,
            in_shopify_queue: false,
          })
          .in('id', productIds);
        if (updErr) throw new Error(updErr.message);
      }

      setItems([]);
      setSelected(new Set());
      toast.success('已全部退回產品文案', { description: `${rtsIds.length} 件產品已退回「產品文案」頁面` });
    } catch (e) {
      toast.error('退回失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsReverting(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-8 py-3.5">
        <div className="flex items-center gap-2">
          <Sofa className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">傢俬組檢查</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-xs font-semibold text-primary">
            {items.length} 件待確認
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRevertAll}
            disabled={items.length === 0 || isReverting || isSubmitting}
            className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {isReverting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RotateCcw className="h-4 w-4" />}
            全部退回產品文案
          </button>
          <button
            onClick={handleAddToReadyToPublish}
            disabled={selected.size === 0 || isSubmitting || isReverting}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSubmitting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <CheckCheck className="h-4 w-4" />}
            加入到 準備上載{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
        </div>
      </div>

      {/* ── Info Banner ── */}
      <div className="shrink-0 border-b border-border bg-indigo-500/5 px-8 py-3">
        <div className="flex items-center gap-2 text-[12px] text-indigo-700 dark:text-indigo-400">
          <ChevronRight className="h-3.5 w-3.5" />
          <span>傢俬組確認後，勾選產品並按「加入到 準備上載」，產品將進入「準備上載」頁面等待上傳至 Shopify。點擊產品列查看詳細資料。</span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Sofa className="h-8 w-8 text-muted-foreground/40" />
            <p className="font-display text-sm text-muted-foreground">尚無待確認產品</p>
            <p className="font-body text-[12px] text-muted-foreground/70">
              到「產品信息」頁面勾選產品並按「完成」後，產品會送到此處
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-3 text-center border-b border-border/60">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={e => toggleAll(e.target.checked)}
                      className="rounded border-border"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium border-b border-border/60">產品</th>
                  <th className="px-4 py-3 text-left font-medium border-b border-border/60">廠家</th>
                  <th className="px-4 py-3 text-left font-medium border-b border-border/60">分類</th>
                  <th className="px-4 py-3 text-right font-medium border-b border-border/60">售價</th>
                  <th className="px-4 py-3 text-left font-medium border-b border-border/60">標籤</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map(row => (
                  <tr
                    key={row.rtsId}
                    className={cn(
                      'hover:bg-muted/30 cursor-pointer transition-colors',
                      selected.has(row.rtsId) && 'bg-primary/5'
                    )}
                    onClick={() => setDetailRtsId(row.rtsId)}
                  >
                    {/* Checkbox — stop propagation so row click doesn't also toggle */}
                    <td
                      className="px-4 py-3 text-center"
                      onClick={e => { e.stopPropagation(); toggleRow(row.rtsId); }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(row.rtsId)}
                        onChange={() => toggleRow(row.rtsId)}
                        className="rounded border-border"
                      />
                    </td>

                    {/* Product name + thumbnail */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {row.imageUrl ? (
                          <img
                            src={row.imageUrl}
                            alt={row.title}
                            className="h-12 w-12 shrink-0 rounded-lg object-cover bg-muted"
                            draggable={false}
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                          </div>
                        )}
                        <span className="font-body text-sm font-medium text-foreground line-clamp-2 max-w-[300px]">
                          {row.title}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span className="font-body text-sm text-muted-foreground">{row.factory}</span>
                    </td>

                    <td className="px-4 py-3">
                      <span className="font-body text-sm text-muted-foreground">{row.productType}</span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <span className="font-mono-data text-sm text-foreground">
                        {row.price != null ? `HK$${row.price.toLocaleString()}` : '—'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.tags.slice(0, 3).map(t => (
                          <span
                            key={t}
                            className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                        {row.tags.length > 3 && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">
                            +{row.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Product Detail Modal ── */}
      {detailRtsId && (
        <FGProductDetailModal
          rtsId={detailRtsId}
          onClose={() => setDetailRtsId(null)}
        />
      )}
    </div>
  );
}

import { useState, useMemo, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCheck, Search, ArrowDownToLine, ArrowUpToLine, RotateCcw, ChevronDown,
  CloudDownload, Loader2, X, Store, RefreshCw,
} from 'lucide-react';
import { PUBLISH_STATE_META, type PublishState } from '@/constants/analytics-mock';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { PublishedProductDetailModal, type PublishedDisplayProduct } from './PublishedProductDetailModal';

interface ShopifyVariant {
  id?: string | number;
  title?: string;
  option1?: string;
  option2?: string;
  option3?: string;
  sku?: string;
  price?: string | number;
  compare_at_price?: string | number | null;
  inventory_quantity?: number;
}

interface ShopifyImage {
  id?: string | number;
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  position?: number;
}

interface ShopifyPreviewProduct {
  shopify_product_id: string;
  title: string;
  body_html?: string;
  vendor: string;
  product_type: string;
  handle?: string;
  status: string;
  published_at: string | null;
  image_url: string | null;
  images?: ShopifyImage[];
  variants?: ShopifyVariant[];
  tags?: string[];
  price: number;
  compare_at_price?: number | null;
  shopify_created_at?: string | null;
  shopify_updated_at?: string | null;
  variants_count: number;
}

interface ShopifyProductRow {
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
  price: number | null;
  compare_at_price?: number | null;
  shopify_created_at?: string | null;
  shopify_updated_at: string | null;
  imported_at: string;
  shop_domain?: string | null;
  'my_fields.normal_size'?: string | null;
  'my_fields.materials'?: string | null;
}

interface DisplayProduct extends PublishedDisplayProduct {
  imageUrl: string;
  factory: string;
  publishedAt: string;
  views: number;
  lastEditor: string;
}

const STATE_FILTERS: { key: PublishState | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'published', label: '已發佈' },
  { key: 'unpublished', label: '未發佈' },
  { key: 'delisted', label: '已下架' },
];

function shopifyStatusToState(status: string | null): PublishState {
  if (status === 'active') return 'published';
  if (status === 'archived') return 'delisted';
  return 'unpublished';
}

function rowToDisplay(r: ShopifyProductRow): DisplayProduct {
  return {
    id: r.id,
    shopify_product_id: r.shopify_product_id,
    title: r.title || '(未命名)',
    imageUrl: r.image_url || '',
    factory: r.vendor || '—',
    state: shopifyStatusToState(r.status),
    publishedAt: r.published_at || r.imported_at,
    views: 0,
    lastEditor: '—',
    raw: r,
  };
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(num)) return '—';
  return `$${num.toLocaleString()}`;
}

export function PublishedProductsView() {
  const [items, setItems] = useState<DisplayProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<PublishState | 'all'>('all');
  const [factoryFilter, setFactoryFilter] = useState('全部');
  const [level1Filter, setLevel1Filter] = useState('');
  const [level2Filter, setLevel2Filter] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [detailProduct, setDetailProduct] = useState<DisplayProduct | null>(null);
  const [previewProducts, setPreviewProducts] = useState<ShopifyPreviewProduct[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importSearch, setImportSearch] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('shopify_products')
      .select('*')
      .order('imported_at', { ascending: false });
    if (error) {
      toast.error('讀取產品失敗', { description: error.message });
      setItems([]);
    } else {
      setItems((data ?? []).map(rowToDisplay));
    }
    setIsLoading(false);
  }, []);

  // Mirror-sync with Shopify: upsert all live products, delete rows whose
  // Shopify product was deleted. Keeps 已上載產品 in lock-step with the store.
  const syncMirror = useCallback(async (opts?: { silent?: boolean }) => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-sync-shopify-mirror', { body: {} });
      if (error || data?.error || data?.success === false) {
        if (!opts?.silent) toast.error('Shopify 同步失敗', { description: error?.message || data?.error || '請稍後重試' });
        return;
      }
      await loadProducts();
      if (!opts?.silent) {
        toast.success('已與 Shopify 同步', {
          description: `線上 ${data.live} 件，更新 ${data.upserted} 件${data.deleted ? `，移除已刪除 ${data.deleted} 件` : ''}`,
        });
      }
    } catch (e) {
      if (!opts?.silent) toast.error('Shopify 同步失敗', { description: e instanceof Error ? e.message : '未知錯誤' });
    } finally {
      setIsSyncing(false);
    }
  }, [loadProducts]);

  // On first load: reconcile the mirror with Shopify (silent), then show data.
  useEffect(() => {
    (async () => {
      await syncMirror({ silent: true });
      await loadProducts();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = useCallback((p: DisplayProduct) => {
    setDetailProduct(p);
  }, []);

  const filteredPreview = useMemo(() =>
    importSearch.trim()
      ? previewProducts.filter(p => p.title.toLowerCase().includes(importSearch.toLowerCase()) || p.vendor.toLowerCase().includes(importSearch.toLowerCase()))
      : previewProducts,
    [previewProducts, importSearch]
  );

  // Step 1: Fetch preview list from Shopify (no DB write)
  const handleOpenImportDialog = async () => {
    setIsFetchingPreview(true);
    const toastId = toast.loading('正在讀取 Shopify 產品列表...');
    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-sync-from-shopify', { body: { preview_only: true } });
      if (error || data?.error) {
        toast.error('無法讀取 Shopify 產品', { id: toastId, description: error?.message || data?.error, duration: 8000 });
        return;
      }
      setPreviewProducts(data.products ?? []);
      setSelectedImportIds(new Set((data.products ?? []).map((p: ShopifyPreviewProduct) => p.shopify_product_id)));
      setImportSearch('');
      setShowImportDialog(true);
      toast.dismiss(toastId);
    } catch (err) {
      toast.error('讀取失敗', { id: toastId, description: err instanceof Error ? err.message : '未知錯誤' });
    } finally {
      setIsFetchingPreview(false);
    }
  };

  // Step 2: Import selected products via edge function (basic data + metafields in batches)
  const handleConfirmImport = async () => {
    if (selectedImportIds.size === 0) { toast.error('請先選擇產品'); return; }
    setIsImporting(true);
    const productIds = Array.from(selectedImportIds);
    const toastId = toast.loading(`正在導入 ${productIds.length} 件產品...`);
    try {
      // Step A: Import basic product data via edge function
      const { data: importData, error: importErr } = await supabase.functions.invoke(
        'fetch-shopify-products',
        { body: { import: true, product_ids: productIds } }
      );
      if (importErr) throw new Error(importErr.message);
      if (importData?.error) throw new Error(importData.error);

      toast.loading(`基本資料已導入，正在抓取 Metafields...`, { id: toastId });

      // Step B: Sync metafields in batches of 10 to avoid timeout
      const BATCH = 10;
      let totalMfs = 0;
      for (let i = 0; i < productIds.length; i += BATCH) {
        const batch = productIds.slice(i, i + BATCH);
        const { data: mfData } = await supabase.functions.invoke(
          'fetch-shopify-products',
          { body: { sync_metafields: true, product_ids: batch } }
        );
        if (mfData?.total_metafields) totalMfs += mfData.total_metafields;
        if (productIds.length > BATCH) {
          toast.loading(`Metafields 進度：${Math.min(i + BATCH, productIds.length)} / ${productIds.length}`, { id: toastId });
        }
      }

      toast.success(`✅ 從 Shopify 導入完成`, {
        id: toastId,
        description: `已儲存 ${importData?.imported ?? productIds.length} 件產品，共 ${totalMfs} 個 metafield`,
        duration: 6000,
      });
      setShowImportDialog(false);
      await loadProducts();
    } catch (err) {
      toast.error('導入失敗', { id: toastId, description: err instanceof Error ? err.message : '未知錯誤' });
    } finally {
      setIsImporting(false);
    }
  };

  const toggleImportSelect = (id: string) => {
    setSelectedImportIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const factories = useMemo(
    () => ['全部', ...Array.from(new Set(items.map((p) => p.factory).filter(f => f && f !== '—')))],
    [items]
  );

  // L1/L2 category options derived from product_type ("L1 / L2") across all rows.
  const l1Options = useMemo(() => {
    const s = new Set<string>();
    items.forEach((p) => { const l1 = (p.raw.product_type || '').split(' / ')[0]?.trim(); if (l1) s.add(l1); });
    return Array.from(s);
  }, [items]);
  const l2Options = useMemo(() => {
    if (!level1Filter) return [];
    const s = new Set<string>();
    items.forEach((p) => {
      const parts = (p.raw.product_type || '').split(' / ');
      if (parts[0]?.trim() === level1Filter && parts[1]?.trim()) s.add(parts[1].trim());
    });
    return Array.from(s);
  }, [items, level1Filter]);

  const filtered = useMemo(() => items.filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      const title = p.title.toLowerCase();
      // SKU lives in variants[].sku
      const skus = Array.isArray(p.raw.variants)
        ? p.raw.variants.map((v) => (v.sku || '').toLowerCase()).join(' ')
        : '';
      if (!title.includes(q) && !skus.includes(q)) return false;
    }
    if (stateFilter !== 'all' && p.state !== stateFilter) return false;
    if (factoryFilter !== '全部' && p.factory !== factoryFilter) return false;
    if (level1Filter) {
      const parts = (p.raw.product_type || '').split(' / ');
      if (parts[0]?.trim() !== level1Filter) return false;
      if (level2Filter && parts[1]?.trim() !== level2Filter) return false;
    }
    return true;
  }), [items, search, stateFilter, factoryFilter, level1Filter, level2Filter]);

  // Page-size pagination over the filtered list.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  );
  useEffect(() => { setCurrentPage(1); }, [search, stateFilter, factoryFilter, level1Filter, level2Filter, pageSize]);

  // Call delist-from-shopify edge function to archive products in Shopify,
  // then update the local shopify_products mirror table.
  const callDelistEdgeFunction = async (shopifyProductIds: string[]): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-delist-from-shopify', {
        body: { shopify_product_ids: shopifyProductIds },
      });
      if (error) return { ok: false, error: error.message };
      if (data?.error) return { ok: false, error: data.error };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const setProductState = async (row: DisplayProduct, state: PublishState, msg: string) => {
    // If delisting, call Shopify API via edge function first
    if (state === 'delisted' && row.shopify_product_id) {
      const toastId = toast.loading('正在從 Shopify 下架...');
      const result = await callDelistEdgeFunction([row.shopify_product_id]);
      if (!result.ok) {
        toast.error('下架失敗', { id: toastId, description: result.error });
        return;
      }
      setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, state } : p)));
      toast.success(msg, { id: toastId });
      return;
    }
    // For other state changes (re-publish etc.), update local DB only
    const newStatus = state === 'published' ? 'active' : state === 'delisted' ? 'archived' : 'draft';
    const { error } = await supabase
      .from('shopify_products')
      .update({ status: newStatus })
      .eq('id', row.id);
    if (error) { toast.error('更新失敗', { description: error.message }); return; }
    setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, state } : p)));
    toast.success(msg);
  };

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkDelist = async () => {
    const ids = Array.from(selected);
    if (!ids.length) { toast.message('請先勾選產品'); return; }
    // Collect Shopify product IDs for the selected rows
    const shopifyIds = items
      .filter(p => ids.includes(p.id) && p.shopify_product_id)
      .map(p => p.shopify_product_id);
    if (!shopifyIds.length) { toast.error('選中產品沒有 Shopify Product ID，無法下架'); return; }
    const toastId = toast.loading(`正在從 Shopify 下架 ${shopifyIds.length} 件產品...`);
    const result = await callDelistEdgeFunction(shopifyIds);
    if (!result.ok) {
      toast.error('批量下架失敗', { id: toastId, description: result.error });
      return;
    }
    setItems((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, state: 'delisted' } : p));
    setSelected(new Set());
    toast.success(`已從 Shopify 下架 ${shopifyIds.length} 件產品`, { id: toastId });
  };

  const counts = {
    published: items.filter((p) => p.state === 'published').length,
    unpublished: items.filter((p) => p.state === 'unpublished').length,
    delisted: items.filter((p) => p.state === 'delisted').length,
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <CheckCheck className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">已上載產品</h2>
          <span className="font-mono-data text-[11px] text-muted-foreground">
            已發佈 {counts.published} · 未發佈 {counts.unpublished} · 已下架 {counts.delisted}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 與 Shopify 同步（鏡像）按鈕 */}
          <button
            onClick={() => syncMirror()}
            disabled={isSyncing}
            title="與 Shopify 同步：更新線上產品狀態，並移除已在 Shopify 刪除的產品"
            className="flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {isSyncing ? '同步中...' : '與 Shopify 同步'}
          </button>
          {/* 從 Shopify 導入按鈕 */}
          <button
            onClick={handleOpenImportDialog}
            disabled={isFetchingPreview}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFetchingPreview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
            {isFetchingPreview ? '讀取中...' : '從 Shopify 導入'}
          </button>
          {selected.size > 0 && (
            <button onClick={bulkDelist} className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-500/20">
              <ArrowDownToLine className="h-3.5 w-3.5" /> 批量下架（{selected.size}）
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋產品名稱或編碼 (SKU)..." className="h-8 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          {/* 每頁顯示 */}
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
            {[20, 25, 50, 100].map(n => <option key={n} value={n}>每頁 {n} 項</option>)}
          </select>
          {/* 一級分類 */}
          <select value={level1Filter} onChange={(e) => { setLevel1Filter(e.target.value); setLevel2Filter(''); }} className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
            <option value="">全部一級分類</option>
            {l1Options.map(l1 => <option key={l1} value={l1}>{l1}</option>)}
          </select>
          {/* 二級分類 */}
          <select value={level2Filter} onChange={(e) => setLevel2Filter(e.target.value)} disabled={!level1Filter} className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer disabled:opacity-50">
            <option value="">全部二級分類</option>
            {l2Options.map(l2 => <option key={l2} value={l2}>{l2}</option>)}
          </select>
          <div className="relative">
            <select value={factoryFilter} onChange={(e) => setFactoryFilter(e.target.value)} className="h-8 appearance-none rounded-lg border border-border bg-card pl-3 pr-8 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20">
              {factories.map((f) => <option key={f} value={f}>{f === '全部' ? '篩選廠家：全部' : f}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* state filter pills */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card px-6 py-2">
        {STATE_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setStateFilter(f.key)} className={cn('rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors', stateFilter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
            {f.label}
          </button>
        ))}
      </div>

      {/* table */}
      <div className="flex-1 overflow-auto p-6">
        <div className="min-w-max overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2.5 sticky left-0 bg-muted/50 z-10">
                  <input type="checkbox" className="rounded border-border" checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set())} />
                </th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[200px] sticky left-10 bg-muted/50 z-10">產品</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[140px]">描述</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[120px]">材質描述</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[110px]">標籤</th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[80px]">價格</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[80px]">變體</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[130px]">尺寸（LWH）</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[110px]">廠家</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[80px]">Factory ID</th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[70px]">成本</th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[80px]">售價</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[70px]">狀態</th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[100px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {paged.map((p) => {
                const r = p.raw;
                const variants: ShopifyVariant[] = Array.isArray(r.variants) ? r.variants : [];
                const tags: string[] = Array.isArray(r.tags) ? r.tags : [];
                const bodyText = r.body_html ? r.body_html.replace(/<[^>]*>/g, '') : '';
                const firstVariantPrice = variants[0]?.price ?? null;
                return (
                  <tr key={p.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => openDetail(p)}>
                    <td className="px-4 py-2.5 sticky left-0 bg-card z-10" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="rounded border-border" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    </td>
                    {/* 產品 */}
                    <td className="px-3 py-2.5 sticky left-10 bg-card z-10">
                      <div className="flex items-center gap-2.5">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-10 w-10 rounded-md object-cover bg-muted flex-shrink-0" />
                        ) : (
                          <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0"><Store className="h-4 w-4 text-muted-foreground/40" /></div>
                        )}
                        <span className="font-body text-[12px] font-medium text-foreground line-clamp-2 max-w-[140px]">{p.title}</span>
                      </div>
                    </td>
                    {/* 描述 */}
                    <td className="px-3 py-2.5" style={{ maxWidth: '140px' }}>
                      <div
                        className="font-body text-muted-foreground"
                        style={{
                          fontSize: '11px',
                          lineHeight: '1.4',
                          height: '92px',
                          overflow: 'hidden',
                          maxWidth: '130px',
                          wordBreak: 'break-word',
                        }}
                      >
                        {bodyText || '—'}
                      </div>
                    </td>
                    {/* 材質描述 */}
                    <td className="px-3 py-2.5">
                      {r['my_fields.materials'] ? (
                        <span className="font-body text-[11px] text-muted-foreground line-clamp-3 max-w-[110px] block">{r['my_fields.materials']}</span>
                      ) : (
                        <span className="font-body text-[11px] text-muted-foreground line-clamp-3 max-w-[110px] block">—</span>
                      )}
                    </td>
                    {/* 標籤 */}
                    <td className="px-3 py-2.5">
                      {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[100px]">
                          {tags.slice(0, 2).map((t, i) => (
                            <span key={i} className="rounded-full bg-muted px-1.5 py-0.5 font-body text-[10px] text-foreground whitespace-nowrap">{t}</span>
                          ))}
                          {tags.length > 2 && <span className="rounded-full bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">+{tags.length - 2}</span>}
                        </div>
                      ) : <span className="text-muted-foreground/50 text-[11px]">—</span>}
                    </td>
                    {/* 價格 */}
                    <td className="px-3 py-2.5 text-right font-mono-data text-[12px] font-bold text-foreground whitespace-nowrap">
                      {fmtMoney(r.price)}
                    </td>
                    {/* 變體 */}
                    <td className="px-3 py-2.5">
                      <span className="font-mono-data text-[11px] text-muted-foreground">{variants.length} 個變體</span>
                    </td>
                    {/* 尺寸 (LWH) — my_fields.normal_size */}
                    <td className="px-3 py-2.5">
                      {r['my_fields.normal_size'] ? (
                        <span className="font-mono-data text-[11px] text-muted-foreground line-clamp-3 max-w-[120px] block">{r['my_fields.normal_size']}</span>
                      ) : (
                        <span className="font-mono-data text-[11px] text-muted-foreground/50">—</span>
                      )}
                    </td>
                    {/* 廠家 */}
                    <td className="px-3 py-2.5">
                      {r.vendor ? (
                        <span className="inline-block rounded-md bg-violet-500/10 px-2 py-0.5 font-body text-[11px] text-violet-600 truncate max-w-[100px]">{r.vendor}</span>
                      ) : <span className="text-muted-foreground/50 text-[11px]">—</span>}
                    </td>
                    {/* Factory ID */}
                    <td className="px-3 py-2.5">
                      <span className="font-mono-data text-[11px] text-muted-foreground/50">—</span>
                    </td>
                    {/* 成本 */}
                    <td className="px-3 py-2.5 text-right font-mono-data text-[11px] text-muted-foreground/50">—</td>
                    {/* 售價 */}
                    <td className="px-3 py-2.5 text-right font-mono-data text-[12px] font-semibold text-emerald-600 whitespace-nowrap">
                      {fmtMoney(firstVariantPrice ?? r.compare_at_price ?? r.price)}
                    </td>
                    {/* 狀態 */}
                    <td className="px-3 py-2.5">
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap', PUBLISH_STATE_META[p.state].className)}>
                        {PUBLISH_STATE_META[p.state].label}
                      </span>
                    </td>
                    {/* 操作 */}
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        {p.state === 'published' ? (
                          <button onClick={() => setProductState(p, 'delisted', '已下架')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10 whitespace-nowrap"><ArrowDownToLine className="h-3 w-3" /> 下架</button>
                        ) : (
                          <button onClick={() => setProductState(p, 'published', '已重新上架')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-emerald-600 hover:bg-emerald-500/10 whitespace-nowrap"><ArrowUpToLine className="h-3 w-3" /> 上架</button>
                        )}
                        <button onClick={() => toast.success('已還原至上一版本')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap"><RotateCcw className="h-3 w-3" /> 還原</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={14} className="px-6 py-10 text-center text-[12px] text-muted-foreground/60">
                  {isLoading ? '載入中...' : '尚未從 Shopify 導入產品'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > pageSize && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              上一頁
            </button>
            <span className="font-mono-data text-xs text-muted-foreground">
              第 {currentPage} / {totalPages} 頁 · 共 {filtered.length} 件
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              下一頁
            </button>
          </div>
        )}
      </div>

      {/* ── Shopify Import Dialog ─────────────────────────────────────── */}
      {showImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => !isImporting && setShowImportDialog(false)}>
          <div className="relative flex flex-col bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[62rem] max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Store className="h-5 w-5 text-emerald-600" />
                <h3 className="font-display text-base font-bold">從 Shopify 導入產品</h3>
                <span className="font-mono-data text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  共 {previewProducts.length} 件 · 已選 {selectedImportIds.size} 件
                </span>
              </div>
              <button onClick={() => setShowImportDialog(false)} disabled={isImporting} className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0 bg-muted/20">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input value={importSearch} onChange={e => setImportSearch(e.target.value)} placeholder="搜尋產品名稱或廠商..." className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
            </div>

            {/* Product list */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border">
                  <tr className="text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={filteredPreview.length > 0 && filteredPreview.every(p => selectedImportIds.has(p.shopify_product_id))}
                        onChange={e => {
                          setSelectedImportIds(prev => {
                            const n = new Set(prev);
                            filteredPreview.forEach(p => e.target.checked ? n.add(p.shopify_product_id) : n.delete(p.shopify_product_id));
                            return n;
                          });
                        }}
                        className="rounded border-border"
                        title="全選"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium">產品</th>
                    <th className="px-3 py-2.5 text-left font-medium">廠商</th>
                    <th className="px-3 py-2.5 text-left font-medium">類型</th>
                    <th className="px-3 py-2.5 text-right font-medium">價格</th>
                    <th className="px-3 py-2.5 text-left font-medium">狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredPreview.map(p => (
                    <tr key={p.shopify_product_id} className={cn('hover:bg-muted/30 cursor-pointer', selectedImportIds.has(p.shopify_product_id) && 'bg-emerald-500/5')} onClick={() => toggleImportSelect(p.shopify_product_id)}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selectedImportIds.has(p.shopify_product_id)} onChange={() => toggleImportSelect(p.shopify_product_id)} onClick={e => e.stopPropagation()} className="rounded border-border" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.title} className="h-9 w-9 rounded-md object-cover bg-muted flex-shrink-0" />
                          ) : (
                            <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                              <Store className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          )}
                          <span className="font-medium text-foreground text-xs line-clamp-2 max-w-[220px]">{p.title}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.vendor || '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.product_type || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono-data text-xs">{p.price > 0 ? `$${p.price.toLocaleString()}` : '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium border',
                          p.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                          p.status === 'draft' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                          'bg-muted text-muted-foreground border-border'
                        )}>{p.status === 'active' ? '已發佈' : p.status === 'draft' ? '草稿' : '已下架'}</span>
                      </td>
                    </tr>
                  ))}
                  {filteredPreview.length === 0 && (
                    <tr><td colSpan={6} className="px-6 py-10 text-center text-xs text-muted-foreground/60">找不到符合的產品</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-muted/20 shrink-0">
              <span className="text-xs text-muted-foreground">
                已選 <span className="font-semibold text-foreground">{selectedImportIds.size}</span> / {previewProducts.length} 件產品
              </span>
              <div className="flex gap-2">
                <button onClick={() => setShowImportDialog(false)} disabled={isImporting} className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
                  取消
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={isImporting || selectedImportIds.size === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                  {isImporting ? '導入中...' : `確定導入 ${selectedImportIds.size} 件`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Product Detail Modal (FG-style layout) ─────────────────────── */}
      {detailProduct && (
        <PublishedProductDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onSaved={loadProducts}
        />
      )}
    </div>
  );
}

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCheck, Search, ArrowDownToLine, ArrowUpToLine, RotateCcw, ChevronDown,
  CloudDownload, Loader2, X, Store, RefreshCw, ArrowUp, ArrowDown, GitMerge,
} from 'lucide-react';
import { PUBLISH_STATE_META, type PublishState } from '@/constants/analytics-mock';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { PublishedProductDetailModal, type PublishedDisplayProduct } from './PublishedProductDetailModal';
import { PublishedProductMergeModal } from './PublishedProductMergeModal';

async function parseInvokeError(
  error: unknown,
  data?: { error?: string } | null,
): Promise<string> {
  if (data?.error) return data.error;
  if (!error || typeof error !== 'object') return '未知錯誤';
  const err = error as {
    message?: string;
    name?: string;
    context?: { json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  if (err.name === 'FunctionsHttpError' && err.context) {
    try {
      if (typeof err.context.json === 'function') {
        const body = await err.context.json() as { error?: string };
        if (body?.error) return body.error;
      } else if (typeof err.context.text === 'function') {
        const raw = await err.context.text();
        try {
          const body = JSON.parse(raw) as { error?: string };
          if (body?.error) return body.error;
        } catch {
          return raw.slice(0, 200);
        }
      }
    } catch { /* ignore parse errors */ }
  }
  return err.message || '未知錯誤';
}

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
  cost?: number | null;
  sku?: string | null;
  configurable?: string | null;
  shopify_page_title?: string | null;
  shopify_page_description?: string | null;
  shopify_url?: string | null;
}

interface DisplayProduct extends PublishedDisplayProduct {
  imageUrl: string;
  factory: string;
  publishedAt: string;
  views: number;
  lastEditor: string;
  costPrice: number | null;
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

function rowToDisplay(r: ShopifyProductRow, costFallback: number | null = null): DisplayProduct {
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
    costPrice: r.cost != null ? Number(r.cost) : costFallback,
    raw: r,
  };
}

function resolveProductSku(row: ShopifyProductRow): string {
  const direct = (row.sku || '').trim();
  if (direct) return direct;
  return formatVariantSkus(Array.isArray(row.variants) ? row.variants : []);
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(num)) return '—';
  return `$${num.toLocaleString()}`;
}

function formatVariantSkus(variants: ShopifyVariant[]): string {
  const skus = variants.map((v) => (v.sku || '').trim()).filter(Boolean);
  if (skus.length === 0) return '—';
  return skus.join(', ');
}

/** Primary SKU for sorting — prefers shopify_products.sku, then variants. */
function primarySortSku(row: ShopifyProductRow): string {
  const direct = (row.sku || '').trim();
  if (direct) return direct;
  return primarySortSkuFromVariants(row.variants);
}

function primarySortSkuFromVariants(variants: ShopifyVariant[] | null | undefined): string {
  const skus = (variants ?? [])
    .map((v) => (v.sku || '').trim())
    .filter(Boolean);
  if (skus.length === 0) return '';
  return skus.slice().sort(compareSkuNatural)[0];
}

/** Letters a→z, then numeric chunks 1→9 (natural / alphanumeric order). */
function compareSkuNatural(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
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
  /** Default ↑ = SKU ascending (a→z, 1→9). Click toggles to ↓ descending. */
  const [skuSortDir, setSkuSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [detailProduct, setDetailProduct] = useState<DisplayProduct | null>(null);
  const [previewProducts, setPreviewProducts] = useState<ShopifyPreviewProduct[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importSearch, setImportSearch] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [isReconcilingMirror, setIsReconcilingMirror] = useState(false);
  const [mergeProducts, setMergeProducts] = useState<DisplayProduct[]>([]);
  const [showMergeModal, setShowMergeModal] = useState(false);

  const loadProducts = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true);
    const { data, error } = await supabase
      .from('shopify_products')
      .select('*')
      .is('configurable', null)
      .order('imported_at', { ascending: false })
      .order('published_at', { ascending: false, nullsFirst: true });
    if (error) {
      toast.error('讀取產品失敗', { description: error.message });
      setItems([]);
    } else {
      const rows = data ?? [];
      const sourceIds = rows
        .map((r) => r.source_product_id)
        .filter(Boolean) as string[];
      const costByProductId: Record<string, number> = {};
      if (sourceIds.length > 0) {
        const { data: costRows } = await supabase
          .from('products')
          .select('id, cost_price')
          .in('id', sourceIds);
        costRows?.forEach((p: { id: string; cost_price: number | null }) => {
          if (p.cost_price != null) costByProductId[p.id] = Number(p.cost_price);
        });
      }
      setItems(rows.map((r) => ({
        ...rowToDisplay(
          r,
          r.source_product_id ? (costByProductId[r.source_product_id] ?? null) : null,
        ),
      })));
    }
    if (!opts?.silent) setIsLoading(false);
  }, []);

  // One-way push: update selected Shopify products from shopify_products mirror.
  // One product per edge-function call avoids relay/timeout when syncing many rows.
  const pushToShopify = useCallback(async () => {
    const selectedRows = items.filter((p) => selectedIds.includes(p.id));
    if (selectedRows.length === 0) {
      toast.message('請先勾選要同步至 Shopify 的產品');
      return;
    }
    const shopifyIds = [...new Set(
      selectedRows
        .map((p) => p.shopify_product_id)
        .filter((id) => /^\d+$/.test(id)),
    )];
    if (shopifyIds.length === 0) {
      toast.error('選中產品沒有有效的 Shopify Product ID，無法同步');
      return;
    }

    setIsSyncing(true);
    const toastId = toast.loading(`正在推送至 Shopify (0/${shopifyIds.length})…`);
    let pushed = 0;
    let failed = 0;
    let firstErr: string | undefined;

    try {
      for (let i = 0; i < shopifyIds.length; i++) {
        const id = shopifyIds[i];
        toast.loading(`正在推送至 Shopify (${i + 1}/${shopifyIds.length})…`, { id: toastId });

        const { data, error } = await supabase.functions.invoke(
          'supabase-functions-update-shopify-product',
          { body: { push_from_mirror: true, shopify_product_id: id } },
        );

        if (error || data?.error || data?.success === false) {
          failed++;
          if (!firstErr) firstErr = await parseInvokeError(error, data);
        } else {
          pushed++;
        }
      }

      if (pushed > 0) await loadProducts({ silent: true });

      if (failed > 0 && pushed > 0) {
        toast.warning('部分產品推送失敗', {
          id: toastId,
          description: `成功 ${pushed} 件 · 失敗 ${failed} 件${firstErr ? ` — ${firstErr.slice(0, 120)}` : ''}`,
          duration: 8000,
        });
      } else if (failed > 0) {
        toast.error('推送到 Shopify 失敗', {
          id: toastId,
          description: firstErr || '請稍後重試',
          duration: 8000,
        });
      } else {
        toast.success('已推送至 Shopify', {
          id: toastId,
          description: `已更新 ${pushed} 件現有產品（含 SEO）`,
          duration: 6000,
        });
      }
    } catch (e) {
      toast.error('推送到 Shopify 失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [items, selectedIds, loadProducts]);

  /** Pull live Shopify catalog → shopify_products mirror (reconcile + remove deleted). */
  const reconcileMirrorFromShopify = useCallback(async () => {
    setIsReconcilingMirror(true);
    const toastId = toast.loading('正在從 Shopify 同步產品目錄…');
    try {
      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-sync-shopify-mirror',
        { body: {} },
      );
      if (error || data?.error || data?.success === false) {
        toast.error('同步失敗', {
          id: toastId,
          description: await parseInvokeError(error, data),
          duration: 8000,
        });
        return;
      }
      await loadProducts({ silent: true });
      toast.success('已更新 Shopify 目錄', {
        id: toastId,
        description: `Shopify ${data.live ?? '?'} 件 · 更新 ${data.upserted ?? 0} 件 · 移除 ${data.deleted ?? 0} 件`,
        duration: 8000,
      });
    } catch (e) {
      toast.error('同步失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
      });
    } finally {
      setIsReconcilingMirror(false);
    }
  }, [loadProducts]);

  useEffect(() => {
    void loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = useCallback((p: DisplayProduct) => {
    setDetailProduct(p);
  }, []);

  const openMergeModal = useCallback(() => {
    if (selectedIds.length < 2) {
      toast.message('請至少勾選 2 件產品進行合併（最先勾選的為主產品）');
      return;
    }
    const ordered = selectedIds
      .map((id) => items.find((p) => p.id === id))
      .filter((p): p is DisplayProduct => Boolean(p));
    if (ordered.length < 2) return;
    setMergeProducts(ordered);
    setShowMergeModal(true);
  }, [selectedIds, items]);

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
      setSelectedImportIds(new Set());
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
      const skuHay = resolveProductSku(p.raw).toLowerCase();
      if (!title.includes(q) && !skuHay.includes(q)) return false;
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

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const cmp = compareSkuNatural(
        primarySortSku(a.raw),
        primarySortSku(b.raw),
      );
      return skuSortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, skuSortDir]);

  // Page-size pagination over the sorted list.
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = useMemo(
    () => sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sorted, currentPage, pageSize]
  );
  useEffect(() => { setCurrentPage(1); }, [search, stateFilter, factoryFilter, level1Filter, level2Filter, pageSize, skuSortDir]);

  // Only drop selections when the product row no longer exists (e.g. deleted), not when filtered out by search.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.length === 0) return prev;
      const allIds = new Set(items.map((p) => p.id));
      const next = prev.filter((id) => allIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [items]);

  const selectedSkuChips = useMemo(
    () => selectedIds.map((id) => {
      const product = items.find((p) => p.id === id);
      return {
        id,
        sku: product ? resolveProductSku(product.raw) : id.slice(0, 8),
      };
    }),
    [selectedIds, items],
  );

  const pageAllSelected = paged.length > 0 && paged.every((p) => selectedIds.includes(p.id));
  const pageSomeSelected = paged.some((p) => selectedIds.includes(p.id)) && !pageAllSelected;
  const selectionSpansPages = useMemo(() => {
    if (selectedIds.length === 0) return false;
    const pageIdSet = new Set(paged.map((p) => p.id));
    return selectedIds.some((id) => !pageIdSet.has(id));
  }, [selectedIds, paged]);

  const pageSelectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pageSelectAllRef.current) {
      pageSelectAllRef.current.indeterminate = pageSomeSelected;
    }
  }, [pageSomeSelected]);

  const togglePageSelectAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        const next = [...prev];
        for (const p of paged) {
          if (!next.includes(p.id)) next.push(p.id);
        }
        return next;
      }
      const pageIdSet = new Set(paged.map((p) => p.id));
      return prev.filter((id) => !pageIdSet.has(id));
    });
  };

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

  const toggle = (id: string) => setSelectedIds((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  ));

  const bulkDelist = async () => {
    const ids = [...selectedIds];
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
    setSelectedIds([]);
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
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/30 px-6 py-3">
        {/* Row 1: title + action buttons */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCheck className="h-4 w-4 shrink-0 text-primary" />
            <h2 className="font-display text-sm font-bold shrink-0">已上載產品</h2>
            <span className="font-mono-data text-[11px] text-muted-foreground truncate">
              已發佈 {counts.published} · 未發佈 {counts.unpublished} · 已下架 {counts.delisted}
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => reconcileMirrorFromShopify()}
              disabled={isReconcilingMirror}
              title="從 Shopify 讀取最新產品目錄，更新本頁列表，並移除 Shopify 已刪除的產品（含合併後的子產品）"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isReconcilingMirror ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Store className="h-3.5 w-3.5" />}
              {isReconcilingMirror ? '同步中...' : '更新 Shopify 目錄'}
            </button>
            <button
              type="button"
              onClick={() => pushToShopify()}
              disabled={isSyncing}
              title="將已勾選產品的 Supabase 資料推送至 Shopify，更新現有產品（標題、描述、SEO、價格、Metafields 等）"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-700 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {isSyncing ? '推送中...' : selectedIds.length > 0 ? `與 Shopify 同步 (${selectedIds.length})` : '與 Shopify 同步'}
            </button>
            <button
              type="button"
              onClick={handleOpenImportDialog}
              disabled={isFetchingPreview}
              title="從 Shopify 導入產品資料至 Supabase，更新本頁列表（標題、描述、價格、Metafields 等）。不會推送至 Shopify。"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFetchingPreview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
              {isFetchingPreview ? '讀取中...' : '從 Shopify 導入'}
            </button>
            <button
              type="button"
              onClick={bulkDelist}
              disabled={selectedIds.length === 0}
              title={selectedIds.length > 0 ? `批量下架 ${selectedIds.length} 件產品` : '請先勾選要下架的產品'}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              {selectedIds.length > 0 ? `批量下架（${selectedIds.length}）` : '批量下架'}
            </button>
            <button
              type="button"
              onClick={openMergeModal}
              disabled={selectedIds.length < 2}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                selectedIds.length >= 2
                  ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                  : 'border-border text-muted-foreground hover:bg-muted/50',
              )}
              title={selectedIds.length >= 2 ? '合併所選產品為多規格（最先勾選的為主產品）' : '請至少勾選 2 件產品'}
            >
              <GitMerge className="h-3.5 w-3.5" />
              合併產品
            </button>
          </div>
        </div>

        {/* Row 2: search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋產品名稱或編碼 (SKU)..."
              className="h-8 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
          >
            {[20, 25, 50, 100].map(n => <option key={n} value={n}>每頁 {n} 項</option>)}
          </select>
          <select
            value={level1Filter}
            onChange={(e) => { setLevel1Filter(e.target.value); setLevel2Filter(''); }}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
          >
            <option value="">全部一級分類</option>
            {l1Options.map(l1 => <option key={l1} value={l1}>{l1}</option>)}
          </select>
          <select
            value={level2Filter}
            onChange={(e) => setLevel2Filter(e.target.value)}
            disabled={!level1Filter}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer disabled:opacity-50"
          >
            <option value="">全部二級分類</option>
            {l2Options.map(l2 => <option key={l2} value={l2}>{l2}</option>)}
          </select>
          <div className="relative">
            <select
              value={factoryFilter}
              onChange={(e) => setFactoryFilter(e.target.value)}
              className="h-8 appearance-none rounded-lg border border-border bg-card pl-3 pr-8 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {factories.map((f) => <option key={f} value={f}>{f === '全部' ? '篩選廠家：全部' : f}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* state filter pills + selection summary */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-6 py-2">
        <div className="flex items-center gap-1.5">
          {STATE_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setStateFilter(f.key)} className={cn('rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors', stateFilter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
              {f.label}
            </button>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <span className="shrink-0 font-mono-data text-[11px] text-muted-foreground">
            已選 <span className="font-semibold text-foreground">{selectedIds.length}</span> 件
            {selectionSpansPages && <span className="text-primary">（含跨頁）</span>}
          </span>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-6 py-2.5">
          <span className="shrink-0 font-body text-[10px] font-medium text-muted-foreground">
            已選 SKU
          </span>
          {selectedSkuChips.map(({ id, sku }) => (
            <span
              key={id}
              className="relative inline-flex max-w-[160px] items-center rounded-md border border-primary/30 bg-primary/5 pl-2 pr-6 py-1"
            >
              <span className="truncate font-mono-data text-[11px] text-foreground" title={sku}>
                {sku}
              </span>
              <button
                type="button"
                onClick={() => toggle(id)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
                title="取消選取"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* table */}
      <div className="flex-1 overflow-auto p-6">
        <div className="min-w-max overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2.5 sticky left-0 bg-muted/50 z-10">
                  <input
                    ref={pageSelectAllRef}
                    type="checkbox"
                    className="rounded border-border"
                    title="全選本頁"
                    checked={pageAllSelected}
                    onChange={(e) => togglePageSelectAll(e.target.checked)}
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[200px] sticky left-10 bg-muted/50 z-10">產品</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[140px]">描述</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[120px]">材質描述</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[110px]">標籤</th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[80px]">價格</th>
                <th className="px-3 py-2.5 text-right font-medium min-w-[70px]">成本</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[80px]">變體</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[130px]">尺寸（LWH）</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[110px]">廠家</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[80px]">Factory ID</th>
                <th className="px-3 py-2.5 text-left font-medium min-w-[100px]">
                  <button
                    type="button"
                    onClick={() => setSkuSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    title={skuSortDir === 'asc' ? 'SKU 升序（A→Z，1→9）' : 'SKU 降序（Z→A，9→1）'}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    SKU
                    {skuSortDir === 'asc' ? (
                      <ArrowUp className="h-3 w-3 text-primary" />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-primary" />
                    )}
                  </button>
                </th>
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
                const skuText = resolveProductSku(r);
                return (
                  <tr key={p.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => openDetail(p)}>
                    <td className="px-4 py-2.5 sticky left-0 bg-card z-10" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="rounded border-border" checked={selectedIds.includes(p.id)} onChange={() => toggle(p.id)} />
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
                    {/* 材質描述 — list view capped at 4 lines; full text in detail modal */}
                    <td className="px-3 py-2.5 align-top overflow-hidden" style={{ maxWidth: '120px' }}>
                      {r['my_fields.materials'] ? (
                        <div
                          className="font-body text-[11px] text-muted-foreground break-words overflow-hidden"
                          style={{
                            lineHeight: 1.35,
                            maxHeight: 'calc(11px * 1.35 * 4)',
                            display: '-webkit-box',
                            WebkitLineClamp: 4,
                            WebkitBoxOrient: 'vertical',
                          }}
                          title={r['my_fields.materials']}
                        >
                          {r['my_fields.materials']}
                        </div>
                      ) : (
                        <span className="font-body text-[11px] text-muted-foreground">—</span>
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
                    {/* 成本 */}
                    <td className="px-3 py-2.5 text-right font-mono-data text-[11px] text-muted-foreground whitespace-nowrap">
                      {fmtMoney(p.costPrice)}
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
                    {/* SKU — from shopify_products.variants[].sku */}
                    <td className="px-3 py-2.5">
                      <span className="font-mono-data text-[11px] text-foreground line-clamp-2 max-w-[120px] block" title={skuText}>
                        {skuText}
                      </span>
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
              {sorted.length === 0 && (
                <tr><td colSpan={14} className="px-6 py-10 text-center text-[12px] text-muted-foreground/60">
                  {isLoading ? '載入中...' : '尚未從 Shopify 導入產品'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {sorted.length > pageSize && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              上一頁
            </button>
            <span className="font-mono-data text-xs text-muted-foreground">
              第 {currentPage} / {totalPages} 頁 · 共 {sorted.length} 件
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

      <PublishedProductMergeModal
        products={mergeProducts}
        open={showMergeModal}
        onOpenChange={(open) => {
          setShowMergeModal(open);
          if (!open) setMergeProducts([]);
        }}
        onMerged={() => {
          setSelectedIds([]);
          void loadProducts({ silent: true });
        }}
      />
    </div>
  );
}

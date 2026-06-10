import { useState, useMemo, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCheck, Search, ArrowDownToLine, ArrowUpToLine, RotateCcw, Eye, ChevronDown,
  CloudDownload, Loader2, X, Store,
} from 'lucide-react';
import { PUBLISH_STATE_META, type PublishState } from '@/constants/analytics-mock';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

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
}

interface DisplayProduct {
  id: string;
  shopify_product_id: string;
  title: string;
  imageUrl: string;
  factory: string;
  state: PublishState;
  publishedAt: string;
  views: number;
  lastEditor: string;
  raw: ShopifyProductRow;
}

const STATE_FILTERS: { key: PublishState | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'published', label: '已發佈' },
  { key: 'unpublished', label: '未發佈' },
  { key: 'delisted', label: '已下架' },
];

function fmtDate(d: string) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '—';
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
}

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

function variantLabel(v: ShopifyVariant): string {
  const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(' / ');
  return opts || v.title || 'Default';
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [detailProduct, setDetailProduct] = useState<DisplayProduct | null>(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [previewProducts, setPreviewProducts] = useState<ShopifyPreviewProduct[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importSearch, setImportSearch] = useState('');

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

  useEffect(() => { loadProducts(); }, [loadProducts]);

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

  // Step 2: Upsert selected products into shopify_products table
  const handleConfirmImport = async () => {
    if (selectedImportIds.size === 0) { toast.error('請先選擇產品'); return; }
    setIsImporting(true);
    const toastId = toast.loading(`正在導入 ${selectedImportIds.size} 件產品...`);
    try {
      const now = new Date().toISOString();
      const rows = previewProducts
        .filter(p => selectedImportIds.has(p.shopify_product_id))
        .map(p => ({
          shopify_product_id: p.shopify_product_id,
          title: p.title,
          body_html: p.body_html || null,
          vendor: p.vendor || null,
          product_type: p.product_type || null,
          handle: p.handle || null,
          status: p.status || null,
          published_at: p.published_at,
          image_url: p.image_url,
          images: p.images ?? [],
          variants: p.variants ?? [],
          tags: p.tags ?? [],
          price: p.price || null,
          compare_at_price: p.compare_at_price ?? null,
          shopify_created_at: p.shopify_created_at ?? null,
          shopify_updated_at: p.shopify_updated_at ?? null,
          imported_at: now,
        }));

      const { error } = await supabase
        .from('shopify_products')
        .upsert(rows, { onConflict: 'shopify_product_id' });

      if (error) {
        toast.error('導入失敗', { id: toastId, description: error.message, duration: 8000 });
        return;
      }
      toast.success(`✅ 從 Shopify 導入完成`, {
        id: toastId,
        description: `已儲存 ${rows.length} 件產品至 shopify_products`,
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

  const filtered = useMemo(() => items.filter((p) => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (stateFilter !== 'all' && p.state !== stateFilter) return false;
    if (factoryFilter !== '全部' && p.factory !== factoryFilter) return false;
    return true;
  }), [items, search, stateFilter, factoryFilter]);

  const setProductState = async (row: DisplayProduct, state: PublishState, msg: string) => {
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
    const { error } = await supabase.from('shopify_products').update({ status: 'archived' }).in('id', ids);
    if (error) { toast.error('批量下架失敗', { description: error.message }); return; }
    setItems((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, state: 'delisted' } : p));
    setSelected(new Set());
    toast.success(`已下架 ${ids.length} 件產品`);
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
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋產品..." className="h-8 w-44 rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="relative">
            <select value={factoryFilter} onChange={(e) => setFactoryFilter(e.target.value)} className="h-8 appearance-none rounded-lg border border-border bg-card pl-3 pr-8 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20">
              {factories.map((f) => <option key={f} value={f}>{f === '全部' ? '廠家：全部' : f}</option>)}
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
        <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2.5"><input type="checkbox" className="rounded border-border" checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set())} /></th>
                <th className="px-3 py-2.5 text-left font-medium">產品</th>
                <th className="px-3 py-2.5 text-left font-medium">廠家</th>
                <th className="px-3 py-2.5 text-left font-medium">狀態</th>
                <th className="px-3 py-2.5 text-left font-medium">上架時間</th>
                <th className="px-3 py-2.5 text-right font-medium">瀏覽</th>
                <th className="px-3 py-2.5 text-left font-medium">最後修改</th>
                <th className="px-3 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => { setDetailProduct(p); setActiveImageIdx(0); }}>
                  <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}><input type="checkbox" className="rounded border-border" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-10 w-10 rounded-md object-cover bg-muted" />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center"><Store className="h-4 w-4 text-muted-foreground/40" /></div>
                      )}
                      <span className="font-body text-[13px] font-medium text-foreground">{p.title}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{p.factory}</td>
                  <td className="px-3 py-2.5"><span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium', PUBLISH_STATE_META[p.state].className)}>{PUBLISH_STATE_META[p.state].label}</span></td>
                  <td className="px-3 py-2.5 font-mono-data text-[11.5px] text-muted-foreground">{fmtDate(p.publishedAt)}</td>
                  <td className="px-3 py-2.5 text-right font-mono-data text-foreground"><span className="inline-flex items-center gap-1"><Eye className="h-3 w-3 text-muted-foreground" />{p.views.toLocaleString()}</span></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{p.lastEditor}</td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      {p.state === 'published' ? (
                        <button onClick={() => setProductState(p, 'delisted', '已下架')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-rose-500 hover:bg-rose-500/10"><ArrowDownToLine className="h-3 w-3" /> 下架</button>
                      ) : (
                        <button onClick={() => setProductState(p, 'published', '已重新上架')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-emerald-600 hover:bg-emerald-500/10"><ArrowUpToLine className="h-3 w-3" /> 上架</button>
                      )}
                      <button onClick={() => toast.success('已還原至上一版本')} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"><RotateCcw className="h-3 w-3" /> 還原</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-[12px] text-muted-foreground/60">
                  {isLoading ? '載入中...' : '尚未從 Shopify 導入產品'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
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

      {/* ── Product Detail Dialog ─────────────────────────────────────── */}
      {detailProduct && (() => {
        const r = detailProduct.raw;
        const imgs: ShopifyImage[] = Array.isArray(r.images) ? r.images : [];
        const variants: ShopifyVariant[] = Array.isArray(r.variants) ? r.variants : [];
        const heroImage = imgs[activeImageIdx]?.src || r.image_url || '';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setDetailProduct(null)}>
            <div className="relative flex flex-col bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[72rem] max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <Store className="h-5 w-5 text-primary" />
                  <h3 className="font-display text-base font-bold">產品詳情</h3>
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium', PUBLISH_STATE_META[detailProduct.state].className)}>
                    {PUBLISH_STATE_META[detailProduct.state].label}
                  </span>
                </div>
                <button onClick={() => setDetailProduct(null)} className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
                  {/* Left: images */}
                  <div className="flex flex-col gap-3">
                    <div className="aspect-square w-full bg-muted rounded-xl overflow-hidden flex items-center justify-center">
                      {heroImage ? (
                        <img src={heroImage} alt={r.title || ''} className="w-full h-full object-cover" />
                      ) : (
                        <Store className="h-12 w-12 text-muted-foreground/40" />
                      )}
                    </div>
                    {imgs.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        {imgs.map((im, idx) => (
                          <button
                            key={im.id ?? idx}
                            onClick={() => setActiveImageIdx(idx)}
                            className={cn('h-14 w-14 rounded-md overflow-hidden border-2 transition-colors',
                              idx === activeImageIdx ? 'border-primary' : 'border-transparent hover:border-border')}
                          >
                            {im.src ? <img src={im.src} alt="" className="w-full h-full object-cover" /> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right: info */}
                  <div className="flex flex-col gap-5">
                    {/* Title block */}
                    <div>
                      <h2 className="font-display text-xl font-bold text-foreground leading-snug">{r.title || '(未命名)'}</h2>
                      {r.handle && <p className="font-mono-data text-xs text-muted-foreground mt-1">/{r.handle}</p>}
                    </div>

                    {/* Price */}
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono-data text-2xl font-bold text-emerald-600">{fmtMoney(r.price)}</span>
                      {r.compare_at_price && Number(r.compare_at_price) > Number(r.price ?? 0) && (
                        <span className="font-mono-data text-sm text-muted-foreground line-through">{fmtMoney(r.compare_at_price)}</span>
                      )}
                    </div>

                    {/* 分類 */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <DetailField label="廠商" value={r.vendor} />
                      <DetailField label="產品分類" value={r.product_type} />
                      <DetailField label="Shopify ID" value={r.shopify_product_id} mono />
                      <DetailField label="狀態" value={r.status} />
                      <DetailField label="上架時間" value={r.published_at ? fmtDate(r.published_at) : null} />
                      <DetailField label="導入時間" value={fmtDate(r.imported_at)} />
                      {r.shopify_created_at && <DetailField label="Shopify 建立" value={fmtDate(r.shopify_created_at)} />}
                      {r.shopify_updated_at && <DetailField label="Shopify 更新" value={fmtDate(r.shopify_updated_at)} />}
                      {r.shop_domain && <DetailField label="店舖" value={r.shop_domain} mono />}
                    </div>

                    {/* Tags */}
                    {Array.isArray(r.tags) && r.tags.length > 0 && (
                      <div>
                        <h4 className="font-display text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">標籤</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {r.tags.map((t, i) => (
                            <span key={i} className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-foreground">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Variants */}
                    {variants.length > 0 && (
                      <div>
                        <h4 className="font-display text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                          規格 / Variants（{variants.length}）
                        </h4>
                        <div className="rounded-lg border border-border overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/40 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium">規格</th>
                                <th className="px-3 py-2 text-left font-medium">SKU</th>
                                <th className="px-3 py-2 text-right font-medium">價錢</th>
                                <th className="px-3 py-2 text-right font-medium">庫存</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {variants.map((v, i) => (
                                <tr key={v.id ?? i} className="hover:bg-muted/30">
                                  <td className="px-3 py-2 font-medium text-foreground">{variantLabel(v)}</td>
                                  <td className="px-3 py-2 font-mono-data text-muted-foreground">{v.sku || '—'}</td>
                                  <td className="px-3 py-2 text-right font-mono-data">{fmtMoney(v.price ?? null)}</td>
                                  <td className="px-3 py-2 text-right font-mono-data text-muted-foreground">{v.inventory_quantity ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Description */}
                    {r.body_html && (
                      <div>
                        <h4 className="font-display text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">產品描述</h4>
                        <div
                          className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground/90 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5"
                          dangerouslySetInnerHTML={{ __html: r.body_html }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-muted/20 shrink-0">
                <button onClick={() => setDetailProduct(null)} className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted transition-colors">關閉</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div className={cn('text-foreground font-medium break-all', mono && 'font-mono-data text-[11px]')}>
        {value || <span className="text-muted-foreground/50">—</span>}
      </div>
    </>
  );
}

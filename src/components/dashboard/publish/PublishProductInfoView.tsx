import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  Boxes, Check, ChevronLeft, ChevronRight, Loader2, Tag, Ruler, DollarSign, Truck, FolderTree, X, ZoomIn,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { usePublishList } from './usePublishList';

type ProductionType = 'stock' | 'custom' | null;

const LEAD_TIME_OPTIONS = ['3-7天', '8-15天', '16-25天', '26-40天', '41天以上'] as const;

interface InfoItem {
  id: string;
  title: string;
  imageUrl: string;
  factory: string;
  price: number;
  costPrice: number | null;
  // cost from ready_to_shopify.cost — read-only reference
  costRef: number | null;
  dimL: number | null;
  dimW: number | null;
  dimH: number | null;
  sku: string;
  tags: string[];
  level1: string;
  level2: string;
  productionType: ProductionType;
  leadTime: string;
  // 產品物料 → ready_to_shopify."my_fields.materials"
  materials: string;
}

interface Props {
  focusProductId?: string | null;
  onFocusHandled?: () => void;
  onComplete?: () => void;
}

export function PublishProductInfoView({ focusProductId, onFocusHandled, onComplete }: Props) {
  const [items, setItems] = useState<InfoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // bwf_product_categories for tag picker
  const [bwfCats, setBwfCats] = useState<{ id: string; name: string; parent_id: string | null; level: number; sort_order: number }[]>([]);
  useEffect(() => {
    supabase
      .from('bwf_product_categories')
      .select('id,name,parent_id,level,sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data }) => { if (data) setBwfCats(data); });
  }, []);

  // Load level1/level2 category pairs from product_category for the dropdowns
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('product_category')
        .select('level1, level2, sort_order')
        .order('sort_order', { ascending: true });
      if (!cancelled && data) {
        setCategoryPairs(
          data
            .map((r: any) => ({ level1: String(r.level1 ?? '').trim(), level2: String(r.level2 ?? '').trim() }))
            .filter((p) => p.level1)
        );
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const level1Options = Array.from(new Set(categoryPairs.map((p) => p.level1)));
  const getLevel2Options = (l1: string) =>
    Array.from(new Set(categoryPairs.filter((p) => p.level1 === l1 && p.level2).map((p) => p.level2)));

  const { rows, totalCount, isLoading, Toolbar, Pagination } = usePublishList({
    select: 'id,title,image_url,price,sale_price,cost_price,sku,tags,dimension_l_mm,dimension_w_mm,dimension_h_mm,level1_category,level2_category,in_stock,customize,model,factories_display_name',
    applyBaseFilters: (q) => q.eq('in_shopify_queue', true).eq('info_done', false).eq('copy_done', true),
    reloadKey,
    // Newest submissions from 產品文案 appear first.
    orderBy: [
      { column: 'copy_done_at', ascending: false, nullsFirst: false },
      { column: 'created_at', ascending: false },
    ],
  });

  // Fetch cost + image_url + images + materials from ready_to_shopify for each product
  const [costMap, setCostMap] = useState<Record<string, number | null>>({});
  const [rtsImageMap, setRtsImageMap] = useState<Record<string, string>>({});
  const [rtsImagesMap, setRtsImagesMap] = useState<Record<string, { src: string; alt: string }[]>>({});
  const [materialsMap, setMaterialsMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (rows.length === 0) return;
    const ids = rows.map((r: any) => r.id);
    supabase
      .from('ready_to_shopify')
      .select('product_id, cost, image_url, images, material, "my_fields.materials"')
      .in('product_id', ids)
      .then(({ data }) => {
        if (!data) return;
        const costM: Record<string, number | null> = {};
        const imgM: Record<string, string> = {};
        const imgsM: Record<string, { src: string; alt: string }[]> = {};
        const matM: Record<string, string> = {};
        for (const row of data as any[]) {
          costM[row.product_id] = row.cost != null ? Number(row.cost) : null;
          if (row.image_url) imgM[row.product_id] = row.image_url;
          // Prefer the dedicated metafield column; fall back to legacy `material`
          matM[row.product_id] = (row['my_fields.materials'] ?? row.material ?? '') || '';
          if (Array.isArray(row.images) && row.images.length > 0) {
            imgsM[row.product_id] = row.images.map((img: any) => ({
              src: img?.src || img?.url || (typeof img === 'string' ? img : ''),
              alt: img?.alt || '',
            })).filter((img: { src: string; alt: string }) => img.src && img.src !== row.image_url);
          }
        }
        setCostMap(costM);
        setRtsImageMap(imgM);
        setRtsImagesMap(imgsM);
        setMaterialsMap(matM);
      });
  }, [rows]);

  // Lightbox state for enlarged image
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // 把唯讀的 rows 轉成本頁可編輯的 items 副本（換頁/篩選/重載時重置）
  useEffect(() => {
    const mapped: InfoItem[] = rows.map((r: any) => {
      let productionType: ProductionType = null;
      let leadTime = '';
      if (r.in_stock === true) {
        productionType = 'stock';
      } else if (r.customize) {
        productionType = 'custom';
        leadTime = r.customize;
      }
      return {
        id: r.id,
        title: r.title || '',
        imageUrl: r.image_url || '',
        factory: r.factories_display_name || '',
        price: Number(r.sale_price ?? r.price ?? 0),
        costPrice: r.cost_price != null ? Number(r.cost_price) : null,
        costRef: costMap[r.id] ?? (r.cost_price != null ? Number(r.cost_price) : null),
        dimL: r.dimension_l_mm ?? null,
        dimW: r.dimension_w_mm ?? null,
        dimH: r.dimension_h_mm ?? null,
        sku: r.sku || r.model || '',
        tags: Array.isArray(r.tags) ? r.tags : [],
        level1: r.level1_category || '',
        level2: r.level2_category || '',
        productionType,
        leadTime,
        materials: materialsMap[r.id] ?? '',
      };
    });
    setItems(mapped);
    setSelected(new Set());
  }, [rows, costMap, materialsMap]);

  // Scroll to the focused product once items are loaded
  useEffect(() => {
    if (!focusProductId || items.length === 0) return;
    const el = cardRefs.current[focusProductId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary/40');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary/40'), 2000);
      onFocusHandled?.();
    }
  }, [focusProductId, items]);

  const patch = (id: string, p: Partial<InfoItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // 退回上一步 — dialog state
  const REVERT_OPTIONS = ['產品情景圖修改', '產品圖片角度不足', '產品說明修正', '其他'] as const;
  const [showRevertDialog, setShowRevertDialog] = useState(false);
  const [revertReasons, setRevertReasons] = useState<string[]>([]);
  const [revertOther, setRevertOther] = useState('');
  const [isReverting, setIsReverting] = useState(false);

  const handleRevert = () => {
    if (selected.size === 0) { toast.message('請先勾選產品'); return; }
    setRevertReasons([]);
    setRevertOther('');
    setShowRevertDialog(true);
  };

  const handleConfirmRevert = async () => {
    if (revertReasons.length === 0 && !revertOther.trim()) return;
    const ids = Array.from(selected);
    setIsReverting(true);
    try {
      const revertReason = { labels: revertReasons, other: revertOther.trim() || null };
      const { error } = await supabase
        .from('products')
        .update({
          copy_done: false,
          copy_done_at: null,
          copy_queued_at: new Date().toISOString(),
          info_done: false,
          ready_to_publish: false,
          revert_reason: revertReason,
        })
        .in('id', ids);
      if (error) throw new Error(error.message);
      // Keep the ready_to_shopify rows intact (do NOT delete) so body_html /
      // images / SEO survive the revert. Reset furniture_group_checked to null
      // so the rows leave 傢俬組檢查 (=false) and 準備上載 (=true); the product
      // returns to 產品文案 purely via the products.copy_done=false flag above.
      const { error: rtsErr } = await supabase
        .from('ready_to_shopify')
        .update({ furniture_group_checked: null })
        .in('product_id', ids);
      if (rtsErr) throw new Error(rtsErr.message);
      setShowRevertDialog(false);
      setSelected(new Set());
      setReloadKey((k) => k + 1);
      toast.success(`已退回 ${ids.length} 件產品至「產品文案」`, {
        description: revertReason?.labels.length ? `原因：${revertReason.labels.join('、')}` : undefined,
      });
    } catch (e) {
      toast.error('退回失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsReverting(false);
    }
  };

  // Shared write: pushes one item's edited fields to BOTH products and
  // ready_to_shopify. `advance` = true means this is part of 「完成」 → also
  // flips info_done / ready_to_publish / furniture_group_checked to push the
  // product into 傢俬組檢查. `advance` = false (single 儲存) only persists data.
  const writeProductInfo = async (it: InfoItem, advance: boolean) => {
    const isStock = it.productionType === 'stock';
    const customizeVal = it.productionType === 'custom' && it.leadTime ? it.leadTime : null;

    // 1. products table
    const productsUpdate: Record<string, any> = {
      sale_price: it.price,
      sku: it.sku,
      tags: it.tags,
      dimension_l_mm: it.dimL,
      dimension_w_mm: it.dimW,
      dimension_h_mm: it.dimH,
      level1_category: it.level1 || null,
      level2_category: it.level2 || null,
      in_stock: it.productionType === 'stock' ? true : false,
      customize: customizeVal,
    };
    if (advance) {
      productsUpdate.info_done = true;
      // Go to 傢俬組檢查 first, not directly to 準備上載
      productsUpdate.ready_to_publish = false;
    }
    const { error } = await supabase.from('products').update(productsUpdate).eq('id', it.id);
    if (error) throw new Error(error.message);

    // 2. ready_to_shopify — mirror every editable field
    const rtsUpdate: Record<string, any> = {
      // 產品編碼 (SKU) → sku column
      sku: it.sku || null,
      // 產品價錢 → price
      price: it.price,
      // 產品標籤 → tags
      tags: it.tags.length > 0 ? it.tags : null,
      // 產品分類（一級 / 二級）→ product_type
      product_type: [it.level1, it.level2].filter(Boolean).join(' / ') || null,
      // 產品尺寸（長 / 闊 / 高）→ dimension_*_mm
      dimension_l_mm: it.dimL,
      dimension_w_mm: it.dimW,
      dimension_h_mm: it.dimH,
      // 送貨資訊（現貨 / 全訂製 + 交期）→ in_stock + customize
      in_stock: isStock ? true : (it.productionType === 'custom' ? false : null),
      customize: customizeVal,
      // 產品物料 → my_fields.materials (also keep legacy `material` in sync)
      'my_fields.materials': it.materials.trim() || null,
      material: it.materials.trim() || null,
    };
    if (advance) {
      // false = waiting in 傢俬組檢查; true = cleared for 準備上載
      rtsUpdate.furniture_group_checked = false;
      rtsUpdate.info_completed_at = new Date().toISOString();
      if (isStock || customizeVal != null) rtsUpdate.status = 'draft';
    }
    const { error: rtsErr } = await supabase
      .from('ready_to_shopify')
      .update(rtsUpdate)
      .eq('product_id', it.id);
    if (rtsErr) throw new Error(rtsErr.message);
  };

  const [isSaving, setIsSaving] = useState(false);
  // Per-product 儲存 — persists data only, keeps product on this page.
  const [savingId, setSavingId] = useState<string | null>(null);
  const handleSaveOne = async (id: string) => {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    setSavingId(id);
    try {
      await writeProductInfo(it, false);
      toast.success('已儲存', { description: '產品資料已同步至資料庫' });
    } catch (e) {
      toast.error('儲存失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setSavingId(null);
    }
  };

  const handleComplete = async () => {
    if (selected.size === 0) { toast.message('請先勾選產品'); return; }
    const ids = Array.from(selected);
    setIsSaving(true);
    try {
      for (const id of ids) {
        const it = items.find((x) => x.id === id);
        if (!it) continue;
        await writeProductInfo(it, true);
      }
      setSelected(new Set());
      setReloadKey((k) => k + 1);
      toast.success('已送往傢俬組檢查', { description: `${ids.length} 件產品的資訊已儲存，請到「傢俬組檢查」頁面確認後加入準備上載` });
      onComplete?.();
    } catch (e) {
      toast.error('儲存失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-8 py-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">產品信息</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-primary">
            {totalCount} 件待補充
          </span>
          {selected.size > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-emerald-600">已選 {selected.size}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRevert}
            disabled={selected.size === 0 || isReverting}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-medium text-amber-600 hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-400"
          >
            {isReverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            退回上一步{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
          {items.length > 0 && (
            <button
              onClick={() => setSelected(new Set(items.map((it) => it.id)))}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              全選本頁
            </button>
          )}
          <button
            onClick={handleComplete}
            disabled={selected.size === 0 || isSaving}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} 完成{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
        </div>
      </div>

      {Toolbar}

      <div className="flex-1 overflow-auto p-8">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Boxes className="h-8 w-8 text-muted-foreground/40" />
            <p className="font-display text-sm text-muted-foreground">尚無符合條件的產品</p>
            <p className="font-body text-[12px] text-muted-foreground/70">在「產品文案」提交產品後，於此補充規格資訊；或用上方篩選選一個廠家/分類逐批處理</p>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-5">
            {items.map((it) => {
              const isSel = selected.has(it.id);
              return (
                <div key={it.id} ref={(el) => { cardRefs.current[it.id] = el; }} className={cn('rounded-2xl border bg-card transition-all', isSel ? 'border-emerald-500/50 ring-2 ring-emerald-500/20' : 'border-border')}>
                  {/* card head */}
                  <div className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
                    <input type="checkbox" checked={isSel} onChange={() => toggle(it.id)} className="h-4 w-4 rounded border-border accent-emerald-600" />
                    {/* Use ready_to_shopify image_url (base64 → img) if available, fallback to products.image_url */}
                    {/* Primary image */}
                    <div
                      className="group relative h-12 w-12 flex-shrink-0 cursor-zoom-in"
                      onClick={() => { const src = rtsImageMap[it.id] || it.imageUrl; if (src) setLightboxSrc(src); }}
                    >
                      <img
                        src={rtsImageMap[it.id] || it.imageUrl}
                        alt={it.title}
                        loading="lazy"
                        className="h-12 w-12 rounded-lg object-cover bg-muted"
                      />
                      <div className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-lg bg-black/30">
                        <ZoomIn className="h-4 w-4 text-white" />
                      </div>
                    </div>
                    {/* Additional images from ready_to_shopify.images */}
                    {(rtsImagesMap[it.id] ?? []).length > 0 && (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        {(rtsImagesMap[it.id] ?? []).slice(0, 6).map((img, idx) => (
                          <div
                            key={idx}
                            className="group relative h-12 w-12 cursor-zoom-in flex-shrink-0"
                            onClick={() => { if (img.src) setLightboxSrc(img.src); }}
                          >
                            <img
                              src={img.src}
                              alt={img.alt || it.title}
                              loading="lazy"
                              className="h-12 w-12 rounded-lg object-cover bg-muted"
                            />
                            <div className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-lg bg-black/30">
                              <ZoomIn className="h-3 w-3 text-white" />
                            </div>
                          </div>
                        ))}
                        {(rtsImagesMap[it.id] ?? []).length > 6 && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">
                            +{(rtsImagesMap[it.id] ?? []).length - 6}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-[14px] font-bold text-foreground line-clamp-1">{it.title}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {it.factory && <span className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">{it.factory}</span>}
                        {it.level1 && <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-body text-[10px] text-indigo-600">{it.level1}</span>}
                        {it.level2 && <span className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">{it.level2}</span>}
                      </div>
                    </div>
                    {/* per-product save — persists data without advancing the flow */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSaveOne(it.id)}
                      disabled={savingId === it.id}
                      className="shrink-0 gap-1.5 font-display text-xs"
                    >
                      {savingId === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      儲存
                    </Button>
                  </div>
                  {/* card body */}
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-5 items-start md:grid-cols-2 lg:grid-cols-4">
                    {/* price */}
                    <Field label="產品價錢" icon={<DollarSign className="h-3 w-3" />}>
                      <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                        <span className="pl-3 font-mono-data text-[12px] text-muted-foreground/60">$</span>
                        <input type="number" value={it.price} onChange={(e) => patch(it.id, { price: Number(e.target.value) })} className="w-full bg-transparent px-2 py-2 font-mono-data text-[13px] focus:outline-none" />
                      </div>
                    </Field>
                    {/* cost reference — read-only */}
                    <Field label="成本參考" icon={<DollarSign className="h-3 w-3" />}>
                      <div className="flex h-[38px] items-center rounded-lg border border-border/50 bg-muted/30 px-3">
                        {it.costRef != null ? (
                          <span className="font-mono-data text-[13px] font-semibold text-amber-600 dark:text-amber-400">
                            ¥{it.costRef.toFixed(0)}
                          </span>
                        ) : (
                          <span className="font-body text-[12px] text-muted-foreground/40">—</span>
                        )}
                      </div>
                    </Field>
                    {/* SKU */}
                    <Field label="產品編碼 (SKU)" icon={<Tag className="h-3 w-3" />}>
                      <input value={it.sku} onChange={(e) => patch(it.id, { sku: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono-data text-[12px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </Field>
                    {/* delivery type selector */}
                    <Field label="送貨資訊" icon={<Truck className="h-3 w-3" />}>
                      <div className="flex flex-col gap-2">
                        <div className="flex rounded-lg border border-border overflow-hidden w-fit">
                          <button
                            onClick={() => patch(it.id, { productionType: it.productionType === 'stock' ? null : 'stock', leadTime: '' })}
                            className={cn(
                              'px-3 py-1.5 text-xs font-medium transition-colors',
                              it.productionType === 'stock'
                                ? 'bg-emerald-500 text-white'
                                : 'bg-background text-muted-foreground hover:bg-muted'
                            )}
                          >
                            現貨
                          </button>
                          <button
                            onClick={() => patch(it.id, { productionType: it.productionType === 'custom' ? null : 'custom' })}
                            className={cn(
                              'px-3 py-1.5 text-xs font-medium transition-colors',
                              it.productionType === 'custom'
                                ? 'bg-amber-500 text-white'
                                : 'bg-background text-muted-foreground hover:bg-muted'
                            )}
                          >
                            全訂製
                          </button>
                        </div>
                        {it.productionType === null && (
                          <span className="font-body text-[11px] text-muted-foreground/60 italic">未選擇</span>
                        )}
                        {it.productionType === 'custom' && (
                          <Select
                            value={it.leadTime || ''}
                            onValueChange={(v) => patch(it.id, { leadTime: v })}
                          >
                            <SelectTrigger className="h-8 w-full font-body text-xs">
                              <SelectValue placeholder="選擇生產天數" />
                            </SelectTrigger>
                            <SelectContent>
                              {LEAD_TIME_OPTIONS.map((opt) => (
                                <SelectItem key={opt} value={opt}>{opt.replace('天', ' 天')}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </Field>
                    {/* dimensions */}
                    <Field label="產品尺寸（長 / 闊 / 高 mm）" icon={<Ruler className="h-3 w-3" />}>
                      <div className="flex items-center gap-1.5">
                        {(['dimL', 'dimW', 'dimH'] as const).map((k, idx) => (
                          <input
                            key={k}
                            type="number"
                            value={it[k] ?? ''}
                            onChange={(e) => patch(it.id, { [k]: e.target.value === '' ? null : Number(e.target.value) } as Partial<InfoItem>)}
                            placeholder={['長', '闊', '高'][idx]}
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-center font-mono-data text-[12px] placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        ))}
                      </div>
                    </Field>
                    {/* category — dropdowns from product_category */}
                    <Field label="產品分類（一級 / 二級）" icon={<FolderTree className="h-3 w-3" />}>
                      <div className="flex items-center gap-1.5">
                        {/* 一級 */}
                        <Select
                          value={it.level1 || ''}
                          onValueChange={(v) => patch(it.id, { level1: v, level2: '' })}
                        >
                          <SelectTrigger className="h-9 w-full font-body text-[12px]">
                            <SelectValue placeholder="一級" />
                          </SelectTrigger>
                          <SelectContent>
                            {level1Options.map((l1) => (
                              <SelectItem key={l1} value={l1}>{l1}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {/* 二級 */}
                        <Select
                          value={it.level2 || ''}
                          onValueChange={(v) => patch(it.id, { level2: v })}
                          disabled={!it.level1 || getLevel2Options(it.level1).length === 0}
                        >
                          <SelectTrigger className="h-9 w-full font-body text-[12px]">
                            <SelectValue placeholder="二級" />
                          </SelectTrigger>
                          <SelectContent>
                            {getLevel2Options(it.level1).map((l2) => (
                              <SelectItem key={l2} value={l2}>{l2}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </Field>
                    {/* tags */}
                    <Field label="產品標籤" icon={<Tag className="h-3 w-3" />}>
                      <CategoryTagPicker
                        tags={it.tags}
                        categories={bwfCats}
                        onChange={(tags) => patch(it.id, { tags })}
                      />
                    </Field>
                    {/* 產品物料 → my_fields.materials. Below dimensions row; spans
                        dimensions + category width. Soft limit 42 chars — warn only. */}
                    <div className="md:col-span-2 lg:col-span-2">
                      <Field label="產品物料" icon={<Boxes className="h-3 w-3" />}>
                        <div className="flex flex-col gap-1.5">
                          <Textarea
                            value={it.materials}
                            onChange={(e) => patch(it.id, { materials: e.target.value })}
                            placeholder="輸入產品物料..."
                            rows={4}
                            className={cn(
                              'min-h-[5.5rem] resize-y rounded-lg bg-background font-body text-[12px] focus:outline-none focus:ring-2',
                              it.materials.length > 42
                                ? 'border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/20'
                                : 'border-border focus:border-primary/50 focus:ring-primary/20'
                            )}
                          />
                          {it.materials.length > 42 && (
                            <span className="font-body text-[11px] font-medium text-rose-500">字數不可多於28個</span>
                          )}
                        </div>
                      </Field>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {Pagination}

      {/* Lightbox overlay */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
          <img
            src={lightboxSrc}
            alt="放大圖片"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Revert Reason Dialog */}
      <Dialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">退回原因（必選）</DialogTitle>
            <DialogDescription className="font-body text-sm">
              請選擇退回原因（至少選一項）。退回後產品將移至「產品文案」頁面並顯示退回原因標籤。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {REVERT_OPTIONS.map(opt => (
              <label key={opt} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 hover:bg-accent">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-amber-500"
                  checked={revertReasons.includes(opt)}
                  onChange={() =>
                    setRevertReasons(prev =>
                      prev.includes(opt) ? prev.filter(r => r !== opt) : [...prev, opt]
                    )
                  }
                />
                <span className="font-body text-sm">{opt}</span>
              </label>
            ))}
            {revertReasons.includes('其他') && (
              <textarea
                value={revertOther}
                onChange={e => setRevertOther(e.target.value.slice(0, 200))}
                placeholder="請輸入其他原因（最多 100 個中文字）"
                rows={3}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className="font-display text-xs" onClick={() => setShowRevertDialog(false)}>
              取消
            </Button>
            <Button
              size="sm"
              className="font-display text-xs bg-amber-500 hover:bg-amber-600 text-white"
              disabled={isReverting || (revertReasons.length === 0 && !revertOther.trim())}
              onClick={handleConfirmRevert}
            >
              {isReverting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              確認退回 ({selected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 font-body text-[12px] font-medium text-muted-foreground">{icon}{label}</label>
      {children}
    </div>
  );
}

// ─── CategoryTagPicker ────────────────────────────────────────────────────────

interface BwfCat { id: string; name: string; parent_id: string | null; level: number; sort_order: number }

interface CategoryTagPickerProps {
  tags: string[];
  categories: BwfCat[];
  onChange: (tags: string[]) => void;
}

function CategoryTagPicker({ tags, categories, onChange }: CategoryTagPickerProps) {
  const [open, setOpen] = useState(false);
  const [hoveredL1, setHoveredL1] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 240 });

  const l1s = categories.filter((c) => c.level === 1);
  const getL2s = useCallback((l1Id: string) => categories.filter((c) => c.level === 2 && c.parent_id === l1Id), [categories]);

  const openMenu = () => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
    setHoveredL1(l1s[0]?.id ?? null);
  };

  const closeMenu = useCallback(() => { setOpen(false); setHoveredL1(null); }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        anchorRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) return;
      closeMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeMenu]);

  const handleL1Hover = (l1Id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredL1(l1Id), 80);
  };

  // ── Tag normalization ──────────────────────────────────────────────
  // The tag list mixes L1 (一級) and L2 (二級) category names. The rule:
  //   • an L1 tag is present IFF at least one of its L2 children is selected;
  //   • every tag appears at most once (handles the case where an L1 name
  //     equals one of its own L2 names, e.g. 辦公座椅 / 3-7天送貨, which used
  //     to produce a duplicate chip).
  // Non-category tags (neither L1 nor L2) are preserved as-is.
  const l2ToParent = new Map<string, string>();
  categories.filter((c) => c.level === 2).forEach((c) => {
    const parent = l1s.find((l) => l.id === c.parent_id);
    if (parent) l2ToParent.set(c.name, parent.name);
  });
  const l1NameSet = new Set(l1s.map((l) => l.name));
  const l2NameSet = new Set(l2ToParent.keys());

  const normalize = (raw: string[]): string[] => {
    const selectedL2 = raw.filter((t) => l2NameSet.has(t));
    const neededL1 = new Set<string>();
    selectedL2.forEach((l2) => { const p = l2ToParent.get(l2); if (p) neededL1.add(p); });
    const out: string[] = [];
    const pushUnique = (t: string) => { if (!out.includes(t)) out.push(t); };
    for (const t of raw) {
      if (l2NameSet.has(t)) pushUnique(t);                       // keep selected L2
      else if (l1NameSet.has(t)) { if (neededL1.has(t)) pushUnique(t); } // keep L1 only if a child is selected
      else pushUnique(t);                                        // keep custom/non-category tags
    }
    // ensure parent L1s are present even if raw didn't list them
    neededL1.forEach((l1) => pushUnique(l1));
    return out;
  };

  // Self-heal: when categories are loaded, normalize the incoming tags once so
  // legacy dirty data (duplicate chips like two "3-7天送貨", or orphan L1 tags
  // left over from the old buggy logic) is cleaned up on load — not only after
  // the user toggles something. Guard on categories.length so we never strip
  // tags before the category list has loaded.
  useEffect(() => {
    if (categories.length === 0) return;
    const cleaned = normalize(tags);
    const changed = cleaned.length !== tags.length || cleaned.some((t, i) => t !== tags[i]);
    if (changed) onChange(cleaned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, tags]);

  const toggleL2 = (_l1Name: string, l2Name: string) => {
    const has = tags.includes(l2Name);
    const raw = has ? tags.filter((t) => t !== l2Name) : [...tags, l2Name];
    onChange(normalize(raw));
  };

  // Removing a chip: if it's an L1, also clear all its selected L2 children
  // (otherwise normalize would immediately re-add the L1). Always re-normalize.
  const removeTag = (t: string) => {
    let raw = tags.filter((x) => x !== t);
    if (l1NameSet.has(t)) {
      const childNames = new Set(
        getL2s(l1s.find((l) => l.name === t)?.id ?? '').map((c) => c.name)
      );
      raw = raw.filter((x) => !childNames.has(x));
    }
    onChange(normalize(raw));
  };

  const activeL2sForHovered = hoveredL1 ? getL2s(hoveredL1) : [];
  const hoveredL1Name = l1s.find((l) => l.id === hoveredL1)?.name ?? '';

  return (
    <div ref={anchorRef}>
      {/* Tag display + open button */}
      <div
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 cursor-pointer hover:border-primary/50 transition-colors"
        onClick={openMenu}
      >
        {tags.map((t, i) => (
          <span key={`${t}-${i}`} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            {t}
            <button
              onClick={(e) => { e.stopPropagation(); removeTag(t); }}
              className="hover:text-primary/60"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span className="font-body text-[12px] text-muted-foreground/40 select-none">選擇分類標籤...</span>
        )}
        <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
      </div>

      {/* Flyout menu via portal */}
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999, minWidth: menuPos.width }}
          className="flex rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        >
          {/* L1 panel */}
          <div className="w-40 shrink-0 border-r border-border overflow-auto max-h-72 py-1">
            {l1s.map((l1) => {
              const l2sForL1 = getL2s(l1.id);
              const selectedCount = l2sForL1.filter((l2) => tags.includes(l2.name)).length;
              return (
                <div
                  key={l1.id}
                  onMouseEnter={() => handleL1Hover(l1.id)}
                  className={cn(
                    'flex items-center justify-between gap-1 px-3 py-2 cursor-pointer text-[12px] font-body transition-colors',
                    hoveredL1 === l1.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'
                  )}
                >
                  <span className="truncate">{l1.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {selectedCount > 0 && (
                      <span className="rounded-full bg-primary text-white text-[9px] font-bold min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                        {selectedCount}
                      </span>
                    )}
                    <ChevronRight className="h-3 w-3 opacity-40" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* L2 panel */}
          <div className="w-44 overflow-auto max-h-72 py-1">
            {hoveredL1 && (
              <>
                <div className="px-3 py-1.5 font-body text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border/50 mb-1">
                  {hoveredL1Name}
                </div>
                {activeL2sForHovered.map((l2) => {
                  const sel = tags.includes(l2.name);
                  return (
                    <div
                      key={l2.id}
                      onClick={() => toggleL2(hoveredL1Name, l2.name)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 cursor-pointer text-[12px] font-body transition-colors',
                        sel ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground hover:bg-muted/50'
                      )}
                    >
                      <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors', sel ? 'bg-primary border-primary' : 'border-border')}>
                        {sel && <Check className="h-2.5 w-2.5 text-white" />}
                      </span>
                      <span className="truncate">{l2.name}</span>
                    </div>
                  );
                })}
                {activeL2sForHovered.length === 0 && (
                  <div className="px-3 py-4 text-center font-body text-[11px] text-muted-foreground/50">無二級分類</div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

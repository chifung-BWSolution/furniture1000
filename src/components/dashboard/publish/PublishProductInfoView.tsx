import { useState, useEffect, useRef } from 'react';
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
import { excludeAlreadyPublishedRts } from '@/lib/publishPipeline';
import { syncRtsContentToProduct, syncRtsWorkflowToProduct } from '@/lib/rtsProductSync';
import { usePublishRtsList } from './usePublishRtsList';
import { writeUploadLog, writeUploadLogBatch, type UploadLogEntry } from '@/lib/uploadLog';
import { CategoryTagPicker, type BwfCat } from './CategoryTagPicker';
import { parseRtsImageUrls } from '@/lib/rtsImages';

type ProductionType = 'stock' | 'custom' | null;

const LEAD_TIME_OPTIONS = ['3-7天', '8-15天', '16-25天', '26-40天', '41天以上'] as const;

const COST_REF_INPUT_CLASS =
  'w-full bg-transparent px-2 py-2 font-mono-data text-[13px] text-amber-600 dark:text-amber-400 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/** Normalize DB/import floats (e.g. 1511.97) → clean display string. */
function normalizeCostRefInput(value: unknown): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return '';
  const nearest = Math.round(n);
  if (Math.abs(n - nearest) < 0.05) return String(nearest);
  const twoDp = Math.round(n * 100) / 100;
  return Number.isInteger(twoDp) ? String(twoDp) : twoDp.toFixed(2).replace(/\.?0+$/, '');
}

function sanitizeCostRefInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot < 0) return cleaned;
  return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`;
}

function parseCostRefInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  const nearest = Math.round(n);
  if (Math.abs(n - nearest) < 0.05) return nearest;
  return Math.round(n * 100) / 100;
}

interface InfoItem {
  id: string;
  rtsId: string | null;
  title: string;
  imageUrl: string;
  factory: string;
  price: number;
  costPrice: number | null;
  // cost from ready_to_shopify.cost — editable string (avoids number-input float artifacts)
  costRef: string;
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
  const [bwfCats, setBwfCats] = useState<BwfCat[]>([]);
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

  const { rows, totalCount, isLoading, Toolbar, Pagination } = usePublishRtsList({
    applyBaseFilters: (q) => excludeAlreadyPublishedRts(q.eq('in_shopify_queue', true).eq('info_done', false).eq('copy_done', true)),
    applyProductsCountFilters: (q) => q.eq('in_shopify_queue', true).eq('info_done', false).eq('copy_done', true).is('shopify_product_id', null),
    countStage: 'product-info',
    reloadKey,
    orderBy: [
      { column: 'copy_done_at', ascending: false, nullsFirst: false },
      { column: 'imported_at', ascending: false },
    ],
  });

  // List RPC omits heavy images jsonb — lazy-load per page after rows render.
  const [imagesByProductId, setImagesByProductId] = useState<Record<string, string[]>>({});
  const imagesFetchSeq = useRef(0);
  useEffect(() => {
    if (rows.length === 0) {
      setImagesByProductId({});
      return;
    }
    const productIds = rows.map((r: any) => r.id as string).filter(Boolean);
    const seq = ++imagesFetchSeq.current;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('ready_to_shopify')
        .select('product_id, image_url, image_url_2, image_url_3, images')
        .in('product_id', productIds);
      if (cancelled || seq !== imagesFetchSeq.current) return;
      if (error) {
        console.warn('[PublishProductInfoView] images fetch failed:', error.message);
        return;
      }
      const map: Record<string, string[]> = {};
      for (const row of data ?? []) {
        if (row.product_id) map[row.product_id] = parseRtsImageUrls(row);
      }
      setImagesByProductId(map);
    })();
    return () => { cancelled = true; };
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
        rtsId: r.rts_id ?? null,
        title: r.title || '',
        imageUrl: r.image_url || '',
        factory: r.factories_display_name || '',
        price: Number(r.sale_price ?? r.price ?? 0),
        costPrice: r.cost_price != null ? Number(r.cost_price) : null,
        costRef: normalizeCostRefInput(
          r.cost != null ? r.cost : (r.cost_price != null ? r.cost_price : null),
        ),
        dimL: r.dimension_l_mm ?? null,
        dimW: r.dimension_w_mm ?? null,
        dimH: r.dimension_h_mm ?? null,
        sku: r.sku || r.model || '',
        tags: Array.isArray(r.tags) ? r.tags : [],
        level1: r.level1_category || '',
        level2: r.level2_category || '',
        productionType,
        leadTime,
        materials: (r['my_fields.materials'] ?? r.material ?? '') || '',
      };
    });
    setItems(mapped);
    setSelected(new Set());
  }, [rows]);

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
      const now = new Date().toISOString();
      const { error: rtsErr } = await supabase
        .from('ready_to_shopify')
        .update({
          copy_done: false,
          copy_done_at: null,
          copy_queued_at: now,
          info_done: false,
          revert_reason: revertReason,
          furniture_group_checked: null,
        })
        .in('product_id', ids);
      if (rtsErr) throw new Error(rtsErr.message);
      await Promise.all(ids.map((id) => syncRtsWorkflowToProduct(supabase, id, {
        copy_done: false,
        copy_done_at: null,
        copy_queued_at: now,
        info_done: false,
        ready_to_publish: false,
        revert_reason: revertReason,
      })));
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

    const costNum = parseCostRefInput(it.costRef);

    const rtsUpdate: Record<string, any> = {
      sku: it.sku || null,
      price: it.price,
      cost: costNum,
      tags: it.tags.length > 0 ? it.tags : null,
      product_type: [it.level1, it.level2].filter(Boolean).join(' / ') || null,
      dimension_l_mm: it.dimL,
      dimension_w_mm: it.dimW,
      dimension_h_mm: it.dimH,
      in_stock: isStock ? true : (it.productionType === 'custom' ? false : null),
      customize: customizeVal,
      'my_fields.materials': it.materials.trim() || null,
      material: it.materials.trim() || null,
    };
    if (advance) {
      rtsUpdate.furniture_group_checked = false;
      rtsUpdate.info_done = true;
      rtsUpdate.info_completed_at = new Date().toISOString();
      if (isStock || customizeVal != null) rtsUpdate.status = 'draft';
    }
    let { error: rtsErr } = await supabase
      .from('ready_to_shopify')
      .update(rtsUpdate)
      .eq('product_id', it.id);
    if (rtsErr?.message?.includes('info_completed_at')) {
      delete rtsUpdate.info_completed_at;
      ({ error: rtsErr } = await supabase
        .from('ready_to_shopify')
        .update(rtsUpdate)
        .eq('product_id', it.id));
    }
    if (rtsErr) throw new Error(rtsErr.message);

    await syncRtsContentToProduct(supabase, it.id, {
      sku: it.sku || null,
      sale_price: it.price,
      cost_price: costNum,
      tags: it.tags,
      level1_category: it.level1 || null,
      level2_category: it.level2 || null,
      dimension_l_mm: it.dimL,
      dimension_w_mm: it.dimW,
      dimension_h_mm: it.dimH,
      in_stock: it.productionType === 'stock' ? true : false,
      customize: customizeVal,
      'my_fields.materials': it.materials.trim() || null,
    });
    if (advance) {
      await syncRtsWorkflowToProduct(supabase, it.id, {
        info_done: true,
        ready_to_publish: false,
      });
    }
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
      await writeUploadLog({
        productId: it.id,
        rtsId: it.rtsId,
        stage: 'product_info',
        action: 'save',
      });
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
      const completed: UploadLogEntry[] = [];
      for (const id of ids) {
        const it = items.find((x) => x.id === id);
        if (!it) continue;
        await writeProductInfo(it, true);
        completed.push({
          productId: it.id,
          rtsId: it.rtsId,
          stage: 'product_info',
          action: 'complete',
        });
      }
      await writeUploadLogBatch(completed);
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
                    <ProductImageStrip
                      productId={it.id}
                      title={it.title}
                      fallbackUrls={it.imageUrl ? [it.imageUrl] : []}
                      allUrls={imagesByProductId[it.id]}
                      onZoom={setLightboxSrc}
                    />
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
                    {/* cost reference — editable, syncs to ready_to_shopify.cost + products.cost_price */}
                    <Field label="成本參考" icon={<DollarSign className="h-3 w-3" />}>
                      <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                        <span className="pl-3 font-mono-data text-[12px] text-muted-foreground/60">¥</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={it.costRef}
                          onChange={(e) => patch(it.id, { costRef: sanitizeCostRefInput(e.target.value) })}
                          placeholder="—"
                          className={COST_REF_INPUT_CLASS}
                        />
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

function ProductImageStrip({
  productId,
  title,
  fallbackUrls,
  allUrls,
  onZoom,
}: {
  productId: string;
  title: string;
  fallbackUrls: string[];
  allUrls?: string[];
  onZoom: (src: string) => void;
}) {
  const urls = allUrls && allUrls.length > 0 ? allUrls : fallbackUrls;
  const MAX_VISIBLE = 8;

  if (urls.length === 0) {
    return <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-muted" />;
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto max-w-[420px]">
      {urls.slice(0, MAX_VISIBLE).map((src, idx) => (
        <LazyProductThumb
          key={`${productId}-${idx}-${src.slice(0, 32)}`}
          src={src}
          alt={title}
          priority={idx === 0}
          onClick={() => onZoom(src)}
        />
      ))}
      {urls.length > MAX_VISIBLE && (
        <button
          type="button"
          onClick={() => onZoom(urls[MAX_VISIBLE])}
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-muted font-body text-[10px] text-muted-foreground hover:bg-muted/80"
        >
          +{urls.length - MAX_VISIBLE}
        </button>
      )}
    </div>
  );
}

function LazyProductThumb({
  src,
  alt,
  priority,
  onClick,
}: {
  src: string;
  alt: string;
  priority?: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(priority ?? false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div
      ref={ref}
      className="group relative h-12 w-12 flex-shrink-0 cursor-zoom-in"
      onClick={onClick}
    >
      {visible ? (
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'low'}
          className="h-12 w-12 rounded-lg object-cover bg-muted"
        />
      ) : (
        <div className="h-12 w-12 animate-pulse rounded-lg bg-muted" />
      )}
      <div className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-lg bg-black/30">
        <ZoomIn className="h-3.5 w-3.5 text-white" />
      </div>
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

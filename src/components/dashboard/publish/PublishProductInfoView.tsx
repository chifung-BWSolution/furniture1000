import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Boxes, Check, ChevronLeft, Loader2, Tag, Ruler, DollarSign, Truck, FolderTree, X,
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
}

interface Props {
  focusProductId?: string | null;
  onFocusHandled?: () => void;
}

export function PublishProductInfoView({ focusProductId, onFocusHandled }: Props) {
  const [items, setItems] = useState<InfoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { rows, totalCount, isLoading, Toolbar, Pagination } = usePublishList({
    select: 'id,title,image_url,price,sale_price,cost_price,sku,tags,dimension_l_mm,dimension_w_mm,dimension_h_mm,level1_category,level2_category,in_stock,customize,model,factories_display_name',
    applyBaseFilters: (q) => q.eq('in_shopify_queue', true).eq('info_done', false),
    reloadKey,
  });

  // Fetch cost from ready_to_shopify for each product (keyed by product_id)
  const [costMap, setCostMap] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (rows.length === 0) return;
    const ids = rows.map((r: any) => r.id);
    supabase
      .from('ready_to_shopify')
      .select('product_id, cost')
      .in('product_id', ids)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, number | null> = {};
        for (const row of data) map[row.product_id] = row.cost != null ? Number(row.cost) : null;
        setCostMap(map);
      });
  }, [rows]);

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
      };
    });
    setItems(mapped);
    setSelected(new Set());
  }, [rows, costMap]);

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

  const addTag = (id: string) => {
    const t = (tagDraft[id] || '').trim();
    if (!t) return;
    setItems((prev) => prev.map((it) => (it.id === id && !it.tags.includes(t) ? { ...it, tags: [...it.tags, t] } : it)));
    setTagDraft((prev) => ({ ...prev, [id]: '' }));
  };

  // 退回上一步：將所選產品的 copy_done 設回 false，使其重新出現在「產品文案」
  const [isReverting, setIsReverting] = useState(false);
  const handleRevert = async () => {
    if (selected.size === 0) { toast.message('請先勾選產品'); return; }
    const ids = Array.from(selected);
    setIsReverting(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({ copy_done: false, copy_done_at: null })
        .in('id', ids);
      if (error) throw new Error(error.message);
      setSelected(new Set());
      setReloadKey((k) => k + 1);
      toast.success('已退回產品文案', { description: `${ids.length} 件產品已退回「產品文案」頁面重新編輯` });
    } catch (e) {
      toast.error('退回失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsReverting(false);
    }
  };

  const [isSaving, setIsSaving] = useState(false);
  const handleComplete = async () => {
    if (selected.size === 0) { toast.message('請先勾選產品'); return; }
    const ids = Array.from(selected);
    setIsSaving(true);
    try {
      for (const id of ids) {
        const it = items.find((x) => x.id === id);
        if (!it) continue;

        // 1. Update products table
        const { error } = await supabase
          .from('products')
          .update({
            sale_price: it.price,
            sku: it.sku,
            tags: it.tags,
            dimension_l_mm: it.dimL,
            dimension_w_mm: it.dimW,
            dimension_h_mm: it.dimH,
            level1_category: it.level1 || null,
            level2_category: it.level2 || null,
            in_stock: it.productionType === 'stock' ? true : false,
            customize: it.productionType === 'custom' && it.leadTime ? it.leadTime : null,
            info_done: true,
          })
          .eq('id', id);
        if (error) throw new Error(error.message);

        // 2. Sync edited fields into ready_to_shopify
        // SKU → handle, delivery info → customize/in_stock, dimensions, categories, tags
        const deliveryInfo = it.productionType === 'stock'
          ? '現貨'
          : it.productionType === 'custom' && it.leadTime
            ? `全訂製 ${it.leadTime}`
            : null;
        await supabase
          .from('ready_to_shopify')
          .update({
            handle: it.sku || null,
            tags: it.tags.length > 0 ? it.tags : null,
            product_type: [it.level1, it.level2].filter(Boolean).join(' / ') || null,
            // Store delivery info in a dedicated field if available, else keep existing
            ...(deliveryInfo != null && { status: 'draft' }),
          })
          .eq('product_id', id);
      }
      setSelected(new Set());
      setReloadKey((k) => k + 1);
      toast.success('已送往發佈前檢查', { description: `${ids.length} 件產品的資訊已儲存` });
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
                    <img src={it.imageUrl} alt={it.title} loading="lazy" className="h-12 w-12 rounded-lg object-cover bg-muted" />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-[14px] font-bold text-foreground line-clamp-1">{it.title}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {it.factory && <span className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">{it.factory}</span>}
                        {it.level1 && <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-body text-[10px] text-indigo-600">{it.level1}</span>}
                        {it.level2 && <span className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">{it.level2}</span>}
                      </div>
                    </div>
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
                    {/* category */}
                    <Field label="產品分類（一級 / 二級）" icon={<FolderTree className="h-3 w-3" />}>
                      <div className="flex items-center gap-1.5">
                        <input value={it.level1} onChange={(e) => patch(it.id, { level1: e.target.value })} placeholder="一級" className="w-full rounded-lg border border-border bg-background px-2 py-2 font-body text-[12px] placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        <input value={it.level2} onChange={(e) => patch(it.id, { level2: e.target.value })} placeholder="二級" className="w-full rounded-lg border border-border bg-background px-2 py-2 font-body text-[12px] placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                    </Field>
                    {/* tags */}
                    <Field label="產品標籤" icon={<Tag className="h-3 w-3" />}>
                      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                        {it.tags.map((t) => (
                          <span key={t} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                            {t}
                            <button onClick={() => patch(it.id, { tags: it.tags.filter((x) => x !== t) })}><X className="h-2.5 w-2.5" /></button>
                          </span>
                        ))}
                        <input
                          value={tagDraft[it.id] || ''}
                          onChange={(e) => setTagDraft((prev) => ({ ...prev, [it.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') addTag(it.id); }}
                          placeholder="輸入後 Enter"
                          className="min-w-[80px] flex-1 bg-transparent py-0.5 font-body text-[12px] placeholder:text-muted-foreground/40 focus:outline-none"
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {Pagination}
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

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Boxes, Check, Loader2, Tag, Ruler, DollarSign, Truck, FolderTree, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface InfoItem {
  id: string;
  title: string;
  imageUrl: string;
  price: number;
  costPrice: number | null;
  dimL: number | null;
  dimW: number | null;
  dimH: number | null;
  sku: string;
  tags: string[];
  level1: string;
  level2: string;
  deliveryTermName: string;
}

export function PublishProductInfoView() {
  const [items, setItems] = useState<InfoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('products')
        .select('id,title,image_url,images,price,sale_price,cost_price,sku,tags,dimension_l_mm,dimension_w_mm,dimension_h_mm,level1_category,level2_category,delivery_term_name,model')
        .eq('in_shopify_queue', true)
        .eq('info_done', false)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      const mapped: InfoItem[] = (data || []).map((r: any) => ({
        id: r.id,
        title: r.title || '',
        imageUrl: (Array.isArray(r.images) && r.images[0]?.src) || r.image_url || '',
        price: Number(r.sale_price ?? r.price ?? 0),
        costPrice: r.cost_price != null ? Number(r.cost_price) : null,
        dimL: r.dimension_l_mm ?? null,
        dimW: r.dimension_w_mm ?? null,
        dimH: r.dimension_h_mm ?? null,
        sku: r.sku || r.model || '',
        tags: Array.isArray(r.tags) ? r.tags : [],
        level1: r.level1_category || '',
        level2: r.level2_category || '',
        deliveryTermName: r.delivery_term_name || '',
      }));
      setItems(mapped);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

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

  const [isSaving, setIsSaving] = useState(false);
  const handleComplete = async () => {
    if (selected.size === 0) { toast.message('請先勾選產品'); return; }
    const ids = Array.from(selected);
    setIsSaving(true);
    try {
      // Persist each selected product's edited info + mark info_done=true
      for (const id of ids) {
        const it = items.find((x) => x.id === id);
        if (!it) continue;
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
            delivery_term_name: it.deliveryTermName || null,
            info_done: true,
          })
          .eq('id', id);
        if (error) throw new Error(error.message);
      }
      // Remove completed products from this page's list
      setItems((prev) => prev.filter((p) => !selected.has(p.id)));
      setSelected(new Set());
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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-8 py-3.5">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">產品信息</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-primary">
            {items.length} 件已完成文案
          </span>
          {selected.size > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-emerald-600">已選 {selected.size}</span>
          )}
        </div>
        <button
          onClick={handleComplete}
          disabled={selected.size === 0 || isSaving}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} 完成{selected.size > 0 ? `（${selected.size}）` : ''}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Boxes className="h-8 w-8 text-muted-foreground/40" />
            <p className="font-display text-sm text-muted-foreground">尚無產品</p>
            <p className="font-body text-[12px] text-muted-foreground/70">在「產品文案」提交產品後，於此補充規格資訊</p>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-5">
            {items.map((it) => {
              const isSel = selected.has(it.id);
              return (
                <div key={it.id} className={cn('rounded-2xl border bg-card transition-all', isSel ? 'border-emerald-500/50 ring-2 ring-emerald-500/20' : 'border-border')}>
                  {/* card head */}
                  <div className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
                    <input type="checkbox" checked={isSel} onChange={() => toggle(it.id)} className="h-4 w-4 rounded border-border accent-emerald-600" />
                    <img src={it.imageUrl} alt={it.title} loading="lazy" className="h-12 w-12 rounded-lg object-cover bg-muted" />
                    <h3 className="font-display text-[14px] font-bold text-foreground line-clamp-1">{it.title}</h3>
                  </div>
                  {/* card body */}
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-5 md:grid-cols-2 lg:grid-cols-3">
                    {/* price */}
                    <Field label="產品價錢" icon={<DollarSign className="h-3 w-3" />}>
                      <div className="flex items-center rounded-lg border border-border bg-background focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                        <span className="pl-3 font-mono-data text-[12px] text-muted-foreground/60">$</span>
                        <input type="number" value={it.price} onChange={(e) => patch(it.id, { price: Number(e.target.value) })} className="w-full bg-transparent px-2 py-2 font-mono-data text-[13px] focus:outline-none" />
                      </div>
                    </Field>
                    {/* SKU */}
                    <Field label="產品編碼 (SKU)" icon={<Tag className="h-3 w-3" />}>
                      <input value={it.sku} onChange={(e) => patch(it.id, { sku: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono-data text-[12px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </Field>
                    {/* delivery */}
                    <Field label="送貨資訊" icon={<Truck className="h-3 w-3" />}>
                      <input value={it.deliveryTermName} onChange={(e) => patch(it.id, { deliveryTermName: e.target.value })} placeholder="如：現貨 / 訂製 30 天" className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-[13px] placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
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

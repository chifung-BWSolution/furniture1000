import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Sofa, Loader2, CheckCheck, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface FGItem {
  rtsId: string;
  productId: string;
  title: string;
  imageUrl: string;
  factory: string;
  productType: string;
  price: number | null;
  sku: string;
  tags: string[];
}

interface Props {
  onEnterReadyToPublish?: () => void;
}

export function FurnitureGroupCheckView({ onEnterReadyToPublish }: Props) {
  const [items, setItems] = useState<FGItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setItems((data || []).map((r: any) => ({
        rtsId: r.id,
        productId: r.product_id,
        title: r.title || '(未命名)',
        imageUrl: r.image_url || '',
        factory: r.vendor || '—',
        productType: r.product_type || '—',
        price: r.price != null ? Number(r.price) : null,
        sku: '',
        tags: Array.isArray(r.tags) ? r.tags : [],
      })));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleRow = (id: string) => setSelected(prev => {
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
      // Mark furniture_group_checked=true → products appear in 準備上載
      const { error: rtsError } = await supabase
        .from('ready_to_shopify')
        .update({ furniture_group_checked: true })
        .in('id', ids);
      if (rtsError) throw new Error(rtsError.message);

      // Also set ready_to_publish=true on products table so reloadReadyToPublish picks them up
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
      toast.success(`已加入準備上載`, { description: `${ids.length} 件產品已移至「準備上載」` });
      onEnterReadyToPublish?.();
    } catch (e) {
      toast.error('操作失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-8 py-3.5">
        <div className="flex items-center gap-2">
          <Sofa className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">傢俬組檢查</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-xs font-semibold text-primary">
            {items.length} 件待確認
          </span>
        </div>
        <button
          onClick={handleAddToReadyToPublish}
          disabled={selected.size === 0 || isSubmitting}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
          加入到 準備上載{selected.size > 0 ? `（${selected.size}）` : ''}
        </button>
      </div>

      {/* Info banner */}
      <div className="shrink-0 border-b border-border bg-indigo-500/5 px-8 py-3">
        <div className="flex items-center gap-2 text-[12px] text-indigo-700 dark:text-indigo-400">
          <ChevronRight className="h-3.5 w-3.5" />
          <span>傢俬組確認後，勾選產品並按「加入到 準備上載」，產品將進入「準備上載」頁面等待上傳至 Shopify</span>
        </div>
      </div>

      {/* Table */}
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
                    className={cn('hover:bg-muted/30 cursor-pointer', selected.has(row.rtsId) && 'bg-primary/5')}
                    onClick={() => toggleRow(row.rtsId)}
                  >
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.rtsId)}
                        onChange={() => toggleRow(row.rtsId)}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {row.imageUrl ? (
                          <img
                            src={row.imageUrl}
                            alt={row.title}
                            className="h-12 w-12 shrink-0 rounded-lg object-cover bg-muted"
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                          </div>
                        )}
                        <span className="font-body text-sm font-medium text-foreground line-clamp-2 max-w-[320px]">
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
                          <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">
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
    </div>
  );
}

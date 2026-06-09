import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  ShieldCheck, Check, X, UploadCloud, AlertTriangle, CheckCircle2, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// ── Field definitions ────────────────────────────────────────────────────────

interface CopyFields {
  shopifyTitle: boolean;
  shopifyDescription: boolean;
  shopifyImages: boolean;
  seoInfo: boolean;
}

interface InfoFields {
  price: boolean;
  sku: boolean;
  delivery: boolean;
  dimensions: boolean;
  category: boolean;
  tags: boolean;
}

interface CheckRow {
  id: string;
  factoryName: string;
  productName: string;
  copy: CopyFields;
  info: InfoFields;
}

const COPY_LABELS: { key: keyof CopyFields; label: string }[] = [
  { key: 'shopifyTitle',       label: 'Shopify 產品名稱' },
  { key: 'shopifyDescription', label: 'Shopify 產品說明' },
  { key: 'shopifyImages',      label: 'Shopify 產品圖片' },
  { key: 'seoInfo',            label: 'Shopify 搜尋引擎產品資訊' },
];

const INFO_LABELS: { key: keyof InfoFields; label: string }[] = [
  { key: 'price',      label: '產品價錢' },
  { key: 'sku',        label: '產品編碼 (SKU)' },
  { key: 'delivery',   label: '送貨資訊' },
  { key: 'dimensions', label: '產品尺寸（長 / 闊 / 高 mm）' },
  { key: 'category',   label: '產品分類（一級 / 二級）' },
  { key: 'tags',       label: '產品標籤' },
];

function rowAllPass(row: CheckRow) {
  return (
    Object.values(row.copy).every(Boolean) &&
    Object.values(row.info).every(Boolean)
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

interface NavigatePayload {
  view: 'publish-copywriting' | 'publish-product-info';
  productId: string;
}

interface Props {
  onNavigate?: (payload: NavigatePayload) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PublishPrecheckView({ onNavigate }: Props) {
  const [items, setItems] = useState<CheckRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEntering, setIsEntering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('products')
        .select(
          'id,title,description,image_url,images,sale_price,price,' +
          'sku,model,delivery_term_name,tags,' +
          'dimension_l_mm,dimension_w_mm,dimension_h_mm,' +
          'level1_category,level2_category,factories_display_name'
        )
        .eq('in_shopify_queue', true)
        .eq('info_done', true)
        .order('created_at', { ascending: false });
      if (cancelled) return;

      const mapped: CheckRow[] = (data || []).map((r: any) => {
        const hasImages = !!((Array.isArray(r.images) && r.images[0]?.src) || r.image_url);
        const skuValue = r.sku || r.model || '';
        const dimHasAny = r.dimension_l_mm != null || r.dimension_w_mm != null || r.dimension_h_mm != null;

        return {
          id: r.id,
          factoryName: r.factories_display_name || '—',
          productName: r.title || '(未命名)',
          copy: {
            shopifyTitle:       !!(r.title),
            shopifyDescription: !!(r.description),
            shopifyImages:      hasImages,
            seoInfo:            !!(r.title && r.description),
          },
          info: {
            price:      Number(r.sale_price ?? r.price ?? 0) > 0,
            sku:        !!skuValue,
            delivery:   !!(r.delivery_term_name),
            dimensions: dimHasAny,
            category:   !!(r.level1_category),
            tags:       Array.isArray(r.tags) && r.tags.length > 0,
          },
        };
      });

      setItems(mapped);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const totalChecks = items.length * (COPY_LABELS.length + INFO_LABELS.length);
  const passedChecks = items.reduce((sum, row) => {
    const copyPass = COPY_LABELS.filter(f => row.copy[f.key]).length;
    const infoPass = INFO_LABELS.filter(f => row.info[f.key]).length;
    return sum + copyPass + infoPass;
  }, 0);
  const passRate = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
  const allPass = items.length > 0 && items.every(rowAllPass);

  // Click ✗ on a copy field: reset copy_done=false so the product reappears in 產品文案
  const handleCopyFix = async (productId: string) => {
    try {
      await supabase.from('products').update({ copy_done: false }).eq('id', productId);
      setItems((prev) => prev.filter((r) => r.id !== productId));
    } catch {
      // navigate anyway
    }
    onNavigate?.({ view: 'publish-copywriting', productId });
  };

  // Click ✗ on an info field: reset info_done=false so the product reappears in 產品信息
  const handleInfoFix = async (productId: string) => {
    try {
      await supabase.from('products').update({ info_done: false }).eq('id', productId);
      setItems((prev) => prev.filter((r) => r.id !== productId));
    } catch {
      // navigate anyway
    }
    onNavigate?.({ view: 'publish-product-info', productId });
  };

  const handleEnter = async () => {
    if (!allPass || items.length === 0) return;
    const ids = items.map((it) => it.id);
    setIsEntering(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({ ready_to_publish: true })
        .in('id', ids);
      if (error) throw new Error(error.message);
      setItems([]);
      toast.success('已送往準備上載', { description: `${ids.length} 件產品已進入準備上載` });
    } catch (e) {
      toast.error('操作失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsEntering(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-8 py-3.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">發佈前檢查</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-xs font-semibold text-primary">
            {items.length} 件待檢查
          </span>
        </div>
        <button
          disabled={!allPass || items.length === 0 || isEntering}
          onClick={handleEnter}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-50"
        >
          {isEntering ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          進入準備上載
        </button>
      </div>

      {/* Pass-rate banner */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-14 w-14 items-center justify-center rounded-2xl', allPass ? 'bg-emerald-500/15' : 'bg-amber-500/15')}>
              {allPass ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <AlertTriangle className="h-7 w-7 text-amber-600" />}
            </div>
            <div>
              <p className="font-display text-3xl font-bold text-foreground">{passRate}%</p>
              <p className="font-body text-xs text-muted-foreground">整體通過率</p>
            </div>
          </div>
          <div className="flex-1">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />通過 {passedChecks}</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" />需修正 {totalChecks - passedChecks}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-all', allPass ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary to-primary/70')}
                style={{ width: `${passRate}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Checklist table */}
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium border-b border-border/60" rowSpan={2}>廠家名稱</th>
                <th className="px-4 py-2.5 text-left font-medium border-b border-border/60" rowSpan={2}>產品名稱</th>
                <th
                  colSpan={COPY_LABELS.length}
                  className="px-3 py-2 text-center font-semibold border-b border-border/60 border-l border-indigo-500/20 bg-indigo-500/5 text-indigo-600"
                >
                  產品文案
                </th>
                <th
                  colSpan={INFO_LABELS.length}
                  className="px-3 py-2 text-center font-semibold border-b border-border/60 border-l border-emerald-500/20 bg-emerald-500/5 text-emerald-600"
                >
                  產品信息
                </th>
              </tr>
              <tr>
                {COPY_LABELS.map((f, i) => (
                  <th
                    key={f.key}
                    className={cn(
                      'px-2 py-2 text-center font-medium leading-tight max-w-[90px] whitespace-normal',
                      i === 0 && 'border-l border-indigo-500/20'
                    )}
                  >
                    <span className="inline-block text-xs">{f.label}</span>
                  </th>
                ))}
                {INFO_LABELS.map((f, i) => (
                  <th
                    key={f.key}
                    className={cn(
                      'px-2 py-2 text-center font-medium leading-tight max-w-[90px] whitespace-normal',
                      i === 0 && 'border-l border-emerald-500/20'
                    )}
                  >
                    <span className="inline-block text-xs">{f.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((row) => {
                const rowPass = rowAllPass(row);
                return (
                  <tr key={row.id} className={cn('hover:bg-muted/30', !rowPass && 'bg-amber-500/[0.03]')}>
                    <td className="px-4 py-3">
                      <span className="font-body text-sm text-muted-foreground">{row.factoryName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-body text-sm font-medium text-foreground">{row.productName}</span>
                    </td>

                    {/* 產品文案 checks */}
                    {COPY_LABELS.map((f, i) => (
                      <td key={f.key} className={cn('px-2 py-3 text-center', i === 0 && 'border-l border-indigo-500/10')}>
                        {row.copy[f.key] ? (
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                            <Check className="h-4 w-4" />
                          </span>
                        ) : (
                          <button
                            onClick={() => handleCopyFix(row.id)}
                            title={`前往「產品文案」填寫「${f.label}」`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 hover:bg-rose-500/25 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    ))}

                    {/* 產品信息 checks */}
                    {INFO_LABELS.map((f, i) => (
                      <td key={f.key} className={cn('px-2 py-3 text-center', i === 0 && 'border-l border-emerald-500/10')}>
                        {row.info[f.key] ? (
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                            <Check className="h-4 w-4" />
                          </span>
                        ) : (
                          <button
                            onClick={() => handleInfoFix(row.id)}
                            title={`前往「產品信息」填寫「${f.label}」`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 hover:bg-rose-500/25 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}

              {isLoading && (
                <tr>
                  <td colSpan={COPY_LABELS.length + INFO_LABELS.length + 2} className="px-6 py-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                  </td>
                </tr>
              )}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={COPY_LABELS.length + INFO_LABELS.length + 2} className="px-6 py-12 text-center text-[12px] text-muted-foreground/60">
                    尚無待檢查產品 — 到「產品信息」按「完成」後，產品會送到此處
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

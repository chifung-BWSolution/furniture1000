import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  ShieldCheck, Check, X, Sparkles, Wand2, UploadCloud, AlertTriangle, CheckCircle2, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// ── Field definitions ────────────────────────────────────────────────────────

interface CopyFields {
  shopifyTitle: boolean;       // Shopify 產品名稱
  shopifyDescription: boolean; // Shopify 產品說明
  shopifyImages: boolean;      // Shopify 產品圖片
  seoInfo: boolean;            // Shopify 搜尋引擎產品資訊
}

interface InfoFields {
  price: boolean;              // 產品價錢
  sku: boolean;                // 產品編碼 (SKU)
  delivery: boolean;           // 送貨資訊
  dimensions: boolean;         // 產品尺寸（長 / 闊 / 高 mm）
  category: boolean;           // 產品分類（一級 / 二級）
  tags: boolean;               // 產品標籤
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

interface Props {
  onNavigate?: (view: 'publish-copywriting' | 'publish-product-info') => void;
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
  const failingItems = items.filter((row) => !rowAllPass(row));
  const allPass = failingItems.length === 0 && items.length > 0;

  const fixAll = () => {
    setItems((prev) => prev.map((row) => ({
      ...row,
      copy: { shopifyTitle: true, shopifyDescription: true, shopifyImages: true, seoInfo: true },
      info: { price: true, sku: true, delivery: true, dimensions: true, category: true, tags: true },
    })));
    toast.success('已套用全部建議修正', { description: '所有檢查項目已通過' });
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

  const handleCrossClick = (type: 'copy' | 'info') => {
    if (!onNavigate) return;
    onNavigate(type === 'copy' ? 'publish-copywriting' : 'publish-product-info');
  };

  // ── Render ──

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-8 py-3.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">發佈前檢查</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-primary">
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
      <div className="shrink-0 border-b border-border bg-card px-8 py-5">
        <div className="mx-auto flex max-w-6xl items-center gap-8">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-14 w-14 items-center justify-center rounded-2xl', allPass ? 'bg-emerald-500/15' : 'bg-amber-500/15')}>
              {allPass ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <AlertTriangle className="h-7 w-7 text-amber-600" />}
            </div>
            <div>
              <p className="font-display text-3xl font-bold text-foreground">{passRate}%</p>
              <p className="font-body text-[11px] text-muted-foreground">整體通過率</p>
            </div>
          </div>
          <div className="flex-1">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
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
          <button
            onClick={fixAll}
            disabled={allPass || items.length === 0}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/80 px-5 py-3 text-sm font-bold text-primary-foreground shadow-md transition-all hover:opacity-90 hover:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
          >
            <Wand2 className="h-4 w-4" /> 一鍵批量修正
            {!allPass && items.length > 0 && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px]">{totalChecks - passedChecks}</span>
            )}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Checklist table */}
        <div className="flex-1 overflow-auto p-8">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                {/* Group header row */}
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
                  <th className="px-4 py-2 text-center font-medium border-b border-border/60" rowSpan={2}>結果</th>
                </tr>
                {/* Sub-header row */}
                <tr>
                  {COPY_LABELS.map((f, i) => (
                    <th
                      key={f.key}
                      className={cn(
                        'px-2 py-2 text-center font-medium leading-tight max-w-[90px] whitespace-normal',
                        i === 0 && 'border-l border-indigo-500/20'
                      )}
                    >
                      <span className="inline-block text-[10px]">{f.label}</span>
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
                      <span className="inline-block text-[10px]">{f.label}</span>
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
                        <span className="font-body text-[12px] text-muted-foreground">{row.factoryName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-body text-[13px] font-medium text-foreground">{row.productName}</span>
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
                              onClick={() => handleCrossClick('copy')}
                              title={`點擊前往「產品文案」填寫「${f.label}」`}
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
                              onClick={() => handleCrossClick('info')}
                              title={`點擊前往「產品信息」填寫「${f.label}」`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 hover:bg-rose-500/25 transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      ))}

                      <td className="px-4 py-3 text-center">
                        {rowPass
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-600">通過</span>
                          : <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-600">需修正</span>
                        }
                      </td>
                    </tr>
                  );
                })}

                {isLoading && (
                  <tr>
                    <td colSpan={COPY_LABELS.length + INFO_LABELS.length + 3} className="px-6 py-12 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                    </td>
                  </tr>
                )}
                {!isLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={COPY_LABELS.length + INFO_LABELS.length + 3} className="px-6 py-12 text-center text-[12px] text-muted-foreground/60">
                      尚無待檢查產品 — 到「產品信息」按「完成」後，產品會送到此處
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI suggestions sidebar */}
        <aside className="flex w-[320px] shrink-0 flex-col overflow-auto border-l border-border bg-sidebar p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h4 className="font-display text-sm font-bold">AI 修正建議</h4>
          </div>

          {items.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <p className="font-display text-sm font-bold text-emerald-700">全部檢查通過</p>
              <p className="text-[11px] text-muted-foreground">可進入準備上載流程</p>
            </div>
          ) : allPass ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <p className="font-display text-sm font-bold text-emerald-700">全部檢查通過</p>
              <p className="text-[11px] text-muted-foreground">可進入準備上載流程</p>
            </div>
          ) : (
            <div className="space-y-2">
              {failingItems.map((row) => {
                const failCopy = COPY_LABELS.filter(f => !row.copy[f.key]);
                const failInfo = INFO_LABELS.filter(f => !row.info[f.key]);
                return (
                  <div key={row.id} className="rounded-xl border border-border bg-card p-3">
                    <p className="font-display text-[11px] font-semibold text-muted-foreground">{row.factoryName}</p>
                    <p className="font-display text-[12.5px] font-semibold text-foreground">{row.productName}</p>
                    <ul className="mt-1.5 space-y-1">
                      {failCopy.map(f => (
                        <li key={f.key} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <AlertTriangle className="h-3 w-3 text-indigo-500 flex-shrink-0" />
                            {f.label}
                          </span>
                          <button
                            onClick={() => handleCrossClick('copy')}
                            className="rounded bg-indigo-500/10 px-2 py-0.5 text-[10.5px] font-medium text-indigo-600 hover:bg-indigo-500/20 whitespace-nowrap"
                          >
                            前往填寫
                          </button>
                        </li>
                      ))}
                      {failInfo.map(f => (
                        <li key={f.key} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                            {f.label}
                          </span>
                          <button
                            onClick={() => handleCrossClick('info')}
                            className="rounded bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 hover:bg-amber-500/20 whitespace-nowrap"
                          >
                            前往填寫
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

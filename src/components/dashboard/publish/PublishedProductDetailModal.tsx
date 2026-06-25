import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  X, Loader2, Package, Tag, DollarSign, Ruler, Boxes, Store, RefreshCw, ImageIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { PUBLISH_STATE_META, type PublishState } from '@/constants/analytics-mock';
import { Textarea } from '@/components/ui/textarea';

interface ShopifyVariant {
  id?: string | number;
  title?: string;
  option1?: string;
  option2?: string;
  option3?: string;
  sku?: string;
  price?: string | number;
  inventory_quantity?: number;
}

interface ShopifyImage {
  id?: string | number;
  src?: string;
  alt?: string;
  position?: number;
}

export interface PublishedProductRow {
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

export interface PublishedDisplayProduct {
  id: string;
  shopify_product_id: string;
  title: string;
  state: PublishState;
  raw: PublishedProductRow;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '—';
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(num)) return '—';
  return `$${num.toLocaleString()}`;
}

function variantLabel(v: ShopifyVariant): string {
  const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(' / ');
  return opts || v.title || 'Default';
}

function ReadOnlyField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn('text-xs text-foreground break-all', mono && 'font-mono-data')}>
        {value || <span className="text-muted-foreground/50">—</span>}
      </div>
    </div>
  );
}

export function PublishedProductDetailModal({
  product,
  onClose,
  onSaved,
}: {
  product: PublishedDisplayProduct;
  onClose: () => void;
  onSaved: () => void;
}) {
  const r = product.raw;
  const [isSaving, setIsSaving] = useState(false);
  const [selectedImg, setSelectedImg] = useState<string | null>(null);
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);

  const [editTitle, setEditTitle] = useState('');
  const [editBodyHtml, setEditBodyHtml] = useState('');
  const [editVendor, setEditVendor] = useState('');
  const [editL1, setEditL1] = useState('');
  const [editL2, setEditL2] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCompareAtPrice, setEditCompareAtPrice] = useState('');
  const [editTagsText, setEditTagsText] = useState('');
  const [editNormalSize, setEditNormalSize] = useState('');
  const [editMaterials, setEditMaterials] = useState('');

  useEffect(() => {
    supabase
      .from('product_category')
      .select('level1, level2, sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data: cats }) => { if (cats) setCategoryPairs(cats as { level1: string; level2: string }[]); });
  }, []);

  useEffect(() => {
    const ptParts = (r.product_type || '').split(' / ');
    setEditTitle(r.title || '');
    setEditBodyHtml(r.body_html || '');
    setEditVendor(r.vendor || '');
    setEditL1(ptParts[0] || '');
    setEditL2(ptParts[1] || '');
    setEditPrice(r.price != null ? String(r.price) : '');
    setEditCompareAtPrice(r.compare_at_price != null ? String(r.compare_at_price) : '');
    setEditTagsText(Array.isArray(r.tags) ? r.tags.join(', ') : '');
    setEditNormalSize(r['my_fields.normal_size'] || '');
    setEditMaterials(r['my_fields.materials'] || '');
    setSelectedImg(r.image_url || null);
  }, [r]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const level1Options = useMemo(
    () => Array.from(new Set(categoryPairs.map((p) => p.level1))),
    [categoryPairs]
  );
  const getLevel2Options = (l1: string) =>
    Array.from(new Set(categoryPairs.filter((p) => p.level1 === l1 && p.level2).map((p) => p.level2)));

  const rawImgs: ShopifyImage[] = Array.isArray(r.images) ? r.images : [];
  const sortedImgs = [...rawImgs].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const allImages: string[] = useMemo(() => {
    const urls: string[] = [];
    if (sortedImgs.length > 0) {
      for (const im of sortedImgs) {
        if (im.src && !urls.includes(im.src)) urls.push(im.src);
      }
    } else if (r.image_url) {
      urls.push(r.image_url);
    }
    return urls;
  }, [sortedImgs, r.image_url]);

  const displayImg = (selectedImg && allImages.includes(selectedImg)) ? selectedImg : (allImages[0] || '');
  const variants: ShopifyVariant[] = Array.isArray(r.variants) ? r.variants : [];

  const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-body text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors';
  const textareaCls = `${inputCls} resize-y`;

  const handleSave = async () => {
    const shopifyId = r.shopify_product_id;
    if (!shopifyId) { toast.error('此產品沒有 Shopify ID，無法同步'); return; }
    setIsSaving(true);
    const toastId = toast.loading('正在更新 Shopify 產品...');
    try {
      const priceNum = editPrice !== '' ? parseFloat(editPrice) : null;
      const compareNum = editCompareAtPrice !== '' ? parseFloat(editCompareAtPrice) : null;
      const productType = [editL1, editL2].filter(Boolean).join(' / ') || '';
      const tags = editTagsText.split(',').map((t) => t.trim()).filter(Boolean);
      const metafields: Record<string, string> = {};
      if (editNormalSize.trim()) metafields['my_fields.normal_size'] = editNormalSize.trim();
      if (editMaterials.trim()) metafields['my_fields.materials'] = editMaterials.trim();

      const { data, error } = await supabase.functions.invoke('supabase-functions-update-shopify-product', {
        body: {
          shopify_product_id: shopifyId,
          source_product_id: r.source_product_id ?? null,
          title: editTitle,
          body_html: editBodyHtml,
          price: priceNum,
          compare_at_price: compareNum,
          vendor: editVendor,
          product_type: productType,
          tags,
          images: allImages.length > 0 ? allImages : undefined,
          metafields: Object.keys(metafields).length > 0 ? metafields : undefined,
        },
      });
      if (error || data?.error || data?.success === false) {
        toast.error('Shopify 更新失敗', {
          id: toastId,
          description: error?.message || data?.error || '請稍後重試',
          duration: 8000,
        });
        return;
      }
      toast.success('已更新並同步到 Shopify', {
        id: toastId,
        description: '產品資料已更新到 Shopify 及本地。',
        duration: 4000,
      });
      onSaved();
      onClose();
    } catch (e) {
      toast.error('Shopify 更新失敗', {
        id: toastId,
        description: e instanceof Error ? e.message : '未知錯誤',
        duration: 8000,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col bg-background rounded-2xl shadow-2xl overflow-hidden border border-border"
        style={{ width: '1200px', height: '800px', maxWidth: '96vw', maxHeight: '96vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onClose}
              className="shrink-0 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              退出
            </button>
            <span className="text-muted-foreground/40">·</span>
            <span className="font-display text-sm font-semibold truncate text-foreground">{editTitle || product.title}</span>
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium', PUBLISH_STATE_META[product.state].className)}>
              {PUBLISH_STATE_META[product.state].label}
            </span>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving || !r.shopify_product_id}
            className="shrink-0 flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            更新並同步到 Shopify
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: media + read-only meta */}
          <div className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-6 bg-muted/10">
            <div className="aspect-square w-full overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center">
              {displayImg ? (
                <img src={displayImg} alt={editTitle} className="h-full w-full object-contain" />
              ) : (
                <ImageIcon className="h-16 w-16 text-muted-foreground/30" />
              )}
            </div>
            {allImages.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  <ImageIcon className="h-3 w-3" />
                  媒體 ({allImages.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {allImages.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedImg(src)}
                      className={cn(
                        'h-14 w-14 overflow-hidden rounded-lg border-2 bg-muted transition-all',
                        selectedImg === src ? 'border-primary ring-1 ring-primary/30' : 'border-transparent hover:border-muted-foreground/40'
                      )}
                    >
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Read-only Shopify metadata */}
            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <Store className="h-3.5 w-3.5 text-primary" />
                Shopify 資訊（唯讀）
              </div>
              <ReadOnlyField label="Shopify ID" value={r.shopify_product_id} mono />
              <ReadOnlyField label="狀態" value={r.status} />
              <ReadOnlyField label="上架時間" value={r.published_at ? fmtDate(r.published_at) : null} />
              <ReadOnlyField label="導入時間" value={fmtDate(r.imported_at)} />
              <ReadOnlyField label="Shopify 建立" value={r.shopify_created_at ? fmtDate(r.shopify_created_at) : null} />
              <ReadOnlyField label="Shopify 更新" value={r.shopify_updated_at ? fmtDate(r.shopify_updated_at) : null} />
              {r.shop_domain && <ReadOnlyField label="店舖" value={r.shop_domain} mono />}
              {r.handle && <ReadOnlyField label="Handle" value={`/${r.handle}`} mono />}
            </section>
          </div>

          {/* Right: editable fields */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <section className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Package className="h-4 w-4 text-primary" />
                一般資料
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">產品名稱</label>
                <input className={inputCls} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="產品標題" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">產品描述</label>
                <textarea
                  className={textareaCls}
                  rows={8}
                  value={editBodyHtml}
                  onChange={(e) => setEditBodyHtml(e.target.value)}
                  placeholder="產品描述（支援 HTML）"
                />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Tag className="h-4 w-4 text-amber-500" />
                分類 / 廠商
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">一級分類</label>
                  <select className={`${inputCls} cursor-pointer`} value={editL1} onChange={(e) => { setEditL1(e.target.value); setEditL2(''); }}>
                    <option value="">— 請選擇 —</option>
                    {level1Options.map((l1) => <option key={l1} value={l1}>{l1}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">二級分類</label>
                  <select className={`${inputCls} cursor-pointer`} value={editL2} onChange={(e) => setEditL2(e.target.value)} disabled={!editL1}>
                    <option value="">— 請選擇 —</option>
                    {getLevel2Options(editL1).map((l2) => <option key={l2} value={l2}>{l2}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">廠商 (Vendor)</label>
                <input className={inputCls} value={editVendor} onChange={(e) => setEditVendor(e.target.value)} placeholder="廠商名稱" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">標籤（以逗號分隔）</label>
                <input className={inputCls} value={editTagsText} onChange={(e) => setEditTagsText(e.target.value)} placeholder="標籤1, 標籤2" />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <DollarSign className="h-4 w-4 text-green-500" />
                價格
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">售價 (HK$)</label>
                  <input className={inputCls} type="number" min="0" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Compare-at 價格 (HK$)</label>
                  <input className={inputCls} type="number" min="0" step="0.01" value={editCompareAtPrice} onChange={(e) => setEditCompareAtPrice(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Ruler className="h-4 w-4 text-sky-500" />
                尺寸與物料
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">產品尺寸（my_fields.normal_size）</label>
                <input className={inputCls} value={editNormalSize} onChange={(e) => setEditNormalSize(e.target.value)} placeholder="例如 1200(W)x600(D)x750(H)(mm)" />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Boxes className="h-3 w-3" />
                  產品物料
                </label>
                <Textarea
                  value={editMaterials}
                  onChange={(e) => setEditMaterials(e.target.value)}
                  rows={4}
                  className="min-h-[5.5rem] resize-y rounded-lg bg-background font-body text-sm"
                  placeholder="輸入產品物料..."
                />
              </div>
            </section>

            {/* Variants — read-only */}
            {variants.length > 0 && (
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="text-sm font-bold text-foreground">
                  規格 / Variants（{variants.length}）
                </div>
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
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

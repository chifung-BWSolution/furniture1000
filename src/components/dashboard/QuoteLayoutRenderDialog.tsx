import { useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingImage } from '@/components/ui/loading-image';
import { resizeImageToBlob, uploadBlobToStorage } from '@/lib/imageStorage';
import type { QuoteFloorPlan } from '@/lib/quoteFloorPlan';
import { DEFAULT_LAYOUT_STYLE, type LayoutProduct } from '@/lib/quoteLayoutRender';

export function QuoteLayoutRenderDialog({ plan, products = [], onChange, onClose, title = '渲染圖設置' }: {
  title?: string;
  plan: QuoteFloorPlan;
  products?: LayoutProduct[];
  onChange: (plan: QuoteFloorPlan) => void;
  onClose: () => void;
}) {
  const state = plan.rendering || { style: DEFAULT_LAYOUT_STYLE, notes: {}, images: {} };
  const latest = useRef({ plan, state, onChange });
  latest.current = { plan, state, onChange };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (patch: Partial<typeof state>) => {
    const current = latest.current;
    const rendering = { ...current.state, ...patch, images: {} };
    latest.current = { ...current, state: rendering };
    current.onChange({ ...current.plan, rendering });
  };
  const choose = (id: string, url: string) => {
    const productImages = { ...latest.current.state.productImages };
    if (url) productImages[id] = url;
    else delete productImages[id];
    update({ productImages });
  };
  const upload = async (id: string, file: File) => {
    if (busy) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      setError('請選擇不超過 15 MB 的 JPG、PNG 或 WebP 單品圖。'); return;
    }
    setBusy(true); setError('');
    try {
      const blob = await resizeImageToBlob(file, 1800);
      const url = await uploadBlobToStorage(blob, crypto.randomUUID(), 'quote-render-product');
      choose(id, url);
    } catch { setError('單品圖上傳失敗，請重新選擇圖片再試。'); }
    finally { setBusy(false); }
  };
  return <Modal open size="lg" title={title} hideClose={busy} onOpenChange={open => { if (!open && !busy) onClose(); }} footer={<Button disabled={busy} onClick={onClose}>完成</Button>}>
    <div className="space-y-6">
      <label className="block space-y-2">
        <span className="text-sm font-medium">全案統一風格</span>
        <Textarea value={state.style} maxLength={1000} rows={4} onChange={e => update({ style: e.target.value })} />
      </label>
      <section aria-label="渲染專用單品圖" className="space-y-3">
        <div><h3 className="text-sm font-medium">渲染專用單品圖</h3><p className="mt-1 text-xs text-muted-foreground">每件產品請選擇只含該款傢俬的白底或去背圖。可確認原圖，或另選單品圖；報價原圖會保留。設定隨報價儲存。</p></div>
        {!products.length && <p className="text-sm text-muted-foreground">加入分區產品後，即可選擇單品圖。</p>}
        {products.map(product => {
          const selected = state.productImages?.[product.id];
          return <div key={product.id} className="flex flex-wrap items-center gap-3 border-b border-border py-3">
            <div className="h-20 w-24 shrink-0 rounded bg-muted">{(selected || product.image) && <LoadingImage src={selected || product.image} alt={product.name} className="h-full w-full" imgClassName="object-contain" />}</div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="break-words text-sm font-medium">{product.name}</p>
              <p className="text-xs text-muted-foreground">{selected ? '已確認渲染用圖' : '尚未確認，請排除含其他桌椅的場景圖'}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy || !product.image} onClick={() => choose(product.id, product.image)}>原圖為單品圖</Button>
                <label className="inline-flex cursor-pointer items-center rounded-md border border-input px-3 py-2 text-xs font-medium focus-within:ring-2 focus-within:ring-ring">
                  {busy ? '上傳中…' : '選擇單品圖'}
                  <input type="file" className="sr-only" aria-label={`為${product.name}選擇單品圖`} accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void upload(product.id, file); }} />
                </label>
                {selected && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => choose(product.id, '')}>取消確認</Button>}
              </div>
            </div>
          </div>;
        })}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>
    </div>
  </Modal>;
}

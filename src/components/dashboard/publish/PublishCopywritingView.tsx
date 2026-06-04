import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  FileText, Sparkles, ChevronLeft, ArrowRight, Loader2,
  UploadCloud, Search, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface CopyItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  images: string[];
  seoTitle: string;
  seoDescription: string;
  handle: string;
}

function slugify(s: string) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9一-鿿-]/g, '').slice(0, 60);
}

export function PublishCopywritingView() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<CopyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('products')
        .select('id,title,description,image_url,images,image_url_2,image_url_3')
        .eq('in_shopify_queue', true)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      const mapped: CopyItem[] = (data || []).map((r: any) => {
        const imgs = [
          (Array.isArray(r.images) && r.images[0]?.src) || r.image_url || '',
          r.image_url_2 || '',
          r.image_url_3 || '',
        ].filter(Boolean);
        return {
          id: r.id,
          title: r.title || '',
          description: r.description || '',
          imageUrl: imgs[0] || '',
          images: imgs,
          seoTitle: r.title || '',
          seoDescription: (r.description || '').slice(0, 160),
          handle: slugify(r.title || ''),
        };
      });
      setItems(mapped);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const product = items.find((p) => p.id === activeId) ?? null;

  // editable draft state
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [imgs, setImgs] = useState<string[]>([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDesc, setSeoDesc] = useState('');
  const [handle, setHandle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const openProduct = (p: CopyItem) => {
    setActiveId(p.id);
    setName(p.title);
    setDesc(p.description);
    setImgs(p.images);
    setSeoTitle(p.seoTitle);
    setSeoDesc(p.seoDescription);
    setHandle(p.handle);
  };

  const addImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setImgs((prev) => [...prev, reader.result as string]);
    reader.readAsDataURL(file);
  };

  // ─── List view ───────────────────────────────────────────────────
  if (!product) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-8 py-3.5">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">產品文案</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-primary">
            {items.length} 件產品待處理
          </span>
        </div>
        <div className="flex-1 overflow-auto p-8">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="font-display text-sm text-muted-foreground">尚無待處理產品</p>
              <p className="font-body text-[12px] text-muted-foreground/70">到「產品管理 → 待處理產品」點「A 加入Shopify」即可加入</p>
            </div>
          ) : (
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-2">
              {items.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProduct(p)}
                  className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
                >
                  <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover bg-muted" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-[14px] font-bold text-foreground line-clamp-1">{p.title}</h3>
                    <p className="mt-1 line-clamp-2 font-body text-[12px] leading-relaxed text-muted-foreground">{p.description || '尚未填寫產品說明'}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary">編輯文案 <ArrowRight className="h-3 w-3" /></span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Editor view ─────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-8 py-3.5">
        <button onClick={() => setActiveId(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> 返回列表
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => toast.success('已套用 AI 建議文案')} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            <Sparkles className="h-3.5 w-3.5" /> AI 建議文案
          </button>
          <button
            onClick={() => toast.success('已提交到下一步', { description: '前往「產品信息」補充規格與分類' })}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/80 px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md transition-opacity hover:opacity-90"
          >
            提交到下一步 <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Shopify 產品名稱 */}
          <Section title="Shopify 產品名稱" desc="顯示於 Shopify 商店與搜尋結果的標題">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 font-display text-base font-semibold text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </Section>

          {/* Shopify 產品說明 */}
          <Section title="Shopify 產品說明" desc="支援直接貼上圖片，格式與 Shopify 後台一致">
            <div className="rounded-xl border border-border bg-card">
              {/* fake toolbar to mimic Shopify rich editor */}
              <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-[12px] text-muted-foreground">
                <span className="rounded px-2 py-0.5 font-bold hover:bg-muted">B</span>
                <span className="rounded px-2 py-0.5 italic hover:bg-muted">I</span>
                <span className="rounded px-2 py-0.5 underline hover:bg-muted">U</span>
                <span className="mx-1 h-4 w-px bg-border" />
                <span className="rounded px-2 py-0.5 hover:bg-muted">• 列表</span>
                <span className="rounded px-2 py-0.5 hover:bg-muted">🔗 連結</span>
                <span className="rounded px-2 py-0.5 hover:bg-muted">🖼 圖片</span>
              </div>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={8}
                placeholder="輸入產品說明，可直接貼上圖片…"
                className="w-full resize-y rounded-b-xl bg-transparent px-4 py-3 font-body text-[13.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
            </div>
          </Section>

          {/* Shopify 產品圖片 */}
          <Section title="Shopify 產品圖片" desc="請至少上傳 1 張產品主圖、2 張不同角度圖、1 張產品情景圖">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addImageFile(f); e.target.value = ''; }} />
            <div className="flex flex-wrap gap-3">
              {imgs.map((src, i) => (
                <div key={i} className="group relative h-28 w-28 overflow-hidden rounded-xl border border-border bg-muted">
                  <img src={src} alt={`圖 ${i + 1}`} className="h-full w-full object-cover" />
                  {i === 0 && <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">主圖</span>}
                  <button onClick={() => setImgs((prev) => prev.filter((_, idx) => idx !== i))} className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"><X className="h-3 w-3" /></button>
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()} className="flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
                <UploadCloud className="h-6 w-6" />
                <span className="text-[10.5px]">上傳圖片</span>
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/70">已上傳 {imgs.length} 張 · 建議共 4 張（主圖 + 2 角度 + 情景）</p>
          </Section>

          {/* Shopify 搜尋引擎產品資訊 */}
          <Section title="Shopify 搜尋引擎產品資訊" desc="控制產品在 Google 搜尋結果的顯示">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="頁面標題" icon={<Search className="h-3 w-3" />}>
                <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </Field>
              <Field label="Meta 描述" hint={`${seoDesc.length}/160`}>
                <textarea value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} maxLength={160} rows={2} className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </Field>
              <Field label="網址控制代碼">
                <div className="flex items-center rounded-lg border border-border bg-card focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                  <span className="pl-3 font-mono-data text-[11px] text-muted-foreground/60">/products/</span>
                  <input value={handle} onChange={(e) => setHandle(e.target.value)} className="w-full bg-transparent px-1 py-2 font-mono-data text-[12px] focus:outline-none" />
                </div>
              </Field>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="mb-3">
        <h3 className="font-display text-sm font-bold text-foreground">{title}</h3>
        {desc && <p className="mt-0.5 font-body text-[11.5px] text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, icon, children }: { label: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="flex items-center gap-1 font-body text-[12px] font-medium text-muted-foreground">{icon}{label}</label>
        {hint && <span className="font-mono-data text-[10px] text-muted-foreground/60">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

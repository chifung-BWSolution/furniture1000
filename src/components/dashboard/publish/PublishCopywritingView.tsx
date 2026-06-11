import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  FileText, Sparkles, ChevronLeft, ArrowRight, Loader2,
  UploadCloud, Search, X, Bold, Italic, Underline as UnderlineIcon,
  List, ListOrdered, Image as ImageIcon, Palette,
  AlignLeft, AlignCenter, AlignRight, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { usePublishList } from './usePublishList';

interface CopyItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  images: string[];
  factory: string;
  level1: string;
  level2: string;
  seoTitle: string;
  seoDescription: string;
  handle: string;
  tags: string[];
  price: number | null;
  salePrice: number | null;
  sku: string;
}

function slugify(s: string) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9一-鿿-]/g, '').slice(0, 60);
}

interface Props {
  focusProductId?: string | null;
  onFocusHandled?: () => void;
}

export function PublishCopywritingView({ focusProductId, onFocusHandled }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Only show products where copywriting is NOT yet done
  const { rows, totalCount, isLoading, Toolbar, Pagination } = usePublishList({
    select: 'id,title,description,image_url,images,image_url_2,image_url_3,factories_display_name,level1_category,level2_category,tags,sale_price,price,sku,model',
    applyBaseFilters: (q) => q.eq('in_shopify_queue', true).or('copy_done.is.null,copy_done.eq.false'),
    reloadKey,
  });

  const items: CopyItem[] = useMemo(() => rows.map((r: any) => {
    const primaryImg = (Array.isArray(r.images) && r.images[0]?.src) || r.image_url || '';
    const extraImgs = [r.image_url_2, r.image_url_3].filter(Boolean) as string[];
    // Also pull additional images from the images JSONB array (index 1+)
    if (Array.isArray(r.images)) {
      r.images.slice(1).forEach((img: any) => {
        const src = img?.src || img;
        if (src && typeof src === 'string' && !extraImgs.includes(src)) extraImgs.push(src);
      });
    }
    return {
      id: r.id,
      title: r.title || '',
      description: r.description || '',
      imageUrl: primaryImg,
      images: extraImgs,
      factory: r.factories_display_name || '',
      level1: r.level1_category || '',
      level2: r.level2_category || '',
      seoTitle: r.title || '',
      seoDescription: (r.description || '').slice(0, 160),
      handle: slugify(r.title || ''),
      tags: Array.isArray(r.tags) ? r.tags : [],
      price: r.price != null ? Number(r.price) : null,
      salePrice: r.sale_price != null ? Number(r.sale_price) : null,
      sku: r.sku || r.model || '',
    };
  }), [rows]);

  const product = items.find((p) => p.id === activeId) ?? null;

  // Scroll to focused product once items are loaded
  useEffect(() => {
    if (!focusProductId || items.length === 0) return;
    const el = cardRefs.current[focusProductId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary/40', 'border-primary/40');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary/40', 'border-primary/40'), 2000);
      onFocusHandled?.();
    }
  }, [focusProductId, items]);

  // editable draft state
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  // primaryImg: the main product image (image_url)
  const [primaryImg, setPrimaryImg] = useState<string>('');
  // extraImgs: additional images (images jsonb array)
  const [extraImgs, setExtraImgs] = useState<string[]>([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDesc, setSeoDesc] = useState('');
  const [handle, setHandle] = useState('');
  const primaryFileRef = useRef<HTMLInputElement>(null);
  const extraFileRef = useRef<HTMLInputElement>(null);

  // Load saved ready_to_shopify data when opening a product
  const openProduct = useCallback(async (p: CopyItem) => {
    setActiveId(p.id);
    setName(p.title);
    setDesc(p.description);
    setPrimaryImg(p.imageUrl);
    setExtraImgs(p.images);
    setSeoTitle(p.seoTitle);
    setSeoDesc(p.seoDescription);
    setHandle(p.handle);

    // Fetch previously saved data from ready_to_shopify
    const { data: rts } = await supabase
      .from('ready_to_shopify')
      .select('title,body_html,image_url,images,shopify_page_title,shopify_page_description,shopify_url,handle')
      .eq('product_id', p.id)
      .maybeSingle();

    if (rts) {
      if (rts.title) setName(rts.title);
      if (rts.body_html) setDesc(rts.body_html);
      if (rts.image_url) setPrimaryImg(rts.image_url);
      if (Array.isArray(rts.images) && rts.images.length > 0) {
        setExtraImgs(rts.images.map((img: any) => img?.src || img).filter(Boolean));
      }
      if (rts.shopify_page_title) setSeoTitle(rts.shopify_page_title);
      if (rts.shopify_page_description) setSeoDesc(rts.shopify_page_description);
      if (rts.shopify_url) setHandle(rts.shopify_url);
      else if (rts.handle) setHandle(rts.handle);
    }
  }, []);

  // Drag-to-swap state
  const [dragSrc, setDragSrc] = useState<{ zone: 'primary' | 'extra'; index?: number } | null>(null);

  // Handle drop: swap primary <-> extra or reorder within extra
  const handleDrop = useCallback((target: { zone: 'primary' | 'extra'; index?: number }) => {
    if (!dragSrc) return;
    if (dragSrc.zone === target.zone && dragSrc.index === target.index) return;

    if (dragSrc.zone === 'primary' && target.zone === 'extra' && target.index !== undefined) {
      // Swap primary with an extra image
      const targetSrc = extraImgs[target.index];
      setExtraImgs((prev) => prev.map((img, i) => i === target.index ? primaryImg : img));
      setPrimaryImg(targetSrc);
    } else if (dragSrc.zone === 'extra' && target.zone === 'primary' && dragSrc.index !== undefined) {
      // Swap an extra image with primary
      const srcImg = extraImgs[dragSrc.index];
      setExtraImgs((prev) => prev.map((img, i) => i === dragSrc.index ? primaryImg : img));
      setPrimaryImg(srcImg);
    } else if (dragSrc.zone === 'extra' && target.zone === 'extra' && dragSrc.index !== undefined && target.index !== undefined) {
      // Reorder within extra images
      const newExtra = [...extraImgs];
      const [moved] = newExtra.splice(dragSrc.index, 1);
      newExtra.splice(target.index, 0, moved);
      setExtraImgs(newExtra);
    }
    setDragSrc(null);
  }, [dragSrc, primaryImg, extraImgs]);

  // Submit — save edits + set copy_done=true → moves product to 產品信息
  const handleSubmit = async () => {
    if (!activeId) return;
    const item = items.find((p) => p.id === activeId);
    if (!item) return;
    setIsSubmitting(true);
    try {
      // 1. Update products table
      const { error } = await supabase
        .from('products')
        .update({
          title: name,
          description: desc,
          copy_done: true,
          copy_done_at: new Date().toISOString(),
        })
        .eq('id', activeId);
      if (error) {
        toast.error('提交失敗', { description: error.message });
        return;
      }

      // 2. Upsert ALL fields into ready_to_shopify
      // image_url = primary image, images = extra images array
      const imagesJson = extraImgs.map((src, idx) => ({ src, position: idx + 1 }));
      const { error: rtsError } = await supabase
        .from('ready_to_shopify')
        .upsert({
          product_id: activeId,
          title: name,
          body_html: desc,
          vendor: item.factory || null,
          product_type: [item.level1, item.level2].filter(Boolean).join(' / ') || null,
          handle: handle || slugify(name),
          status: 'draft',
          // Primary image → image_url
          image_url: primaryImg || null,
          // Additional images → images (jsonb)
          images: imagesJson.length > 0 ? imagesJson : null,
          tags: item.tags.length > 0 ? item.tags : null,
          price: item.salePrice ?? item.price ?? null,
          // SEO fields
          shopify_page_title: seoTitle || name || null,
          shopify_page_description: seoDesc || null,
          shopify_url: handle || slugify(name) || null,
          imported_at: new Date().toISOString(),
        }, { onConflict: 'product_id' });

      if (rtsError) {
        toast.warning('產品文案已提交，但同步至 ready_to_shopify 失敗', { description: rtsError.message });
      } else {
        toast.success('已提交到下一步', { description: '產品已移至「產品信息」，資料已同步至 ready_to_shopify' });
      }

      setActiveId(null);
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('提交時發生錯誤，請重試');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addPrimaryFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setPrimaryImg(reader.result as string);
    reader.readAsDataURL(file);
  };

  const addExtraFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setExtraImgs((prev) => [...prev, reader.result as string]);
    reader.readAsDataURL(file);
  };

  // Derive suitable usage scenes from category
  const deriveScenes = (level1: string, level2: string): string => {
    const combined = `${level1} ${level2}`.toLowerCase();
    if (/大班椅|行政椅|老闆椅|executive/.test(combined)) return '辦公室行政房、老闆房、高管辦公室';
    if (/辦公椅|電腦椅|工作椅|mesh|網背/.test(combined)) return '開放式辦公室、工作站、共享辦公空間';
    if (/會議椅|培訓椅|training/.test(combined)) return '會議室、培訓中心、多功能廳';
    if (/沙發|接待|lounge|休閑/.test(combined)) return '辦公室接待區、客廳、酒店大堂';
    if (/課室|學生|學校|school|classroom/.test(combined)) return '學校課室、補習社、教育中心';
    if (/實驗室|lab/.test(combined)) return '實驗室、科研中心、醫療機構';
    if (/餐廳|dining|餐飲/.test(combined)) return '餐廳、咖啡廳、食堂';
    if (/班台|辦公桌|executive desk|工作臺/.test(combined)) return '辦公室、行政房、工作空間';
    if (/儲物|storage|書櫃|文件/.test(combined)) return '辦公室、圖書館、學校、家居';
    if (/前台|接待台|reception/.test(combined)) return '公司前台、酒店接待處、服務台';
    if (/茶几|coffee table|角幾/.test(combined)) return '客廳、辦公室休息區、酒店大堂';
    return '辦公室、商業空間、公共場所';
  };

  // AI generate description via gemini-proxy
  // Rewrites existing desc into a ~300-word professional copywriting piece
  const [isGenerating, setIsGenerating] = useState(false);
  const handleGenerateDesc = useCallback(async () => {
    if (!product) return;
    setIsGenerating(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const categoryParts = [product.level1, product.level2].filter(Boolean).join(' › ');
      const scenes = deriveScenes(product.level1, product.level2);
      // Strip HTML tags from current desc for use as reference material
      const rawDesc = desc.replace(/<[^>]*>/g, '').trim();

      const prompt = `你是一位資深的商業傢私品牌文案總監，專注為香港及大灣區 B2B 客戶撰寫高端家具電商文案。

請根據以下產品資料，把現有的「產品說明原文」重新改寫成一段約 300 字的繁體中文商業文案，直接輸出正文，不要標題、不要分點列表、不要任何格式符號。

【產品名稱】${name || product.title}
【產品分類】${categoryParts || '家具'}
【適用情景】${scenes}
【產品說明原文（素材參考）】
${rawDesc || '（暫無原文，請根據產品名稱及分類發揮）'}

【文案要求】
- 約 300 字，繁體中文
- 以專業商業傢私角度撰寫，語氣自信、簡潔、有質感
- 開首直接說明產品定位及核心賣點
- 中段結合「${scenes}」的使用場景，說明產品如何提升空間質感及使用者體驗
- 末段強調產品材質工藝或耐用性，增加購買信心
- 不要使用「本產品」、「該產品」等字眼，直接用產品名稱或「它」
- 不要 markdown 格式，純文字段落`;

      const res = await fetch(`${supabaseUrl}/functions/v1/supabase-functions-gemini-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });
      if (!res.ok) throw new Error(`Gemini proxy error: ${res.status}`);
      const data = await res.json();
      const generated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!generated) throw new Error('Gemini 沒有返回內容');
      setDesc(generated);
      toast.success('AI 文案已生成', { description: '已根據產品分類及情景生成約 300 字文案，可繼續編輯' });
    } catch (err) {
      toast.error('AI 生成失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    } finally {
      setIsGenerating(false);
    }
  }, [product, name, desc]);

  // ─── List view ───────────────────────────────────────────────────
  if (!product) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-8 py-3">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">產品文案</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-primary">
            {totalCount} 件產品待處理
          </span>
        </div>
        {Toolbar}
        <div className="flex-1 overflow-auto p-8">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="font-display text-sm text-muted-foreground">尚無符合條件的產品</p>
              <p className="font-body text-[12px] text-muted-foreground/70">到「產品管理 → 待處理產品」點「A 加入Shopify」即可加入，或調整上方篩選</p>
            </div>
          ) : (
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-2">
              {items.map((p) => (
                <button
                  key={p.id}
                  ref={(el) => { cardRefs.current[p.id] = el; }}
                  onClick={() => openProduct(p)}
                  className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
                >
                  <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover bg-muted" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-[14px] font-bold text-foreground line-clamp-1">{p.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {p.factory && <span className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">{p.factory}</span>}
                      {p.level1 && <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-body text-[10px] text-indigo-600">{p.level1}</span>}
                      {p.level2 && <span className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground">{p.level2}</span>}
                    </div>
                    <p className="mt-1 line-clamp-1 font-body text-[12px] leading-relaxed text-muted-foreground">{p.description || '尚未填寫產品說明'}</p>
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary">編輯文案 <ArrowRight className="h-3 w-3" /></span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {Pagination}
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
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/80 px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            提交到下一步
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

          {/* Shopify 產品說明 — rich editor */}
          <Section
            title="Shopify 產品說明"
            desc="支援直接貼上圖片，格式與 Shopify 後台一致"
            action={
              <button
                type="button"
                onClick={handleGenerateDesc}
                disabled={isGenerating}
                className="flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-500/20 disabled:opacity-60 transition-colors dark:text-indigo-400"
              >
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {isGenerating ? 'AI 生成中...' : 'AI 生成'}
              </button>
            }
          >
            <RichEditor value={desc} onChange={setDesc} forceUpdateKey={isGenerating ? 'generating' : desc} />
          </Section>

          {/* Shopify 產品圖片 — 左主圖 / 右其他圖，支援拖拉交換 */}
          <Section
            title="Shopify 產品圖片"
            desc="左側為產品主圖（image_url），右側為其他圖片（images）。拖拉圖片可互換位置。"
          >
            <input ref={primaryFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addPrimaryFile(f); e.target.value = ''; }} />
            <input ref={extraFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addExtraFile(f); e.target.value = ''; }} />

            <div className="flex gap-6">
              {/* Left: Primary image (single) */}
              <div className="flex flex-col gap-2">
                <span className="font-body text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">產品主圖</span>
                {primaryImg ? (
                  <div
                    className="group relative h-40 w-40 overflow-hidden rounded-xl border-2 border-primary/40 bg-muted cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={() => setDragSrc({ zone: 'primary' })}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop({ zone: 'primary' })}
                  >
                    <img src={primaryImg} alt="主圖" className="h-full w-full object-cover pointer-events-none" />
                    <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">主圖</span>
                    <button
                      onClick={() => setPrimaryImg('')}
                      className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => primaryFileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop({ zone: 'primary' })}
                    className="flex h-40 w-40 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/40 text-primary transition-colors hover:bg-primary/5"
                  >
                    <UploadCloud className="h-6 w-6" />
                    <span className="text-[10.5px] font-medium">上傳主圖</span>
                  </button>
                )}
              </div>

              {/* Divider */}
              <div className="flex items-stretch">
                <div className="w-px bg-border my-2" />
              </div>

              {/* Right: Extra images (multiple) */}
              <div className="flex flex-col gap-2 flex-1">
                <span className="font-body text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  其他圖片 <span className="text-muted-foreground/50 normal-case font-normal">（可多張）</span>
                </span>
                <div className="flex flex-wrap gap-3">
                  {extraImgs.map((src, i) => (
                    <div
                      key={i}
                      className="group relative h-28 w-28 overflow-hidden rounded-xl border border-border bg-muted cursor-grab active:cursor-grabbing"
                      draggable
                      onDragStart={() => setDragSrc({ zone: 'extra', index: i })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop({ zone: 'extra', index: i })}
                    >
                      <img src={src} alt={`圖 ${i + 2}`} className="h-full w-full object-cover pointer-events-none" />
                      <button
                        onClick={() => setExtraImgs((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => extraFileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop({ zone: 'extra', index: extraImgs.length })}
                    className="flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <UploadCloud className="h-5 w-5" />
                    <span className="text-[10.5px]">新增圖片</span>
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground/60">
                  共 {1 + extraImgs.length} 張 · 拖拉可互換主圖與其他圖片位置
                </p>
              </div>
            </div>
          </Section>

          {/* Shopify 搜尋引擎產品資訊 */}
          <Section title="Shopify 搜尋引擎產品資訊" desc="控制產品在 Google 搜尋結果的顯示">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="頁面標題" icon={<Search className="h-3 w-3" />}>
                <input
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </Field>
              <Field label="Meta 描述" hint={`${seoDesc.length}/160`}>
                <textarea
                  value={seoDesc}
                  onChange={(e) => setSeoDesc(e.target.value)}
                  maxLength={160}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </Field>
              <Field label="網址控制代碼">
                <div className="flex items-center rounded-lg border border-border bg-card focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                  <span className="pl-3 font-mono-data text-[11px] text-muted-foreground/60">/products/</span>
                  <input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    className="w-full bg-transparent px-1 py-2 font-mono-data text-[12px] focus:outline-none"
                  />
                </div>
              </Field>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ─── Rich Text Editor ─────────────────────────────────────────────────────────

const ALLOWED_IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_IMG_BYTES = 5 * 1024 * 1024;

const PRESET_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#ffffff',
  '#ff0000', '#ff4500', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#9900ff',
  '#e6194b', '#f58231', '#ffe119', '#3cb44b', '#42d4f4', '#4363d8', '#911eb4', '#f032e6',
];

function RichEditor({ value, onChange, forceUpdateKey }: { value: string; onChange: (v: string) => void; forceUpdateKey?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!forceUpdateKey || forceUpdateKey === 'generating') return;
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceUpdateKey]);

  const exec = useCallback((cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }, [onChange]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    const range = savedRangeRef.current;
    if (!range) return;
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  };

  const handleImageFile = (file: File) => {
    if (!ALLOWED_IMG_TYPES.includes(file.type)) { toast.error('格式不支援，請上傳 PNG、JPG、WEBP 或 SVG'); return; }
    if (file.size > MAX_IMG_BYTES) { toast.error('圖片大小超過 5MB 上限'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, `<img src="${dataUrl}" style="max-width:100%;height:auto;" />`);
      if (editorRef.current) onChange(editorRef.current.innerHTML);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!showColorPicker) return;
    const handler = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColorPicker]);

  const ToolBtn = ({ onClick, title, children, active }: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`flex items-center justify-center rounded p-1.5 transition-colors hover:bg-muted ${active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        <ToolBtn title="粗體 (Ctrl+B)" onClick={() => exec('bold')}><Bold className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="斜體 (Ctrl+I)" onClick={() => exec('italic')}><Italic className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="底線 (Ctrl+U)" onClick={() => exec('underline')}><UnderlineIcon className="h-3.5 w-3.5" /></ToolBtn>
        <div className="relative">
          <ToolBtn title="文字顏色" onClick={() => { saveSelection(); setShowColorPicker((v) => !v); }}>
            <Palette className="h-3.5 w-3.5" />
          </ToolBtn>
          {showColorPicker && (
            <div ref={colorPickerRef} className="absolute left-0 top-full z-50 mt-1 rounded-xl border border-border bg-card p-3 shadow-xl" style={{ width: 180 }}>
              <p className="mb-2 font-body text-[11px] text-muted-foreground">選擇顏色</p>
              <div className="grid grid-cols-8 gap-1">
                {PRESET_COLORS.map((c) => (
                  <button key={c} type="button" title={c} style={{ background: c }}
                    className="h-5 w-5 rounded-sm border border-border/50 hover:scale-110 transition-transform"
                    onMouseDown={(e) => { e.preventDefault(); restoreSelection(); exec('foreColor', c); setShowColorPicker(false); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolBtn title="Bullet 列表" onClick={() => exec('insertUnorderedList')}><List className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="數字列表" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolBtn title="向左對齊" onClick={() => exec('justifyLeft')}><AlignLeft className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="置中對齊" onClick={() => exec('justifyCenter')}><AlignCenter className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="向右對齊" onClick={() => exec('justifyRight')}><AlignRight className="h-3.5 w-3.5" /></ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" />
        <input ref={imgInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.svg" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }}
        />
        <ToolBtn title="插入圖片" onClick={() => imgInputRef.current?.click()}><ImageIcon className="h-3.5 w-3.5" /></ToolBtn>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => { if (editorRef.current) onChange(editorRef.current.innerHTML); }}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (items) {
            for (const item of items) {
              if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) handleImageFile(file);
                return;
              }
            }
          }
        }}
        className="min-h-[180px] px-4 py-3 font-body text-[13.5px] leading-relaxed text-foreground focus:outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_img]:max-w-full [&_img]:h-auto"
        data-placeholder="輸入產品說明，可直接貼上圖片…"
        style={{ whiteSpace: 'pre-wrap' } as React.CSSProperties}
      />
    </div>
  );
}

function Section({ title, desc, action, children }: { title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold text-foreground">{title}</h3>
          {desc && <p className="mt-0.5 font-body text-[11.5px] text-muted-foreground">{desc}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
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

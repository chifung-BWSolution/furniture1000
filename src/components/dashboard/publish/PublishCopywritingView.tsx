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
    select: 'id,title,description,image_url,images,image_url_2,image_url_3,factories_display_name,level1_category,level2_category',
    applyBaseFilters: (q) => q.eq('in_shopify_queue', true).or('copy_done.is.null,copy_done.eq.false'),
    reloadKey,
  });

  const items: CopyItem[] = useMemo(() => rows.map((r: any) => {
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
      factory: r.factories_display_name || '',
      level1: r.level1_category || '',
      level2: r.level2_category || '',
      seoTitle: r.title || '',
      seoDescription: (r.description || '').slice(0, 160),
      handle: slugify(r.title || ''),
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

  // Submit copywriting — save edits + set copy_done=true → moves product to 產品信息
  const handleSubmit = async () => {
    if (!activeId) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({
          title: name,
          description: desc,
          copy_done: true,
        })
        .eq('id', activeId);
      if (error) {
        toast.error('提交失敗', { description: error.message });
        return;
      }
      toast.success('已提交到下一步', { description: '產品已移至「產品信息」頁面補充規格與價格' });
      setActiveId(null);
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('提交時發生錯誤，請重試');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setImgs((prev) => [...prev, reader.result as string]);
    reader.readAsDataURL(file);
  };

  // AI generate description via gemini-proxy
  const [isGenerating, setIsGenerating] = useState(false);
  const handleGenerateDesc = useCallback(async () => {
    if (!product) return;
    setIsGenerating(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const categoryParts = [product.level1, product.level2].filter(Boolean).join(' › ');
      const prompt = `你是一位專業的家具電商文案撰寫員。請根據以下產品資料，撰寫一段約100字的繁體中文產品介紹文案，風格專業親切，適合 Shopify 商品頁面使用。不需要標題，直接寫產品說明正文。

產品名稱：${name || product.title}
產品分類：${categoryParts || '家具'}

文案要求：
- 約100字，繁體中文
- 說明產品用途、設計特點、適用場景
- 語氣專業但親切
- 不要使用「本產品」這類字眼`;

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
      toast.success('AI 文案已生成', { description: '可在下方編輯器中繼續修改' });
    } catch (err) {
      toast.error('AI 生成失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    } finally {
      setIsGenerating(false);
    }
  }, [product, name]);

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
  // Track saved selection for toolbar actions that open popovers
  const savedRangeRef = useRef<Range | null>(null);

  // Sync initial value into editor (only on mount / when activeId changes)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Force-sync when AI generates new content (forceUpdateKey changes)
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

  // Close color picker on outside click
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
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        {/* Bold / Italic / Underline */}
        <ToolBtn title="粗體 (Ctrl+B)" onClick={() => exec('bold')}><Bold className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="斜體 (Ctrl+I)" onClick={() => exec('italic')}><Italic className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="底線 (Ctrl+U)" onClick={() => exec('underline')}><UnderlineIcon className="h-3.5 w-3.5" /></ToolBtn>

        {/* Colour */}
        <div className="relative">
          <ToolBtn
            title="文字顏色"
            onClick={() => { saveSelection(); setShowColorPicker((v) => !v); }}
          >
            <Palette className="h-3.5 w-3.5" />
          </ToolBtn>
          {showColorPicker && (
            <div
              ref={colorPickerRef}
              className="absolute left-0 top-full z-50 mt-1 rounded-xl border border-border bg-card p-3 shadow-xl"
              style={{ width: 180 }}
            >
              <p className="mb-2 font-body text-[11px] text-muted-foreground">選擇顏色</p>
              <div className="grid grid-cols-8 gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    style={{ background: c }}
                    className="h-5 w-5 rounded-sm border border-border/50 hover:scale-110 transition-transform"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      restoreSelection();
                      exec('foreColor', c);
                      setShowColorPicker(false);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <span className="mx-1 h-4 w-px bg-border" />

        {/* Lists */}
        <ToolBtn title="Bullet 列表" onClick={() => exec('insertUnorderedList')}><List className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="數字列表" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></ToolBtn>

        <span className="mx-1 h-4 w-px bg-border" />

        {/* Alignment */}
        <ToolBtn title="向左對齊" onClick={() => exec('justifyLeft')}><AlignLeft className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="置中對齊" onClick={() => exec('justifyCenter')}><AlignCenter className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="向右對齊" onClick={() => exec('justifyRight')}><AlignRight className="h-3.5 w-3.5" /></ToolBtn>

        <span className="mx-1 h-4 w-px bg-border" />

        {/* Image */}
        <input
          ref={imgInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }}
        />
        <ToolBtn title="插入圖片" onClick={() => imgInputRef.current?.click()}><ImageIcon className="h-3.5 w-3.5" /></ToolBtn>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => { if (editorRef.current) onChange(editorRef.current.innerHTML); }}
        onPaste={(e) => {
          // Handle image paste
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

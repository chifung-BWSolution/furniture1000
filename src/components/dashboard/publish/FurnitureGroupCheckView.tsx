import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  Sofa, Loader2, CheckCheck, ChevronRight, Image as ImageIcon,
  X, Package, Tag, DollarSign, Search, RotateCcw, Save, Check,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FGItem {
  rtsId: string;
  productId: string;
  title: string;
  imageUrl: string;
  factory: string;
  productType: string;
  price: number | null;
  tags: string[];
}

interface FGDetail {
  id: string;
  product_id: string;
  title: string | null;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  price: number | null;
  compare_at_price: number | null;
  image_url: string | null;
  images: any[] | null;
  status: string | null;
  tags: string[] | null;
  shopify_product_id: string | null;
  shopify_page_title: string | null;
  shopify_page_description: string | null;
  shopify_url: string | null;
  handle: string | null;
  imported_at: string | null;
}

interface Props {
  onEnterReadyToPublish?: () => void;
}

// ─── CategoryTagPicker (same as ProductInfoView) ──────────────────────────────

interface BwfCat { id: string; name: string; parent_id: string | null; level: number; sort_order: number }

function CategoryTagPicker({ tags, categories, onChange }: {
  tags: string[];
  categories: BwfCat[];
  onChange: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hoveredL1, setHoveredL1] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 240 });

  const l1s = categories.filter((c) => c.level === 1);
  const getL2s = useCallback((l1Id: string) => categories.filter((c) => c.level === 2 && c.parent_id === l1Id), [categories]);

  const openMenu = () => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
    setHoveredL1(l1s[0]?.id ?? null);
  };
  const closeMenu = useCallback(() => { setOpen(false); setHoveredL1(null); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (anchorRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeMenu]);

  const handleL1Hover = (l1Id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredL1(l1Id), 80);
  };

  const toggleL2 = (l1Name: string, l2Name: string) => {
    let next = [...tags];
    const hasL2 = next.includes(l2Name);
    if (hasL2) {
      next = next.filter((t) => t !== l2Name);
      const siblings = getL2s(l1s.find((l) => l.name === l1Name)?.id ?? '').map((c) => c.name);
      const stillHasSibling = siblings.some((s) => s !== l2Name && next.includes(s));
      if (!stillHasSibling) next = next.filter((t) => t !== l1Name);
    } else {
      if (!next.includes(l1Name)) next = [...next, l1Name];
      next = [...next, l2Name];
    }
    onChange(next);
  };

  const removeTag = (t: string) => onChange(tags.filter((x) => x !== t));
  const activeL2sForHovered = hoveredL1 ? getL2s(hoveredL1) : [];
  const hoveredL1Name = l1s.find((l) => l.id === hoveredL1)?.name ?? '';

  return (
    <div ref={anchorRef}>
      <div
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 cursor-pointer hover:border-primary/50 transition-colors"
        onClick={openMenu}
      >
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            {t}
            <button onClick={(e) => { e.stopPropagation(); removeTag(t); }} className="hover:text-primary/60">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span className="font-body text-[12px] text-muted-foreground/40 select-none">選擇分類標籤...</span>
        )}
        <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
      </div>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999, minWidth: menuPos.width }}
          className="flex rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        >
          <div className="w-40 shrink-0 border-r border-border overflow-auto max-h-72 py-1">
            {l1s.map((l1) => {
              const l2sForL1 = getL2s(l1.id);
              const selectedCount = l2sForL1.filter((l2) => tags.includes(l2.name)).length;
              return (
                <div
                  key={l1.id}
                  onMouseEnter={() => handleL1Hover(l1.id)}
                  className={cn(
                    'flex items-center justify-between gap-1 px-3 py-2 cursor-pointer text-[12px] font-body transition-colors',
                    hoveredL1 === l1.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'
                  )}
                >
                  <span className="truncate">{l1.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {selectedCount > 0 && (
                      <span className="rounded-full bg-primary text-white text-[9px] font-bold min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                        {selectedCount}
                      </span>
                    )}
                    <ChevronRight className="h-3 w-3 opacity-40" />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="w-44 overflow-auto max-h-72 py-1">
            {hoveredL1 && (
              <>
                <div className="px-3 py-1.5 font-body text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border/50 mb-1">
                  {hoveredL1Name}
                </div>
                {activeL2sForHovered.map((l2) => {
                  const sel = tags.includes(l2.name);
                  return (
                    <div
                      key={l2.id}
                      onClick={() => toggleL2(hoveredL1Name, l2.name)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 cursor-pointer text-[12px] font-body transition-colors',
                        sel ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground hover:bg-muted/50'
                      )}
                    >
                      <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors', sel ? 'bg-primary border-primary' : 'border-border')}>
                        {sel && <Check className="h-2.5 w-2.5 text-white" />}
                      </span>
                      <span className="truncate">{l2.name}</span>
                    </div>
                  );
                })}
                {activeL2sForHovered.length === 0 && (
                  <div className="px-3 py-4 text-center font-body text-[11px] text-muted-foreground/50">無二級分類</div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Product Detail Modal ─────────────────────────────────────────────────────

function FGProductDetailModal({
  rtsId,
  onClose,
}: {
  rtsId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<FGDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImg, setSelectedImg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Category data from product_category table (for L1/L2 dropdowns)
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  // Tag categories from bwf_product_categories (for CategoryTagPicker)
  const [bwfCats, setBwfCats] = useState<BwfCat[]>([]);
  // Selected L1 / L2 for the cascading dropdown
  const [editL1, setEditL1] = useState('');
  const [editL2, setEditL2] = useState('');

  // Editable fields
  const [editTitle, setEditTitle] = useState('');
  const [editBodyHtml, setEditBodyHtml] = useState('');
  const [editVendor, setEditVendor] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCompareAtPrice, setEditCompareAtPrice] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editSeoTitle, setEditSeoTitle] = useState('');
  const [editSeoDesc, setEditSeoDesc] = useState('');
  const [editHandle, setEditHandle] = useState('');

  // Fetch category options once
  useEffect(() => {
    supabase
      .from('product_category')
      .select('level1, level2, sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data: cats }) => { if (cats) setCategoryPairs(cats as { level1: string; level2: string }[]); });
    supabase
      .from('bwf_product_categories')
      .select('id,name,parent_id,level,sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data: bwf }) => { if (bwf) setBwfCats(bwf as BwfCat[]); });
  }, []);

  const level1Options = Array.from(new Set(categoryPairs.map((p) => p.level1)));
  const getLevel2Options = (l1: string) =>
    Array.from(new Set(categoryPairs.filter((p) => p.level1 === l1 && p.level2).map((p) => p.level2)));

  useEffect(() => {
    setLoading(true);
    supabase
      .from('ready_to_shopify')
      .select(
        'id,product_id,title,body_html,vendor,product_type,price,compare_at_price,' +
        'image_url,images,status,tags,shopify_product_id,' +
        'shopify_page_title,shopify_page_description,shopify_url,handle,imported_at'
      )
      .eq('id', rtsId)
      .single()
      .then(({ data: row, error }) => {
        if (error || !row) {
          toast.error('讀取產品詳情失敗');
          onClose();
          return;
        }
        const r = row as unknown as FGDetail;
        setData(r);
        setSelectedImg(r.image_url || null);
        // Init editable fields
        setEditTitle(r.title || '');
        setEditBodyHtml(r.body_html || '');
        setEditVendor(r.vendor || '');
        setEditPrice(r.price != null ? String(r.price) : '');
        setEditCompareAtPrice(r.compare_at_price != null ? String(r.compare_at_price) : '');
        // Parse L1 / L2 from product_type ("L1 / L2" format)
        const ptParts = (r.product_type || '').split(' / ');
        setEditL1(ptParts[0] || '');
        setEditL2(ptParts[1] || '');
        const tList = Array.isArray(r.tags) ? r.tags : typeof r.tags === 'string' ? (r.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean) : [];
        setEditTags(tList);
        setEditSeoTitle(r.shopify_page_title || '');
        setEditSeoDesc(r.shopify_page_description || '');
        setEditHandle(r.shopify_url || r.handle || '');
        setLoading(false);
      });
  }, [rtsId, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async () => {
    if (!data) return;
    setIsSaving(true);
    try {
      const productType = [editL1, editL2].filter(Boolean).join(' / ') || null;
      const priceNum = editPrice !== '' ? parseFloat(editPrice) : null;
      const compareNum = editCompareAtPrice !== '' ? parseFloat(editCompareAtPrice) : null;

      const { error } = await supabase
        .from('ready_to_shopify')
        .update({
          title: editTitle || null,
          body_html: editBodyHtml || null,
          product_type: productType,
          vendor: editVendor || null,
          price: isNaN(priceNum as number) ? null : priceNum,
          compare_at_price: isNaN(compareNum as number) ? null : compareNum,
          tags: editTags.length > 0 ? editTags : null,
          shopify_page_title: editSeoTitle || null,
          shopify_page_description: editSeoDesc || null,
          shopify_url: editHandle || null,
          handle: editHandle || null,
        })
        .eq('id', data.id);

      if (error) throw new Error(error.message);
      setData(prev => prev ? {
        ...prev,
        title: editTitle || null,
        body_html: editBodyHtml || null,
        product_type: productType,
        vendor: editVendor || null,
        price: isNaN(priceNum as number) ? null : priceNum,
        compare_at_price: isNaN(compareNum as number) ? null : compareNum,
        tags: editTags.length > 0 ? editTags : null,
        shopify_page_title: editSeoTitle || null,
        shopify_page_description: editSeoDesc || null,
        shopify_url: editHandle || null,
        handle: editHandle || null,
      } : null);
      toast.success('已儲存', { description: '產品資料已更新' });
    } catch (e) {
      toast.error('儲存失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsSaving(false);
    }
  };

  // Build ordered image list: image_url first, then images[]
  const allImages: string[] = [];
  if (data?.image_url) allImages.push(data.image_url);
  if (Array.isArray(data?.images)) {
    for (const img of data.images) {
      const src: string = img?.src || img?.url || (typeof img === 'string' ? img : '');
      if (src && src !== data?.image_url) allImages.push(src);
    }
  }
  const displayImg = selectedImg || allImages[0] || '';

  const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-body text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors';
  const textareaCls = `${inputCls} resize-none`;

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
        {/* ── Modal Header ── */}
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
            <span className="font-display text-sm font-semibold truncate text-foreground">
              {data?.title ?? '讀取中…'}
            </span>
            {data?.shopify_product_id && (
              <span className="shrink-0 flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-green-700 dark:text-green-400">
                ✓ 已同步至全域
              </span>
            )}
          </div>
          {/* Save button */}
          {!loading && data && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="shrink-0 flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              儲存
            </button>
          )}
        </div>

        {/* ── Modal Body ── */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* ── Left Panel: Media + Meta ── */}
            <div className="flex w-[320px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-border p-6 bg-muted/10">
              {/* Main image */}
              <div className="aspect-square w-full overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center">
                {displayImg ? (
                  <img
                    src={displayImg}
                    alt={data.title ?? ''}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImageIcon className="h-16 w-16 text-muted-foreground/30" />
                )}
              </div>

              {/* Thumbnail strip */}
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
                        selectedImg === src
                          ? 'border-primary ring-1 ring-primary/30'
                          : 'border-transparent hover:border-muted-foreground/40'
                      )}
                    >
                      <img src={src} alt={`媒體 ${i + 1}`} className="h-full w-full object-cover" />
                    </button>
                  ))}
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50">
                    <span className="text-xl text-muted-foreground/40">+</span>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  <Tag className="h-3 w-3" />
                  狀態
                </div>
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
                  {data.status || 'draft'}
                </span>
              </div>

              {/* Shopify Product ID */}
              {data.shopify_product_id && (
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Master ID
                  </div>
                  <div className="font-mono text-xs text-primary break-all">{data.shopify_product_id}</div>
                </div>
              )}

              {/* Created time */}
              {data.imported_at && (
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    建立時間
                  </div>
                  <div className="text-xs text-foreground">
                    {new Date(data.imported_at).toLocaleString('zh-TW')}
                  </div>
                </div>
              )}
            </div>

            {/* ── Right Panel: Editable Product Info ── */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* 一般資料 */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Package className="h-4 w-4 text-primary" />
                  一般資料
                </div>
                {/* ready_to_shopify.title */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">產品標題</label>
                  <input
                    className={inputCls}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="產品標題"
                  />
                </div>
                {/* ready_to_shopify.body_html */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">產品說明</label>
                  <textarea
                    className={textareaCls}
                    rows={8}
                    value={editBodyHtml}
                    onChange={e => setEditBodyHtml(e.target.value)}
                    placeholder="產品說明（支援 HTML）"
                  />
                </div>
              </section>

              {/* 分類 / Collection */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Tag className="h-4 w-4 text-amber-500" />
                  分類 / Collection
                </div>
                {/* L1 / L2 cascading select → saved to ready_to_shopify.product_type */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">一級分類</label>
                    <select
                      className={`${inputCls} cursor-pointer`}
                      value={editL1}
                      onChange={e => { setEditL1(e.target.value); setEditL2(''); }}
                    >
                      <option value="">— 請選擇 —</option>
                      {level1Options.map(l1 => <option key={l1} value={l1}>{l1}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">二級分類</label>
                    <select
                      className={`${inputCls} cursor-pointer`}
                      value={editL2}
                      onChange={e => setEditL2(e.target.value)}
                      disabled={!editL1}
                    >
                      <option value="">— 請選擇 —</option>
                      {getLevel2Options(editL1).map(l2 => <option key={l2} value={l2}>{l2}</option>)}
                    </select>
                  </div>
                </div>
                {(editL1 || editL2) && (
                  <p className="text-[11px] text-muted-foreground">
                    product_type 將儲存為：<span className="text-foreground font-medium">{[editL1, editL2].filter(Boolean).join(' / ')}</span>
                  </p>
                )}
              </section>

              {/* 價格 */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  價格
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* ready_to_shopify.price */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">售價 (HK$)</label>
                    <input
                      className={inputCls}
                      type="number"
                      min="0"
                      step="0.01"
                      value={editPrice}
                      onChange={e => setEditPrice(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  {/* ready_to_shopify.compare_at_price */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Compare-at 價格 (HK$)</label>
                    <input
                      className={inputCls}
                      type="number"
                      min="0"
                      step="0.01"
                      value={editCompareAtPrice}
                      onChange={e => setEditCompareAtPrice(e.target.value)}
                      placeholder="—"
                    />
                  </div>
                </div>
              </section>

              {/* 產品組織 */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <span className="text-orange-500 text-base leading-none">⬡</span>
                  產品組織
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* product_type display (read-only, derived from L1/L2 above) */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">類型 (Type)</label>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                      {[editL1, editL2].filter(Boolean).join(' / ') || '—'}
                    </div>
                  </div>
                  {/* ready_to_shopify.vendor */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">廠家 (Vendor)</label>
                    <input
                      className={inputCls}
                      value={editVendor}
                      onChange={e => setEditVendor(e.target.value)}
                      placeholder="—"
                    />
                  </div>
                </div>
                {/* ready_to_shopify.tags — same CategoryTagPicker as 產品信息 */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    產品標籤 (選擇後自動加入一級及二級分類)
                  </label>
                  <CategoryTagPicker
                    tags={editTags}
                    categories={bwfCats}
                    onChange={setEditTags}
                  />
                </div>
              </section>

              {/* SEO */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Search className="h-4 w-4 text-indigo-500" />
                  搜尋引擎列表 (SEO)
                </div>
                {/* ready_to_shopify.shopify_page_title */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">SEO 標題</label>
                  <input
                    className={inputCls}
                    value={editSeoTitle}
                    onChange={e => setEditSeoTitle(e.target.value)}
                    placeholder="SEO 標題"
                  />
                </div>
                {/* ready_to_shopify.shopify_page_description */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">SEO 描述</label>
                  <textarea
                    className={textareaCls}
                    rows={3}
                    value={editSeoDesc}
                    onChange={e => setEditSeoDesc(e.target.value)}
                    placeholder="SEO 描述"
                  />
                </div>
                {/* ready_to_shopify.shopify_url / handle */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">URL Handle</label>
                  <input
                    className={`${inputCls} font-mono`}
                    value={editHandle}
                    onChange={e => setEditHandle(e.target.value)}
                    placeholder="product-url-handle"
                  />
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function FurnitureGroupCheckView({ onEnterReadyToPublish }: Props) {
  const [items, setItems] = useState<FGItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detailRtsId, setDetailRtsId] = useState<string | null>(null);

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
      // Dedup by product_id — keep the most-recently-imported row per product
      const seen = new Set<string>();
      const deduped = (data || []).filter((r: any) => {
        if (r.product_id && seen.has(r.product_id)) return false;
        if (r.product_id) seen.add(r.product_id);
        return true;
      });
      setItems(deduped.map((r: any) => ({
        rtsId: r.id,
        productId: r.product_id,
        title: r.title || '(未命名)',
        imageUrl: r.image_url || '',
        factory: r.vendor || '—',
        productType: r.product_type || '—',
        price: r.price != null ? Number(r.price) : null,
        tags: Array.isArray(r.tags) ? r.tags : [],
      })));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRow = (id: string) =>
    setSelected(prev => {
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
      // Set furniture_group_checked=true → rows appear in 準備上載 query
      const { error: rtsError } = await supabase
        .from('ready_to_shopify')
        .update({ furniture_group_checked: true })
        .in('id', ids);
      if (rtsError) throw new Error(rtsError.message);

      // Also set ready_to_publish=true on products table
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
      toast.success('已加入準備上載', { description: `${ids.length} 件產品已移至「準備上載」` });
      onEnterReadyToPublish?.();
    } catch (e) {
      toast.error('操作失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isReverting, setIsReverting] = useState(false);

  const handleRevertAll = async () => {
    if (items.length === 0) return;
    if (!window.confirm(`確定要把全部 ${items.length} 件產品退回「產品文案」頁面嗎？`)) return;
    setIsReverting(true);
    try {
      const rtsIds = items.map(r => r.rtsId);
      const productIds = items.map(r => r.productId).filter(Boolean);

      // Delete rows from ready_to_shopify (removes from 傢俬組檢查)
      const { error: delErr } = await supabase
        .from('ready_to_shopify')
        .delete()
        .in('id', rtsIds);
      if (delErr) throw new Error(delErr.message);

      // Reset products so they reappear in 產品文案
      if (productIds.length > 0) {
        const { error: updErr } = await supabase
          .from('products')
          .update({
            copy_done: false,
            info_done: false,
            ready_to_publish: false,
            in_shopify_queue: false,
          })
          .in('id', productIds);
        if (updErr) throw new Error(updErr.message);
      }

      setItems([]);
      setSelected(new Set());
      toast.success('已全部退回產品文案', { description: `${rtsIds.length} 件產品已退回「產品文案」頁面` });
    } catch (e) {
      toast.error('退回失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsReverting(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-8 py-3.5">
        <div className="flex items-center gap-2">
          <Sofa className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">傢俬組檢查</h2>
          <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-xs font-semibold text-primary">
            {items.length} 件待確認
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRevertAll}
            disabled={items.length === 0 || isReverting || isSubmitting}
            className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {isReverting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RotateCcw className="h-4 w-4" />}
            全部退回產品文案
          </button>
          <button
            onClick={handleAddToReadyToPublish}
            disabled={selected.size === 0 || isSubmitting || isReverting}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSubmitting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <CheckCheck className="h-4 w-4" />}
            加入到 準備上載{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
        </div>
      </div>

      {/* ── Info Banner ── */}
      <div className="shrink-0 border-b border-border bg-indigo-500/5 px-8 py-3">
        <div className="flex items-center gap-2 text-[12px] text-indigo-700 dark:text-indigo-400">
          <ChevronRight className="h-3.5 w-3.5" />
          <span>傢俬組確認後，勾選產品並按「加入到 準備上載」，產品將進入「準備上載」頁面等待上傳至 Shopify。點擊產品列查看詳細資料。</span>
        </div>
      </div>

      {/* ── Table ── */}
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
                    className={cn(
                      'hover:bg-muted/30 cursor-pointer transition-colors',
                      selected.has(row.rtsId) && 'bg-primary/5'
                    )}
                    onClick={() => setDetailRtsId(row.rtsId)}
                  >
                    {/* Checkbox — stop propagation so row click doesn't also toggle */}
                    <td
                      className="px-4 py-3 text-center"
                      onClick={e => { e.stopPropagation(); toggleRow(row.rtsId); }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(row.rtsId)}
                        onChange={() => toggleRow(row.rtsId)}
                        className="rounded border-border"
                      />
                    </td>

                    {/* Product name + thumbnail */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {row.imageUrl ? (
                          <img
                            src={row.imageUrl}
                            alt={row.title}
                            className="h-12 w-12 shrink-0 rounded-lg object-cover bg-muted"
                            draggable={false}
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                          </div>
                        )}
                        <span className="font-body text-sm font-medium text-foreground line-clamp-2 max-w-[300px]">
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
                          <span
                            key={t}
                            className="rounded bg-muted px-1.5 py-0.5 font-body text-[10px] text-muted-foreground"
                          >
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

      {/* ── Product Detail Modal ── */}
      {detailRtsId && (
        <FGProductDetailModal
          rtsId={detailRtsId}
          onClose={() => setDetailRtsId(null)}
        />
      )}
    </div>
  );
}

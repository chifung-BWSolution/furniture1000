import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  Sofa, Loader2, CheckCheck, ChevronRight, Image as ImageIcon,
  X, Package, Tag, DollarSign, Search, RotateCcw, Save, Check, Ruler, Truck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadBase64Image } from '@/lib/imageStorage';
import { syncRtsWorkflowToProduct } from '@/lib/rtsProductSync';
import { toast } from 'sonner';

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/jpg,image/webp,image/avif,image/png';

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
  sku: string;
  level1: string;
  level2: string;
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
  cost: number | null;
  sku: string | null;
  image_url: string | null;
  images: any[] | null;
  status: string | null;
  tags: string[] | null;
  shopify_product_id: string | null;
  shopify_page_title: string | null;
  shopify_page_description: string | null;
  shopify_url: string | null;
  handle: string | null;
  dimension_l_mm: number | null;
  dimension_w_mm: number | null;
  dimension_h_mm: number | null;
  in_stock: boolean | null;
  customize: string | null;
  imported_at: string | null;
}

type ProductionType = 'stock' | 'custom' | null;
const LEAD_TIME_OPTIONS = ['3-7天', '8-15天', '16-25天', '26-40天', '41天以上'] as const;

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

  // ── Tag normalization (see PublishProductInfoView for the full rationale) ──
  // L1 tag present IFF ≥1 of its L2 children is selected; every tag appears once
  // (handles L1 name == its own L2 name, e.g. 辦公座椅 / 3-7天送貨 — no dup chip).
  const l2ToParent = new Map<string, string>();
  categories.filter((c) => c.level === 2).forEach((c) => {
    const parent = l1s.find((l) => l.id === c.parent_id);
    if (parent) l2ToParent.set(c.name, parent.name);
  });
  const l1NameSet = new Set(l1s.map((l) => l.name));
  const l2NameSet = new Set(l2ToParent.keys());

  const normalize = (raw: string[]): string[] => {
    const neededL1 = new Set<string>();
    raw.filter((t) => l2NameSet.has(t)).forEach((l2) => { const p = l2ToParent.get(l2); if (p) neededL1.add(p); });
    const out: string[] = [];
    const pushUnique = (t: string) => { if (!out.includes(t)) out.push(t); };
    for (const t of raw) {
      if (l2NameSet.has(t)) pushUnique(t);
      else if (l1NameSet.has(t)) { if (neededL1.has(t)) pushUnique(t); }
      else pushUnique(t);
    }
    neededL1.forEach((l1) => pushUnique(l1));
    return out;
  };

  // Self-heal legacy dirty tags (duplicates / orphan L1) once categories load.
  useEffect(() => {
    if (categories.length === 0) return;
    const cleaned = normalize(tags);
    const changed = cleaned.length !== tags.length || cleaned.some((t, i) => t !== tags[i]);
    if (changed) onChange(cleaned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, tags]);

  const toggleL2 = (_l1Name: string, l2Name: string) => {
    const has = tags.includes(l2Name);
    const raw = has ? tags.filter((t) => t !== l2Name) : [...tags, l2Name];
    onChange(normalize(raw));
  };

  const removeTag = (t: string) => {
    let raw = tags.filter((x) => x !== t);
    if (l1NameSet.has(t)) {
      const childNames = new Set(getL2s(l1s.find((l) => l.name === t)?.id ?? '').map((c) => c.name));
      raw = raw.filter((x) => !childNames.has(x));
    }
    onChange(normalize(raw));
  };
  const activeL2sForHovered = hoveredL1 ? getL2s(hoveredL1) : [];
  const hoveredL1Name = l1s.find((l) => l.id === hoveredL1)?.name ?? '';

  return (
    <div ref={anchorRef}>
      <div
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 cursor-pointer hover:border-primary/50 transition-colors"
        onClick={openMenu}
      >
        {tags.map((t, i) => (
          <span key={`${t}-${i}`} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
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

export function FGProductDetailModal({
  rtsId,
  onClose,
  onSaved,
}: {
  rtsId: string;
  onClose: () => void;
  onSaved?: () => void;
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
  const [editSku, setEditSku] = useState('');
  const [editDimL, setEditDimL] = useState('');
  const [editDimW, setEditDimW] = useState('');
  const [editDimH, setEditDimH] = useState('');
  const [editProductionType, setEditProductionType] = useState<ProductionType>(null);
  const [editLeadTime, setEditLeadTime] = useState('');
  // 成本參考 (read-only, from ready_to_shopify.cost)
  const [costRef, setCostRef] = useState<number | null>(null);

  // Editable image gallery. Each entry is either an existing HTTP URL or a
  // freshly-added base64 data-URL (uploaded to Storage on save). The first entry
  // is the primary image_url; the rest become the images[] array.
  const [editImages, setEditImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        'id,product_id,title,body_html,vendor,product_type,price,compare_at_price,cost,sku,' +
        'image_url,images,status,tags,shopify_product_id,' +
        'shopify_page_title,shopify_page_description,shopify_url,handle,' +
        'dimension_l_mm,dimension_w_mm,dimension_h_mm,in_stock,customize,imported_at'
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
        // Init editable image gallery: primary first, then images[] (deduped)
        const imgs: string[] = [];
        if (r.image_url) imgs.push(r.image_url);
        if (Array.isArray(r.images)) {
          for (const img of r.images) {
            const src: string = (img?.src || img?.url || (typeof img === 'string' ? img : '')) as string;
            if (src && !imgs.includes(src)) imgs.push(src);
          }
        }
        setEditImages(imgs);
        // Init editable fields
        setEditTitle(r.title || '');
        setEditBodyHtml(r.body_html || '');
        setEditVendor(r.vendor || '');
        setEditPrice(r.price != null ? String(r.price) : '');
        setEditCompareAtPrice(r.compare_at_price != null ? String(r.compare_at_price) : '');
        setEditSku(r.sku || '');
        setCostRef(r.cost != null ? Number(r.cost) : null);
        setEditDimL(r.dimension_l_mm != null ? String(r.dimension_l_mm) : '');
        setEditDimW(r.dimension_w_mm != null ? String(r.dimension_w_mm) : '');
        setEditDimH(r.dimension_h_mm != null ? String(r.dimension_h_mm) : '');
        // 送貨資訊：in_stock=true → 現貨；customize 有值 → 全訂製 + 交期
        if (r.in_stock === true) { setEditProductionType('stock'); setEditLeadTime(''); }
        else if (r.customize) { setEditProductionType('custom'); setEditLeadTime(r.customize); }
        else { setEditProductionType(null); setEditLeadTime(''); }
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

  // Read picked local files → base64 data-URLs appended to the gallery. They are
  // uploaded to Supabase Storage on save. Accepts JPG/JPEG/WEBP/AVIF/PNG.
  const handleAddImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const allowed = ['image/jpeg', 'image/jpg', 'image/webp', 'image/avif', 'image/png'];
    const valid = Array.from(files).filter(f => allowed.includes(f.type));
    if (valid.length === 0) {
      toast.error('不支援的圖片格式', { description: '只接受 JPG / JPEG / WEBP / AVIF / PNG' });
      return;
    }
    valid.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        if (dataUrl) setEditImages(prev => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (idx: number) => {
    setEditImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!data) return;
    setIsSaving(true);
    try {
      // Upload any newly-added base64 images to Supabase Storage, keep HTTP URLs.
      const resolvedImages: string[] = [];
      for (let i = 0; i < editImages.length; i++) {
        const img = editImages[i];
        if (img.startsWith('data:')) {
          const url = await uploadBase64Image(img, data.product_id || data.id, `fg${i}_${Date.now()}`);
          resolvedImages.push(url);
        } else {
          resolvedImages.push(img);
        }
      }
      const primaryImageUrl = resolvedImages[0] || null;
      const imagesArr = resolvedImages.map((src, i) => ({ src, position: i + 1 }));

      const productType = [editL1, editL2].filter(Boolean).join(' / ') || null;
      const priceNum = editPrice !== '' ? parseFloat(editPrice) : null;
      const compareNum = editCompareAtPrice !== '' ? parseFloat(editCompareAtPrice) : null;
      const dimL = editDimL !== '' ? parseInt(editDimL) : null;
      const dimW = editDimW !== '' ? parseInt(editDimW) : null;
      const dimH = editDimH !== '' ? parseInt(editDimH) : null;
      const isStock = editProductionType === 'stock';
      const customizeVal = editProductionType === 'custom' && editLeadTime ? editLeadTime : null;
      const inStockVal = isStock ? true : (editProductionType === 'custom' ? false : null);

      // 1. ready_to_shopify — every editable field (產品文案 + 產品信息 內容)
      const { error } = await supabase
        .from('ready_to_shopify')
        .update({
          title: editTitle || null,
          body_html: editBodyHtml || null,
          product_type: productType,
          vendor: editVendor || null,
          sku: editSku || null,
          price: isNaN(priceNum as number) ? null : priceNum,
          compare_at_price: isNaN(compareNum as number) ? null : compareNum,
          tags: editTags.length > 0 ? editTags : null,
          shopify_page_title: editSeoTitle || null,
          shopify_page_description: editSeoDesc || null,
          shopify_url: editHandle || null,
          handle: editHandle || null,
          dimension_l_mm: dimL,
          dimension_w_mm: dimW,
          dimension_h_mm: dimH,
          in_stock: inStockVal,
          customize: customizeVal,
          image_url: primaryImageUrl,
          images: imagesArr.length > 0 ? imagesArr : null,
        })
        .eq('id', data.id);
      if (error) throw new Error(error.message);

      // 2. products — mirror the shared fields so 產品文案/產品信息 stay in sync.
      // This MUST succeed too: if it fails we surface an error rather than
      // silently leaving products out of sync with ready_to_shopify.
      if (data.product_id) {
        const { error: pErr } = await supabase
          .from('products')
          .update({
            title: editTitle || null,
            description: editBodyHtml || null,
            sku: editSku || null,
            sale_price: isNaN(priceNum as number) ? null : priceNum,
            tags: editTags.length > 0 ? editTags : null,
            level1_category: editL1 || null,
            level2_category: editL2 || null,
            dimension_l_mm: dimL,
            dimension_w_mm: dimW,
            dimension_h_mm: dimH,
            in_stock: inStockVal,
            customize: customizeVal,
            image_url: primaryImageUrl,
            image_url_2: resolvedImages[1] || null,
            image_url_3: resolvedImages[2] || null,
            images: imagesArr.length > 0 ? imagesArr : null,
          })
          .eq('id', data.product_id);
        if (pErr) throw new Error(`products 同步失敗：${pErr.message}`);
      }

      setData(prev => prev ? {
        ...prev,
        title: editTitle || null,
        body_html: editBodyHtml || null,
        product_type: productType,
        vendor: editVendor || null,
        sku: editSku || null,
        price: isNaN(priceNum as number) ? null : priceNum,
        compare_at_price: isNaN(compareNum as number) ? null : compareNum,
        tags: editTags.length > 0 ? editTags : null,
        shopify_page_title: editSeoTitle || null,
        shopify_page_description: editSeoDesc || null,
        shopify_url: editHandle || null,
        handle: editHandle || null,
        dimension_l_mm: dimL,
        dimension_w_mm: dimW,
        dimension_h_mm: dimH,
        in_stock: inStockVal,
        customize: customizeVal,
        image_url: primaryImageUrl,
        images: imagesArr.length > 0 ? imagesArr : null,
      } : null);
      // Replace any base64 entries with their uploaded HTTP URLs in the gallery
      setEditImages(resolvedImages);
      setSelectedImg(primaryImageUrl);
      toast.success('已儲存', { description: '產品資料已更新（已同步至產品文案/產品信息）' });
      onSaved?.();
    } catch (e) {
      toast.error('儲存失敗', { description: e instanceof Error ? e.message : '請稍後再試' });
    } finally {
      setIsSaving(false);
    }
  };

  // The editable gallery (editImages) is the single source of truth for media.
  const allImages = editImages;
  const displayImg = (selectedImg && allImages.includes(selectedImg)) ? selectedImg : (allImages[0] || '');

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
                    <div key={i} className="relative group">
                      <button
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
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                        title="移除圖片"
                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition-opacity shadow"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  {/* Add-image button → opens local file picker */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="從本機加入圖片 (JPG/JPEG/WEBP/AVIF/PNG)"
                    className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50 hover:border-primary/50 hover:bg-muted transition-colors"
                  >
                    <span className="text-xl text-muted-foreground/60">+</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    multiple
                    className="hidden"
                    onChange={(e) => { handleAddImages(e.target.files); e.target.value = ''; }}
                  />
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
                {/* ready_to_shopify.title — Shopify 產品名稱 */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Shopify 產品名稱</label>
                  <input
                    className={inputCls}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="產品標題"
                  />
                </div>
                {/* ready_to_shopify.sku — 產品編碼 (SKU) */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">產品編碼 (SKU)</label>
                  <input
                    className={`${inputCls} font-mono`}
                    value={editSku}
                    onChange={e => setEditSku(e.target.value)}
                    placeholder="例如 SKU-ABC123"
                  />
                </div>
                {/* ready_to_shopify.body_html — Shopify 產品說明 */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Shopify 產品說明</label>
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
                <div className="grid grid-cols-3 gap-3">
                  {/* ready_to_shopify.price — 產品價錢 */}
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
                  {/* ready_to_shopify.cost — 成本參考 (read-only) */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">成本參考</label>
                    <div className="flex h-[38px] items-center rounded-lg border border-border/50 bg-muted/30 px-3">
                      {costRef != null ? (
                        <span className="font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">¥{costRef.toFixed(0)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* 尺寸 / 送貨資訊 */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Ruler className="h-4 w-4 text-sky-500" />
                  尺寸與送貨
                </div>
                {/* 產品尺寸（長 / 闊 / 高 mm） */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">產品尺寸（長 / 闊 / 高 mm）</label>
                  <div className="grid grid-cols-3 gap-3">
                    <input className={inputCls} type="number" value={editDimL} onChange={e => setEditDimL(e.target.value)} placeholder="長" />
                    <input className={inputCls} type="number" value={editDimW} onChange={e => setEditDimW(e.target.value)} placeholder="闊" />
                    <input className={inputCls} type="number" value={editDimH} onChange={e => setEditDimH(e.target.value)} placeholder="高" />
                  </div>
                </div>
                {/* 送貨資訊（現貨 / 全訂製 + 交期） */}
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Truck className="h-3 w-3" />送貨資訊</label>
                  <div className="flex items-center gap-3">
                    <div className="flex shrink-0 rounded-lg border border-border overflow-hidden w-fit">
                      <button
                        type="button"
                        onClick={() => { setEditProductionType(editProductionType === 'stock' ? null : 'stock'); setEditLeadTime(''); }}
                        className={cn('whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors', editProductionType === 'stock' ? 'bg-emerald-500 text-white' : 'bg-background text-muted-foreground hover:bg-muted')}
                      >
                        現貨
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditProductionType(editProductionType === 'custom' ? null : 'custom')}
                        className={cn('whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors', editProductionType === 'custom' ? 'bg-amber-500 text-white' : 'bg-background text-muted-foreground hover:bg-muted')}
                      >
                        全訂製
                      </button>
                    </div>
                    {editProductionType === 'custom' && (
                      // Native <select> — the shadcn Select renders its dropdown in a
                      // portal at z-50, BELOW this modal (z-[200]), so it was invisible
                      // / unclickable. A native select always paints on top.
                      // w-auto so the box only fits its content (not full width).
                      <select
                        value={editLeadTime || ''}
                        onChange={e => setEditLeadTime(e.target.value)}
                        className="shrink-0 w-auto rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-body text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                      >
                        <option value="">選擇生產天數</option>
                        {LEAD_TIME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt.replace('天', ' 天')}</option>)}
                      </select>
                    )}
                    {editProductionType === null && <span className="text-[11px] text-muted-foreground/60 italic">未選擇</span>}
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
                  {/* 類型 (Type) — editable L1/L2 dropdowns, kept in sync with 分類 */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">類型 (Type)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className={`${inputCls} cursor-pointer`}
                        value={editL1}
                        onChange={e => { setEditL1(e.target.value); setEditL2(''); }}
                      >
                        <option value="">一級</option>
                        {level1Options.map(l1 => <option key={l1} value={l1}>{l1}</option>)}
                      </select>
                      <select
                        className={`${inputCls} cursor-pointer`}
                        value={editL2}
                        onChange={e => setEditL2(e.target.value)}
                        disabled={!editL1}
                      >
                        <option value="">二級</option>
                        {getLevel2Options(editL1).map(l2 => <option key={l2} value={l2}>{l2}</option>)}
                      </select>
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
                {/* ready_to_shopify.shopify_page_title — 頁面標題 */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">頁面標題</label>
                  <input
                    className={inputCls}
                    value={editSeoTitle}
                    onChange={e => setEditSeoTitle(e.target.value)}
                    placeholder="頁面標題"
                  />
                </div>
                {/* ready_to_shopify.shopify_page_description — Meta 描述 */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Meta 描述</label>
                  <textarea
                    className={textareaCls}
                    rows={3}
                    value={editSeoDesc}
                    onChange={e => setEditSeoDesc(e.target.value)}
                    placeholder="Meta 描述"
                  />
                </div>
                {/* ready_to_shopify.shopify_url / handle — 網址控制代碼 */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">網址控制代碼</label>
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

  // ── Filters (same UX as 產品信息): search name/SKU, page size, L1/L2, factory ──
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [level1Filter, setLevel1Filter] = useState('');
  const [level2Filter, setLevel2Filter] = useState('');
  const [factoryFilter, setFactoryFilter] = useState('');
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);

  useEffect(() => {
    supabase
      .from('product_category')
      .select('level1, level2, sort_order')
      .order('sort_order', { ascending: true })
      .then(({ data }) => { if (data) setCategoryPairs(data as { level1: string; level2: string }[]); });
  }, []);

  const level1Options = useMemo(() => Array.from(new Set(categoryPairs.map(p => p.level1))), [categoryPairs]);
  const level2Options = useMemo(
    () => Array.from(new Set(categoryPairs.filter(p => p.level1 === level1Filter && p.level2).map(p => p.level2))),
    [categoryPairs, level1Filter]
  );
  const factoryOptions = useMemo(
    () => Array.from(new Set(items.map(i => i.factory).filter(f => f && f !== '—'))),
    [items]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    const selectCols = 'id,product_id,title,image_url,vendor,product_type,price,tags,sku,info_completed_at,imported_at';
    let { data, error } = await supabase
      .from('ready_to_shopify')
      .select(selectCols)
      .eq('furniture_group_checked', false)
      .order('info_completed_at', { ascending: false, nullsFirst: false })
      .order('imported_at', { ascending: false });

    if (error) {
      // info_completed_at column may not exist until migration runs
      const fallback = await supabase
        .from('ready_to_shopify')
        .select('id,product_id,title,image_url,vendor,product_type,price,tags,sku,imported_at')
        .eq('furniture_group_checked', false)
        .order('imported_at', { ascending: false });
      data = (fallback.data || []).map((row: any) => ({ ...row, info_completed_at: null }));
      error = fallback.error;
    }

    if (error) {
      toast.error('讀取失敗', { description: error.message });
      setItems([]);
    } else {
      // Dedup by product_id — keep the most-recently-imported row per product
      const seen = new Set<string>();
      let deduped = (data || []).filter((r: any) => {
        if (r.product_id && seen.has(r.product_id)) return false;
        if (r.product_id) seen.add(r.product_id);
        return true;
      });

      // Defensive: exclude products already live on Shopify
      const productIds = deduped.map((r: any) => r.product_id).filter(Boolean) as string[];
      if (productIds.length > 0) {
        const { data: liveProducts } = await supabase
          .from('products')
          .select('id')
          .in('id', productIds)
          .not('shopify_product_id', 'is', null);
        if (liveProducts?.length) {
          const liveSet = new Set(liveProducts.map((p: { id: string }) => p.id));
          deduped = deduped.filter((r: any) => !r.product_id || !liveSet.has(r.product_id));
        }
      }

      setItems(deduped.map((r: any) => {
        // product_type is stored as "L1 / L2"
        const ptParts = (r.product_type || '').split(' / ');
        return {
          rtsId: r.id,
          productId: r.product_id,
          title: r.title || '(未命名)',
          imageUrl: r.image_url || '',
          factory: r.vendor || '—',
          productType: r.product_type || '—',
          price: r.price != null ? Number(r.price) : null,
          tags: Array.isArray(r.tags) ? r.tags : [],
          sku: r.sku || '',
          level1: ptParts[0]?.trim() || '',
          level2: ptParts[1]?.trim() || '',
        };
      }));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Apply search (name/SKU) + L1/L2 + factory filters.
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter(r => {
      if (q) {
        const title = r.title.toLowerCase();
        const sku = r.sku.toLowerCase();
        if (!title.includes(q) && !sku.includes(q)) return false;
      }
      if (level1Filter && r.level1 !== level1Filter) return false;
      if (level2Filter && r.level2 !== level2Filter) return false;
      if (factoryFilter && r.factory !== factoryFilter) return false;
      return true;
    });
  }, [items, searchQuery, level1Filter, level2Filter, factoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pagedItems = useMemo(
    () => filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredItems, currentPage, pageSize]
  );
  useEffect(() => { setCurrentPage(1); }, [searchQuery, level1Filter, level2Filter, factoryFilter, pageSize]);

  const toggleRow = (id: string) =>
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // Select-all toggles the currently-filtered set (across all pages).
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(filteredItems.map(r => r.rtsId)) : new Set());

  const allSelected = filteredItems.length > 0 && filteredItems.every(r => selected.has(r.rtsId));

  const handleAddToReadyToPublish = async () => {
    if (selected.size === 0) { toast.message('請先勾選產品'); return; }
    const ids = Array.from(selected);
    setIsSubmitting(true);
    try {
      // Set furniture_group_checked=true → rows appear in 準備上載 query
      const now = new Date().toISOString();
      let { error: rtsError } = await supabase
        .from('ready_to_shopify')
        .update({
          furniture_group_checked: true,
          ready_to_publish_at: now,
        })
        .in('id', ids);
      // Fallback if ready_to_publish_at column not yet migrated
      if (rtsError?.message?.includes('ready_to_publish_at')) {
        ({ error: rtsError } = await supabase
          .from('ready_to_shopify')
          .update({ furniture_group_checked: true })
          .in('id', ids));
      }
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

  const handleRevertSelected = async () => {
    if (selected.size === 0) { toast.message('請先勾選要退回的產品'); return; }
    const rtsIds = Array.from(selected);
    const revertItems = items.filter(r => rtsIds.includes(r.rtsId));
    if (revertItems.length === 0) return;
    if (!window.confirm(`確定要把已選的 ${revertItems.length} 件產品退回「產品文案」頁面嗎？`)) return;
    setIsReverting(true);
    try {
      const productIds = revertItems.map(r => r.productId).filter(Boolean);

      // NOTE: do NOT delete the ready_to_shopify rows here. Reverting only moves
      // the product back to 產品文案 by resetting the products flags below; the
      // RTS row (body_html, images, SEO, sku, price …) is preserved so nothing
      // is lost. The product drops out of 傢俬組檢查 because furniture_group_checked
      // / copy_done are reset, not because the row is removed.

      // Reset products so they reappear in 產品文案 (copy_done=false per request).
      // Keep in_shopify_queue=true — the 產品文案 list filters on it, so setting
      // it false would make the reverted products vanish from that page too.
      if (productIds.length > 0) {
        const { error: rtsUpdErr } = await supabase
          .from('ready_to_shopify')
          .update({
            copy_done: false,
            info_done: false,
            furniture_group_checked: null,
          })
          .in('product_id', productIds);
        if (rtsUpdErr) throw new Error(rtsUpdErr.message);
        await Promise.all(productIds.map((id) => syncRtsWorkflowToProduct(supabase, id, {
          copy_done: false,
          info_done: false,
          ready_to_publish: false,
        })));
      }

      const { error: rtsErr } = await supabase
        .from('ready_to_shopify')
        .update({ furniture_group_checked: null })
        .in('id', rtsIds);
      if (rtsErr) throw new Error(rtsErr.message);

      // Remove only the reverted rows from the local list + selection.
      setItems(prev => prev.filter(r => !rtsIds.includes(r.rtsId)));
      setSelected(new Set());
      toast.success('已退回產品文案', { description: `${revertItems.length} 件產品已退回「產品文案」頁面` });
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
            onClick={handleRevertSelected}
            disabled={selected.size === 0 || isReverting || isSubmitting}
            className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {isReverting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RotateCcw className="h-4 w-4" />}
            退回產品文案{selected.size > 0 ? `（${selected.size}）` : ''}
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

      {/* ── Filter toolbar — search (name/SKU) · page size · L1/L2 · factory ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-8 py-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋產品名稱或編碼 (SKU)..."
            className="h-8 w-[240px] rounded-lg border border-border bg-card pl-8 pr-8 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
          )}
        </div>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
          {[20, 25, 50, 100].map(n => <option key={n} value={n}>每頁 {n} 項</option>)}
        </select>
        <select value={level1Filter} onChange={(e) => { setLevel1Filter(e.target.value); setLevel2Filter(''); }} className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
          <option value="">全部一級分類</option>
          {level1Options.map(l1 => <option key={l1} value={l1}>{l1}</option>)}
        </select>
        <select value={level2Filter} onChange={(e) => setLevel2Filter(e.target.value)} disabled={!level1Filter} className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer disabled:opacity-50">
          <option value="">全部二級分類</option>
          {level2Options.map(l2 => <option key={l2} value={l2}>{l2}</option>)}
        </select>
        <select value={factoryFilter} onChange={(e) => setFactoryFilter(e.target.value)} className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
          <option value="">篩選廠家：全部</option>
          {factoryOptions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        {(searchQuery || level1Filter || level2Filter || factoryFilter) && (
          <button
            onClick={() => { setSearchQuery(''); setLevel1Filter(''); setLevel2Filter(''); setFactoryFilter(''); }}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="h-3 w-3" /> 清除篩選
          </button>
        )}
        <span className="ml-auto font-mono-data text-[11px] text-muted-foreground">符合 {filteredItems.length} 件</span>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Sofa className="h-8 w-8 text-muted-foreground/40" />
            <p className="font-display text-sm text-muted-foreground">{items.length === 0 ? '尚無待確認產品' : '沒有符合篩選的產品'}</p>
            <p className="font-body text-[12px] text-muted-foreground/70">
              {items.length === 0 ? '到「產品信息」頁面勾選產品並按「完成」後，產品會送到此處' : '請調整搜尋或篩選條件'}
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
                {pagedItems.map(row => (
                  <tr
                    key={row.rtsId}
                    className={cn(
                      'hover:bg-muted/30 cursor-pointer transition-colors',
                      selected.has(row.rtsId) && 'bg-primary/5'
                    )}
                    onClick={() => setDetailRtsId(row.rtsId)}
                  >
                    {/* Checkbox cell — the <td> owns the toggle so a click anywhere
                        in the cell (including directly on the box) fires exactly once.
                        The input is presentational only (readOnly, no onChange) to
                        avoid a double-toggle that cancels itself out when clicked. */}
                    <td
                      className="px-4 py-3 text-center"
                      onClick={e => { e.stopPropagation(); toggleRow(row.rtsId); }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(row.rtsId)}
                        readOnly
                        className="rounded border-border pointer-events-none"
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

        {/* Pagination */}
        {filteredItems.length > pageSize && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              上一頁
            </button>
            <span className="font-mono-data text-xs text-muted-foreground">
              第 {currentPage} / {totalPages} 頁 · 共 {filteredItems.length} 件
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40 transition-colors"
            >
              下一頁
            </button>
          </div>
        )}
      </div>

      {/* ── Product Detail Modal ── */}
      {detailRtsId && (
        <FGProductDetailModal
          rtsId={detailRtsId}
          onClose={() => setDetailRtsId(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

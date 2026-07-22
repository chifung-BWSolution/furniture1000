import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  FileText, ChevronLeft, ArrowRight, Loader2,
  UploadCloud, Search, X, Bold, Italic, Underline as UnderlineIcon,
  List, ListOrdered, Image as ImageIcon, Palette,
  AlignLeft, AlignCenter, AlignRight, Wand2, Plus, Check, Save, Hash,
  Ban, Archive, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { uploadFileToStorage, uploadImageSourceToStorage, isHttpImageUrl } from '@/lib/imageStorage';
import { excludeAlreadyPublishedRts } from '@/lib/publishPipeline';
import { collectProductGalleryUrls } from '@/lib/productGallery';
import { pickScenarioPrimaryImageUrl } from '@/lib/productMergeImages';
import { syncRtsContentToProduct, syncRtsWorkflowToProduct } from '@/lib/rtsProductSync';
import { writeUploadLog } from '@/lib/uploadLog';
import { getPublishTimestampHk } from '@/lib/publishTimestamps';
import { normalizeBodyHtmlForShopify } from '@/lib/bodyHtml';
import { usePublishRtsList } from './usePublishRtsList';

interface RevertReason {
  labels: string[];
  other: string | null;
}

interface CopyItem {
  id: string;
  rtsId: string;
  title: string;
  description: string;
  imageUrl: string;
  images: string[];
  factory: string;
  factoryId: string;
  model: string;
  level1: string;
  level2: string;
  seoTitle: string;
  seoDescription: string;
  handle: string;
  tags: string[];
  price: number | null;
  salePrice: number | null;
  sku: string;
  revertReason: RevertReason | null;
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
  const [viewMode, setViewMode] = useState<'active' | 'rejected'>('active');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRejecting, setIsRejecting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const rowsRef = useRef<any[]>([]);

  const rejectedOnly = viewMode === 'rejected';

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRejectSelected = useCallback(async () => {
    const rtsIds = rowsRef.current
      .filter((r: any) => selectedIds.has(r.id))
      .map((r: any) => String(r.rts_id ?? ''))
      .filter(Boolean);
    if (rtsIds.length === 0) return;
    setIsRejecting(true);
    try {
      const { error } = await supabase
        .from('ready_to_shopify')
        .update({ rejected: true })
        .in('id', rtsIds);
      if (error) throw error;
      toast.success(`已將 ${rtsIds.length} 件產品標記為「暫不考慮」`, {
        description: '產品已移至「不考慮產品」列表',
      });
      setSelectedIds(new Set());
      setReloadKey((k) => k + 1);
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
        ? (err as { message: string }).message
        : '請稍後再試';
      toast.error('標記失敗', { description: message });
    } finally {
      setIsRejecting(false);
    }
  }, [selectedIds]);

  const handleRestoreSelected = useCallback(async () => {
    const restoredRows = rowsRef.current.filter((r: any) => selectedIds.has(r.id));
    const rtsIds = restoredRows
      .map((r: any) => String(r.rts_id ?? ''))
      .filter(Boolean);
    if (rtsIds.length === 0) return;
    setIsRestoring(true);
    try {
      const now = getPublishTimestampHk();
      const { error } = await supabase
        .from('ready_to_shopify')
        .update({ rejected: false, copy_queued_at: now })
        .in('id', rtsIds);
      if (error) throw error;
      await Promise.all(
        restoredRows.map((r: any) => syncRtsWorkflowToProduct(supabase, String(r.id), {
          copy_queued_at: now,
        })),
      );
      toast.success(`已還原 ${rtsIds.length} 件產品`, {
        description: '產品已放回「產品文案」列表最前',
      });
      setSelectedIds(new Set());
      setReloadKey((k) => k + 1);
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
        ? (err as { message: string }).message
        : '請稍後再試';
      toast.error('還原失敗', { description: message });
    } finally {
      setIsRestoring(false);
    }
  }, [selectedIds]);

  const rejectToolbarButton = !rejectedOnly ? (
    <button
      type="button"
      onClick={handleRejectSelected}
      disabled={selectedIds.size === 0 || isRejecting}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-body font-semibold transition-colors',
        selectedIds.size > 0
          ? 'border-rose-500/40 text-rose-600 hover:bg-rose-500/10'
          : 'border-border text-muted-foreground opacity-50',
      )}
    >
      {isRejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
      {isRejecting ? '處理中...' : '暫不考慮'}
      {selectedIds.size > 0 && !isRejecting && (
        <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 font-mono-data text-[10px] text-rose-600">
          {selectedIds.size}
        </span>
      )}
    </button>
  ) : null;

  // Only show products where copywriting is NOT yet done.
  // NOTE: do NOT select the heavy `images` JSONB column here — it stores base64
  // data-URLs that can be ~1MB each, making the list query take minutes. The
  // list only needs the lightweight `image_url` thumbnail; full images are
  // loaded lazily when a product is opened (openProduct).
  const { rows, totalCount, isLoading, Toolbar, Pagination } = usePublishRtsList({
    applyBaseFilters: (q) => excludeAlreadyPublishedRts(q.eq('in_shopify_queue', true).or('copy_done.is.null,copy_done.eq.false')),
    applyProductsCountFilters: (q) => q.eq('in_shopify_queue', true).or('copy_done.is.null,copy_done.eq.false').is('shopify_product_id', null),
    countStage: 'copywriting',
    reloadKey,
    rejectedOnly,
    toolbarEnd: rejectToolbarButton,
  });
  rowsRef.current = rows;

  const items: CopyItem[] = useMemo(() => rows.map((r: any) => {
    const factoryId = r.factory_id || '';
    const model = r.model || '';
    const derivedSku = factoryId && model ? `${factoryId}-${model}` : (r.sku || r.model || '');
    return {
      id: r.id,
      rtsId: String(r.rts_id ?? ''),
      title: r.title || '',
      description: r.description || '',
      imageUrl: r.image_url || '',
      images: [], // populated lazily in openProduct
      factory: r.factories_display_name || '',
      factoryId,
      model,
      level1: r.level1_category || '',
      level2: r.level2_category || '',
      seoTitle: r.title || '',
      seoDescription: (r.description || '').slice(0, 160),
      handle: slugify(r.title || ''),
      tags: Array.isArray(r.tags) ? r.tags : [],
      price: r.price != null ? Number(r.price) : null,
      salePrice: r.sale_price != null ? Number(r.sale_price) : null,
      sku: derivedSku,
      revertReason: r.revert_reason ?? null,
    };
  }), [rows]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [viewMode, reloadKey]);

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
  const [sku, setSku] = useState('');
  const [desc, setDesc] = useState('');
  // Increment this to force RichEditor to sync its DOM from the latest `desc` value
  const [editorKey, setEditorKey] = useState(0);
  // primaryImg: the main product image (image_url)
  const [primaryImg, setPrimaryImg] = useState<string>('');
  // extraImgs: additional images (images jsonb array)
  const [extraImgs, setExtraImgs] = useState<string[]>([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDesc, setSeoDesc] = useState('');
  const [handle, setHandle] = useState('');
  const primaryFileRef = useRef<HTMLInputElement>(null);
  const extraFileRef = useRef<HTMLInputElement>(null);
  const [showImageUploadDialog, setShowImageUploadDialog] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Snapshot of last-saved state for dirty tracking
  const [savedSnapshot, setSavedSnapshot] = useState<{
    name: string; sku: string; desc: string;
    primaryImg: string; extraImgs: string[];
    seoTitle: string; seoDesc: string; handle: string;
  } | null>(null);

  const isDirty = useMemo(() => {
    if (!savedSnapshot || !activeId) return false;
    return (
      name !== savedSnapshot.name ||
      sku !== savedSnapshot.sku ||
      desc !== savedSnapshot.desc ||
      primaryImg !== savedSnapshot.primaryImg ||
      extraImgs.length !== savedSnapshot.extraImgs.length ||
      extraImgs.some((s, i) => s !== savedSnapshot.extraImgs[i]) ||
      seoTitle !== savedSnapshot.seoTitle ||
      seoDesc !== savedSnapshot.seoDesc ||
      handle !== savedSnapshot.handle
    );
  }, [savedSnapshot, activeId, name, sku, desc, primaryImg, extraImgs, seoTitle, seoDesc, handle]);

  // Warn browser on tab/window close when there are unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Load saved ready_to_shopify data when opening a product
  const openProduct = useCallback(async (p: CopyItem) => {
    setActiveId(p.id);
    setName(p.title);
    setSku(p.sku);
    setDesc(p.description);
    setPrimaryImg(p.imageUrl);
    setExtraImgs([]); // will be filled by the lazy fetch below
    setSeoTitle(p.seoTitle);
    setSeoDesc(p.seoDescription);
    setHandle(p.handle);

    // Lazily fetch the heavy image columns for THIS product only (not loaded in list)
    const { data: prod } = await supabase
      .from('products')
      .select('image_url,images,image_url_2,image_url_3,lifestyle_image_url')
      .eq('id', p.id)
      .maybeSingle();

    let finalPrimary = p.imageUrl;
    let finalExtras: string[] = [];

    if (prod) {
      const gallery = collectProductGalleryUrls(prod);
      const primaryImg = pickScenarioPrimaryImageUrl(gallery) || gallery[0] || p.imageUrl || '';
      const extraImgs = gallery.filter((u) => u !== primaryImg);
      if (primaryImg) { setPrimaryImg(primaryImg); finalPrimary = primaryImg; }
      setExtraImgs(extraImgs); finalExtras = extraImgs;
    }

    // Fetch previously saved data from ready_to_shopify (overrides products)
    const { data: rts } = await supabase
      .from('ready_to_shopify')
      .select('title,body_html,image_url,images,shopify_page_title,shopify_page_description,shopify_url,handle,sku')
      .eq('product_id', p.id)
      .maybeSingle();

    let snapName = p.title, snapSku = p.sku, snapDesc = p.description;
    let snapSeoTitle = p.seoTitle, snapSeoDesc = p.seoDescription, snapHandle = p.handle;

    if (rts) {
      if (rts.title) { setName(rts.title); snapName = rts.title; }
      if (rts.sku) { setSku(rts.sku); snapSku = rts.sku; }
      // Only use rts.body_html if it is longer than what's already set (products.description).
      // ready_to_shopify may hold a stale short snapshot while products.description was updated.
      if (rts.body_html && rts.body_html.length > snapDesc.length) {
        setDesc(rts.body_html); snapDesc = rts.body_html;
      }
      if (rts.image_url) { setPrimaryImg(rts.image_url); finalPrimary = rts.image_url; }
      if (Array.isArray(rts.images) && rts.images.length > 0) {
        const imgs = rts.images.map((img: any) => img?.src || img).filter(Boolean);
        setExtraImgs(imgs); finalExtras = imgs;
      }
      if (rts.shopify_page_title) { setSeoTitle(rts.shopify_page_title); snapSeoTitle = rts.shopify_page_title; }
      if (rts.shopify_page_description) { setSeoDesc(rts.shopify_page_description); snapSeoDesc = rts.shopify_page_description; }
      if (rts.shopify_url) { setHandle(rts.shopify_url); snapHandle = rts.shopify_url; }
      else if (rts.handle) { setHandle(rts.handle); snapHandle = rts.handle; }
    }

    setSavedSnapshot({
      name: snapName, sku: snapSku, desc: snapDesc,
      primaryImg: finalPrimary, extraImgs: finalExtras,
      seoTitle: snapSeoTitle, seoDesc: snapSeoDesc, handle: snapHandle,
    });
    // Force RichEditor to re-sync its contenteditable DOM after all async data is loaded
    setEditorKey((k) => k + 1);
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


  const persistCopywritingImages = async () => {
    const hasNewUploads = [primaryImg, ...extraImgs].some(
      (src) => src?.trim() && !isHttpImageUrl(src),
    );
    if (hasNewUploads) {
      toast.loading('正在上傳圖片至 Storage…', { id: 'copywriting-img-upload' });
    }
    try {
      const resolvedPrimary = primaryImg?.trim()
        ? await uploadImageSourceToStorage(primaryImg.trim(), activeId!, 'primary')
        : null;
      const resolvedExtras = await Promise.all(
        extraImgs.map((src, idx) => uploadImageSourceToStorage(src, activeId!, `extra${idx}`)),
      );
      const images = resolvedExtras
        .filter((src): src is string => Boolean(src))
        .map((src, idx) => ({ src, position: idx + 1 }));
      return { image_url: resolvedPrimary, images: images.length > 0 ? images : null };
    } finally {
      toast.dismiss('copywriting-img-upload');
    }
  };

  const imageSaveHint = () => '產品文案及圖片已同步至 ready_to_shopify';

  const buildRtsPayload = (
    item: CopyItem,
    resolvedPrimary: string | null,
    imagesJson: { src: string; position?: number }[],
    extra?: { copy_done?: boolean; copy_done_at?: string; revert_reason?: null },
  ) => ({
    product_id: activeId,
    title: name,
    sku: sku || null,
    body_html: normalizeBodyHtmlForShopify(desc),
    vendor: item.factory || null,
    product_type: [item.level1, item.level2].filter(Boolean).join(' / ') || null,
    handle: handle || slugify(name),
    status: 'draft',
    image_url: resolvedPrimary || null,
    images: imagesJson.length > 0 ? imagesJson : null,
    tags: item.tags.length > 0 ? item.tags : null,
    price: item.salePrice ?? item.price ?? null,
    shopify_page_title: seoTitle || name || null,
    shopify_page_description: seoDesc || null,
    shopify_url: handle || slugify(name) || null,
    imported_at: new Date().toISOString(),
    in_shopify_queue: true,
    ...extra,
  });

  const applyResolvedImagesToState = (
    resolvedPrimary: string | null,
    imagesJson: { src: string; position?: number }[],
  ) => {
    const resolvedExtras = imagesJson.map((im) => im.src);
    if (resolvedPrimary && resolvedPrimary !== primaryImg) setPrimaryImg(resolvedPrimary);
    if (resolvedExtras.some((s, i) => s !== extraImgs[i])) setExtraImgs(resolvedExtras);
    setSavedSnapshot({
      name, sku, desc,
      primaryImg: resolvedPrimary || '',
      extraImgs: resolvedExtras,
      seoTitle, seoDesc, handle,
    });
  };

  // Save — sync title + body_html to ready_to_shopify WITHOUT advancing copy_done
  // Product stays in 產品文案 so user can continue editing images etc.
  const [isSaving, setIsSaving] = useState(false);
  const handleSave = async () => {
    if (!activeId) return;
    const item = items.find((p) => p.id === activeId);
    if (!item) return;
    setIsSaving(true);
    try {
      const { image_url: resolvedPrimary, images: imagesJsonArr } = await persistCopywritingImages();
      const imagesJson = imagesJsonArr ?? [];

      const { error } = await supabase
        .from('ready_to_shopify')
        .upsert(buildRtsPayload(item, resolvedPrimary, imagesJson), { onConflict: 'product_id' });

      if (error) {
        toast.error('儲存失敗', { description: error.message });
        return;
      }
      if (primaryImg?.trim() && !resolvedPrimary) {
        toast.error('圖片未能上傳至 Storage', { description: '請重新選擇圖片後再試' });
        return;
      }

      await syncRtsContentToProduct(supabase, activeId, {
        title: name,
        body_html: normalizeBodyHtmlForShopify(desc),
        sku: sku || null,
        image_url: resolvedPrimary || null,
        image_url_2: imagesJson[0]?.src || null,
        image_url_3: imagesJson[1]?.src || null,
        images: imagesJson.length > 0 ? imagesJson : null,
      });
      applyResolvedImagesToState(resolvedPrimary, imagesJson);
      toast.success('已儲存', { description: imageSaveHint() });
    } catch {
      toast.error('儲存時發生錯誤，請重試');
    } finally {
      setIsSaving(false);
    }
  };

  // Submit — save edits + set copy_done=true → moves product to 產品信息
  const handleSubmit = async () => {
    if (!activeId) return;
    const item = items.find((p) => p.id === activeId);
    if (!item) return;
    setIsSubmitting(true);
    try {
      const { image_url: resolvedPrimary, images: imagesJsonArr } = await persistCopywritingImages();
      const copyDoneAt = getPublishTimestampHk();
      const imagesJson = imagesJsonArr ?? [];
      const resolvedExtras = imagesJson.map((im) => im.src);

      const { error: rtsError } = await supabase
        .from('ready_to_shopify')
        .upsert(
          buildRtsPayload(item, resolvedPrimary, imagesJson, {
            copy_done: true,
            copy_done_at: copyDoneAt,
            revert_reason: null,
          }),
          { onConflict: 'product_id' },
        );

      if (rtsError) {
        toast.error('提交失敗', { description: rtsError.message });
        return;
      }
      if (primaryImg?.trim() && !resolvedPrimary) {
        toast.error('圖片未能上傳至 Storage', { description: '請重新選擇圖片後再試' });
        return;
      }

      await syncRtsContentToProduct(supabase, activeId, {
        title: name,
        body_html: normalizeBodyHtmlForShopify(desc),
        sku: sku || null,
        image_url: resolvedPrimary || null,
        image_url_2: resolvedExtras[0] || null,
        image_url_3: resolvedExtras[1] || null,
        images: imagesJson.length > 0 ? imagesJson : null,
      });
      await syncRtsWorkflowToProduct(supabase, activeId, {
        copy_done: true,
        copy_done_at: copyDoneAt,
        revert_reason: null,
      });

      const { data: rtsRow } = await supabase
        .from('ready_to_shopify')
        .select('id')
        .eq('product_id', activeId)
        .maybeSingle();
      await writeUploadLog({
        productId: activeId,
        rtsId: rtsRow?.id ?? null,
        stage: 'copywriting',
        action: 'submit',
      });

      toast.success('已提交到下一步', {
        description: '產品已移至「產品價錢」，資料已同步至 ready_to_shopify',
      });

      setActiveId(null);
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('提交時發生錯誤，請重試');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isUploadingPrimary, setIsUploadingPrimary] = useState(false);
  const [isUploadingExtra, setIsUploadingExtra] = useState(false);

  const uploadCopywritingFile = async (file: File, suffix: string): Promise<string | null> => {
    if (!activeId) return null;
    if (!file.type.startsWith('image/')) {
      toast.error('格式不支援，請上傳圖片檔案');
      return null;
    }
    if (file.size > MAX_IMG_BYTES) {
      toast.error('圖片超過 5MB 上限');
      return null;
    }
    try {
      return await uploadFileToStorage(file, activeId, suffix);
    } catch (err) {
      toast.error('圖片上傳失敗', {
        description: err instanceof Error ? err.message : '請稍後再試',
      });
      return null;
    }
  };

  const addPrimaryFile = async (file: File) => {
    setIsUploadingPrimary(true);
    try {
      const url = await uploadCopywritingFile(file, `primary_${Date.now()}`);
      if (url) setPrimaryImg(url);
    } finally {
      setIsUploadingPrimary(false);
    }
  };

  const addExtraFile = async (file: File) => {
    setIsUploadingExtra(true);
    try {
      const url = await uploadCopywritingFile(file, `extra_${Date.now()}`);
      if (url) setExtraImgs((prev) => [...prev, url]);
    } finally {
      setIsUploadingExtra(false);
    }
  };

  // Derive suitable usage scenes from category
  const deriveScenes = (level1: string, level2: string): string => {
    const combined = `${level1} ${level2}`.toLowerCase();
    if (/大班椅|行政椅|老闆椅|executive/.test(combined)) return '辦公室行政房、老闆房、高管辦公室';
    if (/辦公椅|電腦椅|工作椅|mesh|網背/.test(combined)) return '開放式辦公室、工作站、共享辦公空間';
    if (/會議椅|培訓椅|training/.test(combined)) return '會議室、培訓中心、多功能廳';
    if (/沙發|接待|lounge|休閑/.test(combined)) return '辦公室接待區、酒店大堂、商業休閒區';
    if (/課室|學生|學校|school|classroom/.test(combined)) return '學校課室、補習社、教育中心';
    if (/實驗室|lab/.test(combined)) return '實驗室、科研中心、醫療機構';
    if (/餐廳|dining|餐飲/.test(combined)) return '餐廳、咖啡廳、食堂';
    if (/班台|辦公桌|executive desk|工作臺/.test(combined)) return '辦公室、行政房、工作空間';
    if (/儲物|storage|書櫃|文件/.test(combined)) return '辦公室、圖書館、學校、商業空間';
    if (/前台|接待台|reception/.test(combined)) return '公司前台、酒店接待處、服務台';
    if (/茶几|coffee table|角幾/.test(combined)) return '辦公室休息區、酒店大堂、商業接待區';
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

      const prompt = `你是一位資深的商業傢私品牌文案總監，專注為香港及大灣區 B2B 客戶撰寫高端家具電商文案。全部內容必須使用香港繁體中文（如「傢私」、「梳化」、「閣下」等港式用語）。

請根據以下產品資料，把現有的「產品說明原文」重新改寫成一篇約 300 字的專業商業文案。

【產品名稱】${name || product.title}
【產品分類】${categoryParts || '家具'}
【適用情景】${scenes}
【產品說明原文（素材參考）】
${rawDesc || '（暫無原文，請根據產品名稱及分類發揮）'}

【輸出格式要求】請嚴格按以下結構輸出，共 5 段：

第1段（引言）：1-2 句，以引人入勝的方式點出產品定位及核心價值，突出「${scenes}」的使用場景。

第2段（小標題 + emoji + 內文）：
格式：[相關emoji] [2-4字小標題]\n[2-3句內文，說明產品第一大賣點，提取原文素材]

第3段（小標題 + emoji + 內文）：
格式：[相關emoji] [2-4字小標題]\n[2-3句內文，說明產品第二大賣點，提取原文素材]

第4段（小標題 + emoji + 內文）：
格式：[相關emoji] [2-4字小標題]\n[2-3句內文，說明產品第三大賣點，提取原文素材]

第5段（結語）：1-2 句，以有力的結語收結，強調產品對「${scenes}」空間的提升價值。

【額外要求】
- 香港繁體中文，語氣自信、有質感、略帶文學性
- emoji 要與內容相關（如 ✨🪑☁️🏗️💼 等）
- 小標題簡潔有力，2-4 個字
- 不使用「本產品」、「該產品」，直接用產品名稱或「它」
- 不使用 markdown（**粗體**、##標題 等），只用純文字加 emoji`;

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

  // AI generate Meta Description from product description
  const [isGeneratingMeta, setIsGeneratingMeta] = useState(false);
  const handleGenerateMeta = useCallback(async () => {
    if (!product) return;
    const rawDesc = desc.replace(/<[^>]*>/g, '').trim();
    if (!rawDesc) {
      toast.error('請先填寫「Shopify 產品說明」，作為 Meta 描述的生成依據');
      return;
    }
    setIsGeneratingMeta(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const categoryParts = [product.level1, product.level2].filter(Boolean).join(' › ');
      const scenes = deriveScenes(product.level1, product.level2);
      const productTitle = name || product.title;

      const prompt = `你是一位專門為香港 B2B 商業傢私電商撰寫 SEO Meta Description 的資深文案，服務對象是企業採購、設計師及工程項目客戶。全部內容必須使用香港繁體中文（如「傢私」、「梳化」、「閣下」等港式用語）。

請根據以下產品資訊，撰寫一段繁體中文的 Meta Description：

【產品名稱】${productTitle}
【產品分類】${categoryParts || '商業傢私'}
【適用場景】${scenes}
【產品說明內容】
${rawDesc}

【定位要求】
- 文案定位為「商業傢私 / 商用傢具」，面向辦公室、商業空間、企業及公共項目採購
- 適用場景以商用、辦公、商業空間為主（如：辦公室、會議室、接待區、酒店、學校、餐飲商業空間等）
- 絕對禁止使用「家居、家用、居家、住宅、家庭、家居生活、溫馨家居、家居空間」等家用/住宅相關字眼
- 若原文出現家用語境，請改寫為商用、辦公或商業空間語境

【生成原則】
- ≤140 個中文字 / ≤140 英文字元，連標點符號在內總字元數絕對不可超過 160 個字元
- 從 B2B 採購者角度出發，突出商用價值、耐用性、專業形象或空間效益，避免無意義關鍵字堆疊
- 針對此產品獨特賣點撰寫，讓描述有別於其他產品頁面

【輸出要求】
- 只輸出 Meta Description 正文，不要加標題、不要加引號
- 繁體中文，語氣專業、簡潔、有說服力
- 直接點出產品核心價值及商用適用場景`;

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
      // Trim to 160 chars to respect maxLength
      setSeoDesc(generated.slice(0, 160));
      toast.success('Meta 描述已生成', { description: '可繼續手動調整' });
    } catch (err) {
      toast.error('AI 生成失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    } finally {
      setIsGeneratingMeta(false);
    }
  }, [product, name, desc]);

  // ─── List view ───────────────────────────────────────────────────
  if (!product) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-8 py-3">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold">
            {rejectedOnly ? '不考慮產品' : '產品文案'}
          </h2>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-mono-data text-[11px] font-semibold text-primary">
            {totalCount} 件產品{rejectedOnly ? '' : '待處理'}
          </span>
          {rejectedOnly ? (
            <button
              type="button"
              onClick={() => setViewMode('active')}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-0.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              返回產品文案
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setViewMode('rejected')}
              className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-2.5 py-0.5 text-sm font-semibold text-rose-600 hover:bg-rose-500/10"
            >
              <Archive className="h-3.5 w-3.5" />
              不考慮產品
            </button>
          )}
          {rejectedOnly && (
            <button
              type="button"
              onClick={handleRestoreSelected}
              disabled={selectedIds.size === 0 || isRestoring}
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-sm font-semibold transition-colors',
                selectedIds.size > 0
                  ? 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10'
                  : 'border-border text-muted-foreground opacity-50',
              )}
            >
              {isRestoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {isRestoring ? '還原中...' : '還原'}
              {selectedIds.size > 0 && !isRestoring && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-mono-data text-[10px]">
                  {selectedIds.size}
                </span>
              )}
            </button>
          )}
        </div>
        {Toolbar}
        <div className="flex-1 overflow-auto p-8">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="font-display text-sm text-muted-foreground">
                {rejectedOnly ? '尚無標記為「暫不考慮」的產品' : '尚無符合條件的產品'}
              </p>
              <p className="font-body text-[12px] text-muted-foreground/70">
                {rejectedOnly
                  ? '在「產品文案」列表勾選產品並點「暫不考慮」後，產品會顯示於此'
                  : '到「產品管理 → 待處理產品」點「A 加入Shopify」即可加入，或調整上方篩選'}
              </p>
            </div>
          ) : (
            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-2">
              {items.map((p) => {
                const isSelected = selectedIds.has(p.id);
                return (
                <div
                  key={p.id}
                  className={cn(
                    'group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md',
                    isSelected && (rejectedOnly
                      ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
                      : 'border-rose-500/40 bg-rose-500/5 ring-1 ring-rose-500/20'),
                  )}
                >
                  <div className="absolute left-3 top-3 z-10">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        'h-4 w-4 rounded border-border',
                        rejectedOnly ? 'accent-primary' : 'accent-rose-600',
                      )}
                      aria-label={`選取 ${p.title}`}
                    />
                  </div>
                  <button
                    ref={(el) => { cardRefs.current[p.id] = el; }}
                    onClick={() => openProduct(p)}
                    className="flex w-full flex-col gap-3 text-left"
                  >
                  {/* Revert reason banner — full-width row above content, wraps freely */}
                  {p.revertReason && (p.revertReason.labels.length > 0 || p.revertReason.other) && (
                    <div className="flex w-full flex-wrap items-center gap-1 rounded-lg bg-amber-500/10 px-2.5 py-2 ring-1 ring-amber-500/25">
                      <span className="font-body text-[10px] font-bold text-amber-700 dark:text-amber-400">已被退回：</span>
                      {p.revertReason.labels.map(label => (
                        <span key={label} className="rounded-full bg-amber-500/15 px-2 py-0.5 font-body text-[10px] font-semibold text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30">
                          {label}
                        </span>
                      ))}
                      {p.revertReason.other && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-body text-[10px] font-semibold text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30" title={p.revertReason.other}>
                          其他：{p.revertReason.other.slice(0, 20)}{p.revertReason.other.length > 20 ? '…' : ''}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-4 pl-6">
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
                  </div>
                  </button>
                </div>
              );})}
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
        <button
          onClick={() => {
            if (isDirty && !window.confirm('您有未儲存的更改，確定要返回列表嗎？')) return;
            setActiveId(null);
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> 返回列表
        </button>
        <div className="flex items-center gap-2">
          {isDirty && !isSaving && (
            <span className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              未儲存
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {isSaving ? '儲存中...' : '儲存'}
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

          {/* 產品編碼 (SKU) */}
          <Section title="產品編碼 (SKU)" desc="儲存後同步更新 products 及 ready_to_shopify 的 SKU 欄位">
            <div className="flex items-center rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
              <span className="flex items-center gap-1.5 border-r border-border/60 px-3 py-3 text-muted-foreground bg-muted/30 rounded-l-xl">
                <Hash className="h-3.5 w-3.5" />
              </span>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="例如 SKU-ABC123"
                className="w-full bg-transparent px-4 py-3 font-mono-data text-sm text-foreground focus:outline-none"
              />
            </div>
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
            <RichEditor value={desc} onChange={setDesc} productId={activeId} forceUpdateKey={isGenerating ? 'generating' : String(editorKey)} />
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
                    <img
                      src={primaryImg}
                      alt="主圖"
                      draggable={false}
                      className="h-full w-full object-cover cursor-zoom-in"
                      onClick={(e) => { e.stopPropagation(); setLightboxSrc(primaryImg); }}
                    />
                    <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground pointer-events-none">主圖</span>
                    <button
                      onClick={() => setPrimaryImg('')}
                      className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : isUploadingPrimary ? (
                  <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 text-primary">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-[10.5px] font-medium">上傳中…</span>
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
                      <img
                        src={src}
                        alt={`圖 ${i + 2}`}
                        draggable={false}
                        className="h-full w-full object-cover cursor-zoom-in"
                        onClick={(e) => { e.stopPropagation(); setLightboxSrc(src); }}
                      />
                      <button
                        onClick={() => setExtraImgs((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setShowImageUploadDialog(true)}
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

          {/* Shopify 搜尋引擎產品資訊 — Shopify-style vertical layout */}
          <Section title="Shopify 搜尋引擎產品資訊" desc="控制產品在 Google 搜尋結果的顯示">
            <div className="space-y-5">
              {/* 頁面標題 */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-body text-[13px] font-medium text-foreground">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  頁面標題
                </label>
                <input
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  maxLength={70}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 font-body text-[13px] focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="mt-1 font-body text-[11px] text-muted-foreground/60">
                  已使用 {seoTitle.length}/70 個字元
                </p>
              </div>

              {/* Meta 描述 — 6 行高 */}
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="font-body text-[13px] font-medium text-foreground">
                    Meta 描述
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateMeta}
                    disabled={isGeneratingMeta}
                    className="flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-500/20 disabled:opacity-60 transition-colors dark:text-indigo-400"
                  >
                    {isGeneratingMeta ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    {isGeneratingMeta ? 'AI 生成中...' : 'AI 生成'}
                  </button>
                </div>
                <textarea
                  value={seoDesc}
                  onChange={(e) => setSeoDesc(e.target.value)}
                  maxLength={160}
                  rows={6}
                  className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2.5 font-body text-[13px] leading-relaxed focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="mt-1 font-body text-[11px] text-muted-foreground/60">
                  已使用 {seoDesc.length}/160 個字元
                </p>
              </div>

              {/* 網址控制代碼 */}
              <div>
                <label className="mb-1.5 block font-body text-[13px] font-medium text-foreground">
                  網址控制代碼
                </label>
                <div className="flex items-center rounded-lg border border-border bg-card focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                  <span className="select-none border-r border-border/60 px-3 py-2.5 font-mono-data text-[12px] text-muted-foreground/60 whitespace-nowrap bg-muted/30 rounded-l-lg">
                    /products/
                  </span>
                  <input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    className="w-full bg-transparent px-3 py-2.5 font-mono-data text-[12px] focus:outline-none"
                    placeholder="your-product-url"
                  />
                </div>
                {handle && (
                  <p className="mt-1 font-mono-data text-[11px] text-muted-foreground/50">
                    https://www.bwoffice.asia/products/{handle}
                  </p>
                )}
              </div>
            </div>
          </Section>
        </div>
      </div>

      {/* Image Upload Dialog */}
      {showImageUploadDialog && activeId && (
        <ImageUploadDialog
          productId={activeId}
          onConfirm={(srcs) => setExtraImgs((prev) => [...prev, ...srcs])}
          onClose={() => setShowImageUploadDialog(false)}
        />
      )}

      {/* Lightbox */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}

// ─── Rich Text Editor ─────────────────────────────────────────────────────────

const ALLOWED_IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const PRESET_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#ffffff',
  '#ff0000', '#ff4500', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#9900ff',
  '#e6194b', '#f58231', '#ffe119', '#3cb44b', '#42d4f4', '#4363d8', '#911eb4', '#f032e6',
];

const MAX_IMG_BYTES = 5 * 1024 * 1024;

function RichEditor({ value, onChange, productId, forceUpdateKey }: { value: string; onChange: (v: string) => void; productId: string | null; forceUpdateKey?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  // Keep a ref so the forceUpdateKey effect always reads the latest value without it being a dep
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== valueRef.current) {
      editorRef.current.innerHTML = valueRef.current;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!forceUpdateKey || forceUpdateKey === 'generating') return;
    if (editorRef.current && editorRef.current.innerHTML !== valueRef.current) {
      editorRef.current.innerHTML = valueRef.current;
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

  const handleImageFile = async (file: File) => {
    if (!ALLOWED_IMG_TYPES.includes(file.type)) { toast.error('格式不支援，請上傳 PNG、JPG、WEBP 或 SVG'); return; }
    if (file.size > MAX_IMG_BYTES) { toast.error('圖片大小超過 5MB 上限'); return; }
    if (!productId) { toast.error('請先選擇產品'); return; }
    try {
      const url = await uploadFileToStorage(file, productId, `desc_${Date.now()}`);
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, `<img src="${url}" style="max-width:100%;height:auto;" />`);
      if (editorRef.current) onChange(editorRef.current.innerHTML);
    } catch (err) {
      toast.error('圖片上傳失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    }
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

// ─── Image Lightbox ───────────────────────────────────────────────────────────

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Native img so right-click copy/save works normally */}
      <img
        src={src}
        alt="預覽"
        className="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl object-contain select-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: 'default' }}
      />
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
      >
        <X className="h-5 w-5" />
      </button>
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 font-body text-[11px] text-white/70 pointer-events-none">
        點擊空白處關閉 · Esc 關閉 · 右鍵可複製或儲存圖片
      </p>
    </div>
  );
}

// ─── Image resize helper (upload-only — never returns base64) ─────────────────

async function uploadDialogImage(file: File | Blob, productId: string, suffix: string): Promise<string | null> {
  if (file instanceof File && !file.type.startsWith('image/')) {
    toast.error('格式不支援，請上傳圖片檔案');
    return null;
  }
  if (file.size > MAX_IMG_BYTES) {
    toast.error('圖片超過 5MB 上限');
    return null;
  }
  try {
    return await uploadFileToStorage(file, productId, suffix);
  } catch (err) {
    toast.error('圖片上傳失敗', { description: err instanceof Error ? err.message : '請稍後再試' });
    return null;
  }
}

// ─── Image Upload Dialog ──────────────────────────────────────────────────────

interface ImageSlot {
  src: string;
}

function ImageUploadDialog({ productId, onConfirm, onClose }: { productId: string; onConfirm: (srcs: string[]) => void; onClose: () => void }) {
  const [slots, setSlots] = useState<ImageSlot[]>([{ src: '' }]);
  const [activeSlot, setActiveSlot] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  // Per-slot error message (e.g. size exceeded)
  const [slotError, setSlotError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteAreaRef = useRef<HTMLDivElement>(null);

  // Focus paste area on mount / slot switch, clear error on slot change
  useEffect(() => {
    pasteAreaRef.current?.focus();
    setSlotError('');
  }, [activeSlot]);

  const setSrc = (idx: number, src: string) => setSlots((prev) => prev.map((s, i) => i === idx ? { src } : s));

  const processAndSet = async (file: File | Blob) => {
    if (file.size > MAX_IMG_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      setSlotError(`圖片檔案大小為 ${mb}MB，已超過 5MB 上限，請重新選擇較小的圖片`);
      setSrc(activeSlot, '');
      return;
    }
    setSlotError('');
    setIsProcessing(true);
    try {
      const url = await uploadDialogImage(file, productId, `dialog_${activeSlot}_${Date.now()}`);
      if (url) setSrc(activeSlot, url);
      else setSlotError('圖片上傳失敗，請重試');
    } catch { setSlotError('圖片處理失敗，請重試'); }
    finally { setIsProcessing(false); }
  };

  const handlePaste = useCallback(async (e: ClipboardEvent | React.ClipboardEvent) => {
    const items = (e as any).clipboardData?.items || (e as ClipboardEvent).clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault?.();
        const file = item.getAsFile();
        if (file) await processAndSet(file);
        return;
      }
    }
  }, [activeSlot]);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > MAX_IMG_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      setSlotError(`圖片檔案大小為 ${mb}MB，已超過 5MB 上限，請重新選擇較小的圖片`);
      setSrc(activeSlot, '');
      return;
    }
    setSlotError('');
    const url = await uploadDialogImage(file, productId, `dialog_file_${Date.now()}`);
    if (url) setSrc(activeSlot, url);
  };

  // Global paste listener
  useEffect(() => {
    const handler = (e: ClipboardEvent) => handlePaste(e);
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [handlePaste]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) await processAndSet(file);
  };

  const addSlot = () => {
    setSlots((prev) => [...prev, { src: '' }]);
    setActiveSlot(slots.length);
  };

  const removeSlot = (idx: number) => {
    if (slots.length === 1) { setSrc(0, ''); return; }
    setSlots((prev) => prev.filter((_, i) => i !== idx));
    setActiveSlot(Math.max(0, idx - 1));
  };

  const confirmedSrcs = slots.map((s) => s.src).filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative flex flex-col bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="font-display text-sm font-bold">新增其他圖片</h3>
            <p className="font-body text-[11px] text-muted-foreground mt-0.5">支援 Ctrl+V 貼上 · 最大 5MB · 自動縮放至 1200×1200</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Slot tabs */}
        <div className="flex items-center gap-1.5 px-5 pt-3 shrink-0 flex-wrap">
          {slots.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSlot(i)}
              className={cn(
                'flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium border transition-colors',
                activeSlot === i ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
              )}
            >
              {s.src ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : null}
              圖片 {i + 1}
              {slots.length > 1 && (
                <X className="h-2.5 w-2.5 ml-0.5 hover:text-rose-500" onClick={(e) => { e.stopPropagation(); removeSlot(i); }} />
              )}
            </button>
          ))}
          <button onClick={addSlot} className="flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
            <Plus className="h-2.5 w-2.5" /> 新分頁
          </button>
        </div>

        {/* Paste / drop area */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
          <div
            ref={pasteAreaRef}
            tabIndex={0}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onPaste={(e) => handlePaste(e)}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors outline-none cursor-pointer',
              slotError
                ? 'border-rose-500/50 bg-rose-500/5'
                : slots[activeSlot]?.src
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-border hover:border-primary/40 hover:bg-muted/30',
              'min-h-[220px]'
            )}
            onClick={() => { if (!slots[activeSlot]?.src && !slotError) fileInputRef.current?.click(); }}
          >
            {isProcessing ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : slotError ? (
              <div className="flex flex-col items-center gap-3 px-6 text-center pointer-events-none select-none">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
                  <X className="h-6 w-6 text-rose-500" />
                </div>
                <div>
                  <p className="font-body text-sm font-semibold text-rose-600">超過 5MB 上限</p>
                  <p className="font-body text-[12px] text-rose-500/80 mt-1">{slotError}</p>
                </div>
                <button
                  className="pointer-events-auto mt-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-500/20 transition-colors"
                  onClick={(e) => { e.stopPropagation(); setSlotError(''); fileInputRef.current?.click(); }}
                >
                  重新選擇圖片
                </button>
              </div>
            ) : slots[activeSlot]?.src ? (
              <>
                <img src={slots[activeSlot].src} alt="" className="max-h-[200px] max-w-full rounded-lg object-contain" />
                <button
                  onClick={(e) => { e.stopPropagation(); setSrc(activeSlot, ''); setSlotError(''); }}
                  className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground pointer-events-none select-none">
                <UploadCloud className="h-10 w-10 opacity-40" />
                <div className="text-center">
                  <p className="font-body text-sm font-medium">按 Ctrl+V 貼上圖片</p>
                  <p className="font-body text-[11px] opacity-60 mt-1">或拖拉圖片至此</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-muted/20 shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted transition-colors"
          >
            <UploadCloud className="h-3.5 w-3.5" /> 從本地上傳
          </button>
          <div className="flex items-center gap-2">
            <span className="font-mono-data text-[11px] text-muted-foreground">{confirmedSrcs.length} 張已就緒</span>
            <button
              onClick={() => { if (confirmedSrcs.length > 0) { onConfirm(confirmedSrcs); onClose(); } }}
              disabled={confirmedSrcs.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" /> 完成（{confirmedSrcs.length}）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

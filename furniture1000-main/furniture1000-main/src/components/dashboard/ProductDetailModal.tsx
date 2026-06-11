import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { ColorSelector } from './ColorSelector';
import { CascadingCategorySelector } from './CascadingCategorySelector';
import {
  X,
  Save,
  Loader2,
  Store,
  Factory,
  Truck,
  Clock,
  DollarSign,
  Package,
  Palette,
  FileText,
  Tag,
  Check,
  AlertCircle,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ImageIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
// Color map utilities available if needed
// import { getChineseColorLabel, getColorHex } from '@/constants/color-map';
import { motion, AnimatePresence } from 'framer-motion';

interface ProductImage {
  id?: number;
  src: string;
  alt?: string;
  path?: string;
}

interface ProductForDetail {
  id: string;
  title: string;
  description: string;
  descriptionHtml?: string;
  tags: string[];
  price: number;
  compareAtPrice?: number;
  collection: string;
  status: string;
  imageUrl: string;
  images?: ProductImage[];
  shopifyProductId: string | null;
  source: string;
  syncedAt?: string | null;
  createdAt: string;
  color?: string | null;
  factoryId?: string | null;
  factoriesDisplayName?: string | null;
  costPrice?: number | null;
  productionLeadTime?: number | null;
  shippingDays?: number | null;
  shippingFee?: number | null;
  totalLeadTime?: number | null;
  bwfMasterId?: string | null;
  remarks?: string | null;
  category?: string | null;
  deliveryTermId?: string | null;
  deliveryTermName?: string | null;
  dimensionLMm?: number | null;
  dimensionWMm?: number | null;
  dimensionHMm?: number | null;
}

interface ProductDetailModalProps {
  product: ProductForDetail;
  open: boolean;
  onClose: () => void;
  onProductUpdated: (updatedProduct: ProductForDetail) => void;
}

// ─── Lightbox Component ────────────────────────────────────────────────
function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: ProductImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const goNext = useCallback(() => setCurrentIndex((i) => (i + 1) % images.length), [images.length]);
  const goPrev = useCallback(() => setCurrentIndex((i) => (i - 1 + images.length) % images.length), [images.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goNext, goPrev]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {/* Counter */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm">
        <span className="font-mono-data text-xs text-white">
          {currentIndex + 1} / {images.length}
        </span>
      </div>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-4 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <ChevronLeft className="h-6 w-6 text-white" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-4 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <ChevronRight className="h-6 w-6 text-white" />
          </button>
        </>
      )}

      {/* Main Image */}
      <motion.div
        key={currentIndex}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="max-w-[85vw] max-h-[85vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={images[currentIndex]?.src}
          alt={images[currentIndex]?.alt || 'Product image'}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />
      </motion.div>

      {/* Thumbnail strip at bottom */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 px-4 py-2 rounded-xl bg-white/10 backdrop-blur-sm max-w-[80vw] overflow-x-auto">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
              className={cn(
                'h-12 w-12 flex-shrink-0 rounded-md overflow-hidden border-2 transition-all',
                idx === currentIndex
                  ? 'border-white scale-110'
                  : 'border-transparent opacity-60 hover:opacity-100'
              )}
            >
              <img
                src={img.src}
                alt={img.alt || `Thumb ${idx + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Modal Component ─────────────────────────────────────────────
export function ProductDetailModal({
  product,
  open,
  onClose,
  onProductUpdated,
}: ProductDetailModalProps) {
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [productionLeadTime, setProductionLeadTime] = useState('');
  const [shippingDays, setShippingDays] = useState('');
  const [shippingFee, setShippingFee] = useState('');
  const [color, setColor] = useState('');
  const [remarks, setRemarks] = useState('');
  const [dimensionL, setDimensionL] = useState('');
  const [dimensionW, setDimensionW] = useState('');
  const [dimensionH, setDimensionH] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Category dropdown state
  const [categoryList, setCategoryList] = useState<{ id: string; name: string; parent_id: string | null; level: number; sort_order: number }[]>([]);
  const [categoryListLoading, setCategoryListLoading] = useState(false);

  // Image/Media state
  const [images, setImages] = useState<ProductImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingNewFiles, setPendingNewFiles] = useState<File[]>([]);
  const [pendingDeletePaths, setPendingDeletePaths] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Populate form when product changes
  useEffect(() => {
    if (product) {
      setTitle(product.title || '');
      setDescription(product.descriptionHtml || product.description || '');
      setCategory(product.category || product.collection || '');
      setCostPrice(product.costPrice != null ? product.costPrice.toString() : '');
      setSalePrice(product.price != null ? product.price.toString() : '');
      setFactoryId(product.factoryId || '');
      setProductionLeadTime(product.productionLeadTime != null ? product.productionLeadTime.toString() : '');
      setShippingDays(product.shippingDays != null ? product.shippingDays.toString() : '');
      setShippingFee(product.shippingFee != null ? product.shippingFee.toString() : '');
      setColor(product.color || '');
      setRemarks(product.remarks || '');
      setDimensionL(product.dimensionLMm != null ? product.dimensionLMm.toString() : '');
      setDimensionW(product.dimensionWMm != null ? product.dimensionWMm.toString() : '');
      setDimensionH(product.dimensionHMm != null ? product.dimensionHMm.toString() : '');

      // Initialize images
      const productImages: ProductImage[] = product.images && product.images.length > 0
        ? product.images
        : product.imageUrl
          ? [{ src: product.imageUrl, alt: product.title }]
          : [];
      setImages(productImages);
      setSelectedImageIndex(0);
      setPendingNewFiles([]);
      setPendingDeletePaths([]);
    }
  }, [product]);

  // Fetch categories when modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setCategoryListLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('supabase-functions-manage-categories', {
          body: { action: 'list' },
        });
        if (!cancelled && data?.categories) {
          setCategoryList(data.categories);
        }
        if (error) console.warn('[ProductDetailModal] Failed to fetch categories:', error);
      } catch (err) {
        console.warn('[ProductDetailModal] Category fetch error:', err);
      } finally {
        if (!cancelled) setCategoryListLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Auto-calculate total lead time
  const computedTotalLeadTime = (() => {
    const prod = productionLeadTime ? parseInt(productionLeadTime) : 0;
    const ship = shippingDays ? parseInt(shippingDays) : 0;
    if (!productionLeadTime && !shippingDays) return null;
    return prod + ship;
  })();

  // ─── Image Handlers ─────────────────────────────────────────────────
  const handleImageClick = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const handleAddImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);
    setPendingNewFiles((prev) => [...prev, ...newFiles]);

    // Create preview URLs for new files and add to images array
    const previewImages: ProductImage[] = newFiles.map((file) => ({
      src: URL.createObjectURL(file),
      alt: file.name.replace(/\.[^/.]+$/, ''),
      path: `__pending__${file.name}`,
    }));

    setImages((prev) => [...prev, ...previewImages]);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteImage = (index: number) => {
    const imageToDelete = images[index];

    // If it has a storage path (not a pending file and not a URL-only image), mark for deletion
    if (imageToDelete.path && !imageToDelete.path.startsWith('__pending__')) {
      setPendingDeletePaths((prev) => [...prev, imageToDelete.path!]);
    }

    // If it's a pending file, remove it from pending
    if (imageToDelete.path?.startsWith('__pending__')) {
      const fileName = imageToDelete.path.replace('__pending__', '');
      setPendingNewFiles((prev) => prev.filter((f) => f.name !== fileName));
      // Revoke object URL
      URL.revokeObjectURL(imageToDelete.src);
    }

    const newImages = images.filter((_, i) => i !== index);
    setImages(newImages);

    // Adjust selected index
    if (selectedImageIndex >= newImages.length) {
      setSelectedImageIndex(Math.max(0, newImages.length - 1));
    } else if (index < selectedImageIndex) {
      setSelectedImageIndex((prev) => prev - 1);
    }
  };

  // ─── Save Handler ───────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    const toastId = toast.loading('正在儲存產品資料...', {
      description: '正在更新本地及全域資料庫。',
    });

    try {
      const parsedCostPrice = costPrice ? parseFloat(costPrice) : null;
      const parsedSalePrice = salePrice ? parseFloat(salePrice) : null;
      const parsedProductionLeadTime = productionLeadTime ? parseInt(productionLeadTime) : null;
      const parsedShippingDays = shippingDays ? parseInt(shippingDays) : null;
      const parsedShippingFee = shippingFee ? parseFloat(shippingFee) : null;
      const parsedDimensionL = dimensionL ? parseInt(dimensionL) : null;
      const parsedDimensionW = dimensionW ? parseInt(dimensionW) : null;
      const parsedDimensionH = dimensionH ? parseInt(dimensionH) : null;
      const totalLead = (parsedProductionLeadTime ?? 0) + (parsedShippingDays ?? 0);
      const computedTotal = (parsedProductionLeadTime != null || parsedShippingDays != null) ? totalLead : null;

      // ─── Handle image uploads/deletes for master DB ─────────────────
      let finalImages = images.filter((img) => !img.path?.startsWith('__pending__'));
      let mediaUploadSuccess = true;

      if (product.bwfMasterId) {
        // Upload new files
        if (pendingNewFiles.length > 0) {
          setIsUploading(true);
          setUploadProgress(10);

          const formData = new FormData();
          formData.append('master_id', product.bwfMasterId);
          pendingNewFiles.forEach((file) => {
            formData.append('files', file);
          });

          setUploadProgress(30);

          try {
            const { data: uploadResult, error: uploadError } = await supabase.functions.invoke(
              'supabase-functions-manage-master-media',
              { body: formData }
            );

            setUploadProgress(70);

            if (uploadError || !uploadResult?.success) {
              console.error('[ProductDetail] Media upload error:', uploadError || uploadResult?.error);
              mediaUploadSuccess = false;
              toast.warning('部分圖片上傳失敗', {
                description: uploadError?.message || uploadResult?.error || '請重試',
              });
            } else if (uploadResult?.all_images) {
              finalImages = uploadResult.all_images;
            }
          } catch (uploadErr) {
            console.error('[ProductDetail] Media upload exception:', uploadErr);
            mediaUploadSuccess = false;
          }

          setUploadProgress(80);
        }

        // Delete removed files
        if (pendingDeletePaths.length > 0) {
          try {
            const { error: deleteError } = await supabase.functions.invoke(
              'supabase-functions-manage-master-media',
              {
                body: {
                  action: 'delete',
                  master_id: product.bwfMasterId,
                  file_paths: pendingDeletePaths,
                  images: finalImages,
                },
              }
            );

            if (deleteError) {
              console.error('[ProductDetail] Media delete error:', deleteError);
            }
          } catch (delErr) {
            console.error('[ProductDetail] Media delete exception:', delErr);
          }
        }

        setUploadProgress(90);
        setIsUploading(false);
        setUploadProgress(0);
      }

      // ─── Step 1: Update local products table ────────────────────────
      const localImagesList = finalImages.map((img) => ({
        src: img.src,
        alt: img.alt || '',
        path: img.path || '',
      }));

      const localUpdate: Record<string, unknown> = {
        title,
        description: description,
        description_html: description,
        collection: category,
        category: category,
        cost_price: parsedCostPrice,
        price: parsedSalePrice ?? product.price,
        factory_id: factoryId || null,
        production_date: parsedProductionLeadTime,
        shipping_days: parsedShippingDays,
        shipping_fee: parsedShippingFee,
        total_lead_time: computedTotal,
        color: color || null,
        remarks: remarks || null,
        dimension_l_mm: parsedDimensionL,
        dimension_w_mm: parsedDimensionW,
        dimension_h_mm: parsedDimensionH,
        images: localImagesList,
        image_url: localImagesList[0]?.src || product.imageUrl || null,
      };

      const { error: localError } = await supabase
        .from('products')
        .update(localUpdate)
        .eq('id', product.id);

      if (localError) {
        console.error('[ProductDetail] Local update error:', localError);
        toast.error('本地資料庫更新失敗', {
          id: toastId,
          description: localError.message,
          duration: 8000,
        });
        setIsSaving(false);
        return;
      }

      // ─── Step 2: If product has a bwfMasterId, sync to master DB ────
      let masterSyncSuccess = true;
      if (product.bwfMasterId) {
        try {
          const masterPayload = {
            master_id: product.bwfMasterId,
            product: {
              title,
              description: description,
              category,
              factory_id: factoryId || null,
              cost_price: parsedCostPrice,
              sale_price: parsedSalePrice ?? product.price,
              shopify_price: parsedSalePrice ?? product.price,
              production_lead_time: parsedProductionLeadTime,
              shipping_days: parsedShippingDays,
              shipping_fee: parsedShippingFee,
              color: color || null,
              remarks: remarks || null,
              dimension_l_mm: parsedDimensionL,
              dimension_w_mm: parsedDimensionW,
              dimension_h_mm: parsedDimensionH,
              images: finalImages,
            },
          };

          const { data, error } = await supabase.functions.invoke(
            'supabase-functions-update-master-db',
            { body: masterPayload }
          );

          if (error) {
            console.error('[ProductDetail] Master DB sync error:', error);
            masterSyncSuccess = false;
          } else if (data && !data.success) {
            console.error('[ProductDetail] Master DB returned error:', data.error);
            masterSyncSuccess = false;
          }
        } catch (masterErr) {
          console.error('[ProductDetail] Master DB sync exception:', masterErr);
          masterSyncSuccess = false;
        }
      }

      // ─── Step 3: Build updated product object for parent state ──────
      const updatedProduct: ProductForDetail = {
        ...product,
        title,
        description,
        descriptionHtml: description,
        collection: category,
        category,
        costPrice: parsedCostPrice,
        price: parsedSalePrice ?? product.price,
        factoryId: factoryId || null,
        productionLeadTime: parsedProductionLeadTime,
        shippingDays: parsedShippingDays,
        shippingFee: parsedShippingFee,
        totalLeadTime: computedTotal,
        color: color || null,
        remarks: remarks || null,
        dimensionLMm: parsedDimensionL,
        dimensionWMm: parsedDimensionW,
        dimensionHMm: parsedDimensionH,
        images: finalImages,
        imageUrl: finalImages[0]?.src || product.imageUrl || '',
      };

      onProductUpdated(updatedProduct);

      // Clear pending state
      setPendingNewFiles([]);
      setPendingDeletePaths([]);

      if (product.bwfMasterId && (!masterSyncSuccess || !mediaUploadSuccess)) {
        toast.warning('已儲存至本地，全域同步部分失敗', {
          id: toastId,
          description: '本地資料已更新，但全域資料庫同步或媒體上傳未完全成功。',
          duration: 8000,
        });
      } else {
        toast.success('產品資料已儲存', {
          id: toastId,
          description: product.bwfMasterId
            ? '已同時更新本地及全域資料庫。'
            : '已更新本地資料庫。',
          duration: 4000,
        });
      }

      onClose();
    } catch (err) {
      console.error('[ProductDetail] Save error:', err);
      toast.error('儲存失敗', {
        id: toastId,
        description: err instanceof Error ? err.message : '未知錯誤',
        duration: 8000,
      });
    } finally {
      setIsSaving(false);
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [
    title, description, category, costPrice, salePrice, factoryId,
    productionLeadTime, shippingDays, shippingFee, color, remarks,
    dimensionL, dimensionW, dimensionH,
    images, pendingNewFiles, pendingDeletePaths,
    product, onProductUpdated, onClose,
  ]);

  // Get the selected display image
  const displayImage = images[selectedImageIndex]?.src || product.imageUrl || '';

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="relative w-full max-w-5xl mx-4 my-8 rounded-xl border border-border bg-background shadow-2xl"
          >
            {/* Top Bar */}
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-border bg-background/95 backdrop-blur-sm px-6 py-4">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="gap-2 font-display text-xs font-bold text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  退出
                </Button>
                <Separator orientation="vertical" className="h-5" />
                <span className="font-display text-sm font-bold truncate max-w-[300px]">
                  {product.title}
                </span>
                {product.bwfMasterId && (
                  <Badge className="gap-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono-data text-[9px]">
                    <Check className="h-2.5 w-2.5" />
                    已同步至全域
                  </Badge>
                )}
              </div>
              <Button
                onClick={handleSave}
                disabled={isSaving || isUploading}
                className="gap-2 font-display text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isSaving ? '儲存中...' : '儲存'}
              </Button>
            </div>

            {/* Upload Progress Bar */}
            {isUploading && (
              <div className="px-6 py-2 border-b border-border bg-muted/30">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                  <span className="font-body text-xs text-muted-foreground">正在上傳圖片...</span>
                  <Progress value={uploadProgress} className="flex-1 h-2" />
                  <span className="font-mono-data text-[10px] text-muted-foreground">{uploadProgress}%</span>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-0">
              {/* Left Column: Image + Media Manager + Meta */}
              <div className="border-r border-border p-6 space-y-5">
                {/* Main Product Image */}
                <div
                  className="relative aspect-square w-full rounded-lg overflow-hidden bg-muted border border-border cursor-pointer group"
                  onClick={() => images.length > 0 && handleImageClick(selectedImageIndex)}
                >
                  {displayImage ? (
                    <>
                      <img
                        src={displayImage}
                        alt={product.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                      </div>
                    </>
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <Store className="h-12 w-12 text-muted-foreground/30" />
                    </div>
                  )}
                </div>

                {/* Image Gallery / Media Manager */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-body text-xs text-muted-foreground">
                        媒體 ({images.length})
                      </span>
                    </div>
                    {pendingNewFiles.length > 0 && (
                      <Badge variant="outline" className="text-[9px] font-mono-data border-amber-500/30 text-amber-500">
                        +{pendingNewFiles.length} 待上傳
                      </Badge>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    {images.map((img, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          'relative h-16 w-16 rounded-md overflow-hidden border-2 flex-shrink-0 cursor-pointer group/thumb transition-all',
                          idx === selectedImageIndex
                            ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                            : 'border-border hover:border-muted-foreground/50',
                          img.path?.startsWith('__pending__') && 'ring-2 ring-amber-500/30'
                        )}
                        onClick={() => setSelectedImageIndex(idx)}
                      >
                        <img
                          src={img.src}
                          alt={img.alt || `Image ${idx + 1}`}
                          className="h-full w-full object-cover"
                        />
                        {/* Delete button - top-left corner */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteImage(idx);
                          }}
                          className="absolute top-1 left-1 p-1 rounded-full bg-black/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-rose-600 z-10"
                        >
                          <Trash2 className="h-2.5 w-2.5 text-white" />
                        </button>
                        {/* Pending indicator */}
                        {img.path?.startsWith('__pending__') && (
                          <div className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                        )}
                      </div>
                    ))}

                    {/* Add Image Button (Shopify-style "+" button) */}
                    <button
                      onClick={handleAddImageClick}
                      className="h-16 w-16 rounded-md border-2 border-dashed border-muted-foreground/30 hover:border-indigo-500/50 hover:bg-indigo-500/5 flex items-center justify-center transition-all flex-shrink-0 group/add"
                    >
                      <Plus className="h-5 w-5 text-muted-foreground/50 group-hover/add:text-indigo-500 transition-colors" />
                    </button>
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>

                <Separator />

                {/* Quick Meta */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-body">
                    <Tag className="h-3.5 w-3.5" />
                    <span>狀態</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-mono-data text-[10px]',
                      product.status === 'success' && 'border-emerald-500/30 text-emerald-500',
                      product.status === 'draft' && 'border-muted-foreground/30 text-muted-foreground',
                      product.status === 'publishing' && 'border-amber-500/30 text-amber-500',
                      product.status === 'error' && 'border-rose-500/30 text-rose-500'
                    )}
                  >
                    {product.status}
                  </Badge>

                  {product.shopifyProductId && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-body">
                        <Store className="h-3.5 w-3.5" />
                        <span>Shopify ID</span>
                      </div>
                      <span className="font-mono-data text-[11px] text-emerald-500">
                        {product.shopifyProductId}
                      </span>
                    </div>
                  )}

                  {product.bwfMasterId && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-body">
                        <Package className="h-3.5 w-3.5" />
                        <span>Master ID</span>
                      </div>
                      <span className="font-mono-data text-[11px] text-indigo-400">
                        {product.bwfMasterId.slice(0, 12)}...
                      </span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-body">
                      <Clock className="h-3.5 w-3.5" />
                      <span>建立時間</span>
                    </div>
                    <span className="font-mono-data text-[11px]">
                      {new Date(product.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {product.tags && product.tags.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-body">
                        <Tag className="h-3.5 w-3.5" />
                        <span>標籤</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {product.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[9px] font-mono-data px-1.5 py-0">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Edit Form */}
              <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-160px)]">
                {/* General Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <FileText className="h-4 w-4 text-indigo-500" />
                    <h3 className="font-display text-sm font-bold">一般資料</h3>
                  </div>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="detail-title" className="font-body text-xs text-muted-foreground">
                        產品標題
                      </Label>
                      <Input
                        id="detail-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="font-display text-sm font-bold h-10"
                        placeholder="輸入產品標題..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="detail-description" className="font-body text-xs text-muted-foreground">
                        產品說明
                      </Label>
                      <Textarea
                        id="detail-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="font-body text-xs min-h-[120px] resize-y"
                        placeholder="輸入產品說明..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="detail-category" className="font-body text-xs text-muted-foreground">
                        分類 / Collection
                      </Label>
                      <CascadingCategorySelector
                        categories={categoryList}
                        value={category}
                        onValueChange={setCategory}
                        placeholder={categoryListLoading ? '載入中...' : '選擇類目'}
                        showClear
                        triggerClassName="font-body text-xs h-9"
                      />
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Pricing Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <DollarSign className="h-4 w-4 text-amber-500" />
                    <h3 className="font-display text-sm font-bold">價格與成本</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="detail-cost-price" className="font-body text-xs text-muted-foreground">
                        成本價 (¥)
                      </Label>
                      <Input
                        id="detail-cost-price"
                        type="number"
                        step="0.01"
                        value={costPrice}
                        onChange={(e) => setCostPrice(e.target.value)}
                        className="font-mono-data text-xs h-9"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="detail-sale-price" className="font-body text-xs text-muted-foreground">
                        售價 ($)
                      </Label>
                      <Input
                        id="detail-sale-price"
                        type="number"
                        step="0.01"
                        value={salePrice}
                        onChange={(e) => setSalePrice(e.target.value)}
                        className="font-mono-data text-xs h-9"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  {costPrice && salePrice && (
                    <div className="mt-3 rounded-lg bg-muted/50 border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-body text-xs text-muted-foreground">利潤率</span>
                        <span className={cn(
                          'font-mono-data text-xs font-bold',
                          ((parseFloat(salePrice) - parseFloat(costPrice)) / parseFloat(salePrice) * 100) > 0
                            ? 'text-emerald-500'
                            : 'text-rose-500'
                        )}>
                          {(((parseFloat(salePrice) - parseFloat(costPrice)) / parseFloat(salePrice)) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}
                </section>

                <Separator />

                {/* Manufacturing Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Factory className="h-4 w-4 text-cyan-500" />
                    <h3 className="font-display text-sm font-bold">製造資訊</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="detail-factory-id" className="font-body text-xs text-muted-foreground">
                        廠家代號
                      </Label>
                      <Input
                        id="detail-factory-id"
                        value={factoryId}
                        onChange={(e) => setFactoryId(e.target.value)}
                        className="font-mono-data text-xs h-9"
                        placeholder="輸入廠家代號..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="detail-production-lead" className="font-body text-xs text-muted-foreground">
                        生產天數
                      </Label>
                      <Input
                        id="detail-production-lead"
                        type="number"
                        value={productionLeadTime}
                        onChange={(e) => setProductionLeadTime(e.target.value)}
                        className="font-mono-data text-xs h-9"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Shipping Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Truck className="h-4 w-4 text-violet-500" />
                    <h3 className="font-display text-sm font-bold">運輸資訊</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="detail-shipping-days" className="font-body text-xs text-muted-foreground">
                        運輸天數
                      </Label>
                      <Input
                        id="detail-shipping-days"
                        type="number"
                        value={shippingDays}
                        onChange={(e) => setShippingDays(e.target.value)}
                        className="font-mono-data text-xs h-9"
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="detail-shipping-fee" className="font-body text-xs text-muted-foreground">
                        運輸費 (¥)
                      </Label>
                      <Input
                        id="detail-shipping-fee"
                        type="number"
                        step="0.01"
                        value={shippingFee}
                        onChange={(e) => setShippingFee(e.target.value)}
                        className="font-mono-data text-xs h-9"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-body text-xs text-muted-foreground">
                        總交期 (自動計算)
                      </Label>
                      <div className="flex items-center h-9 px-3 rounded-md border border-border bg-muted/50">
                        <Clock className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                        <span className={cn(
                          'font-mono-data text-xs font-bold',
                          computedTotalLeadTime != null ? 'text-foreground' : 'text-muted-foreground'
                        )}>
                          {computedTotalLeadTime != null ? `${computedTotalLeadTime} 天` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {productionLeadTime && shippingDays && (
                    <div className="mt-3 rounded-lg bg-muted/50 border border-border p-3">
                      <div className="flex items-center gap-4 text-xs font-mono-data">
                        <span className="text-muted-foreground">
                          生產 {productionLeadTime}天
                        </span>
                        <span className="text-muted-foreground">+</span>
                        <span className="text-muted-foreground">
                          運輸 {shippingDays}天
                        </span>
                        <span className="text-muted-foreground">=</span>
                        <span className="font-bold text-indigo-500">
                          總計 {computedTotalLeadTime}天
                        </span>
                      </div>
                    </div>
                  )}
                </section>

                {/* Delivery Term */}
                {product?.deliveryTermName && (
                  <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-blue-500" />
                      <span className="font-body text-xs text-muted-foreground">貨期類型：</span>
                      <span className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 font-mono-data text-xs font-medium text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20">
                        {product.deliveryTermName}
                      </span>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Dimensions Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Package className="h-4 w-4 text-orange-500" />
                    <h3 className="font-display text-sm font-bold">尺寸資訊 / Dimensions (mm)</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="font-body text-xs text-muted-foreground">
                        長 (Length)
                      </Label>
                      <Input
                        type="number"
                        value={dimensionL}
                        onChange={e => setDimensionL(e.target.value)}
                        placeholder="mm"
                        className="h-9 font-mono-data text-xs bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-body text-xs text-muted-foreground">
                        闊 (Width)
                      </Label>
                      <Input
                        type="number"
                        value={dimensionW}
                        onChange={e => setDimensionW(e.target.value)}
                        placeholder="mm"
                        className="h-9 font-mono-data text-xs bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-body text-xs text-muted-foreground">
                        高 (Height)
                      </Label>
                      <Input
                        type="number"
                        value={dimensionH}
                        onChange={e => setDimensionH(e.target.value)}
                        placeholder="mm"
                        className="h-9 font-mono-data text-xs bg-background"
                      />
                    </div>
                  </div>
                  {(dimensionL || dimensionW || dimensionH) && (
                    <div className="mt-3 rounded-lg bg-muted/50 border border-border p-3">
                      <span className="font-mono-data text-xs text-muted-foreground">
                        {dimensionL || '—'} × {dimensionW || '—'} × {dimensionH || '—'} mm
                      </span>
                    </div>
                  )}
                </section>

                <Separator />

                {/* Attributes Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Palette className="h-4 w-4 text-rose-500" />
                    <h3 className="font-display text-sm font-bold">屬性</h3>
                  </div>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label className="font-body text-xs text-muted-foreground">
                        顏色
                      </Label>
                      <ColorSelector
                        value={color}
                        onChange={setColor}
                        placeholder="選擇顏色..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="detail-remarks" className="font-body text-xs text-muted-foreground">
                        備註
                      </Label>
                      <Textarea
                        id="detail-remarks"
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        className="font-body text-xs min-h-[80px] resize-y"
                        placeholder="輸入備註..."
                      />
                    </div>
                  </div>
                </section>

                {/* Sync Info Footer */}
                {product.bwfMasterId && (
                  <>
                    <Separator />
                    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-4 w-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                        <div className="space-y-1">
                          <p className="font-display text-xs font-bold text-indigo-400">
                            全域資料庫同步
                          </p>
                          <p className="font-body text-[11px] text-muted-foreground">
                            此產品已同步至全域資料庫 (bwf_product_master)。儲存時將同時更新本地及全域資料，包括圖片媒體檔案。
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>

          {/* Lightbox */}
          <AnimatePresence>
            {lightboxOpen && images.length > 0 && (
              <ImageLightbox
                images={images}
                initialIndex={lightboxIndex}
                onClose={() => setLightboxOpen(false)}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

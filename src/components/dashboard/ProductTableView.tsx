import { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import { cn } from '@/lib/utils';
import { Product, ProductVariant } from '@/types/product';
import { TagSelector } from './TagSelector';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ProductDetailModal } from './ProductDetailModal';
import { FGProductDetailModal } from './publish/FurnitureGroupCheckView';
import {
  X,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Trash2,
  Loader2,
  Database,
  Sparkles,
  Package,
  Upload,
  Search,
  Check,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

/** Letters a→z, then numeric chunks 1→9 (natural / alphanumeric order). */
function compareSkuNatural(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
}

function primarySortSku(product: Product): string {
  const direct = (product.sku || '').trim();
  if (direct) return direct;
  const variantSkus = (product.variants ?? [])
    .map((v) => (v.sku || '').trim())
    .filter(Boolean);
  if (variantSkus.length === 0) return '';
  return variantSkus.slice().sort(compareSkuNatural)[0];
}

// ─── Memoized Table Row ─────────────────────────────────────────────────────
interface ProductTableRowProps {
  product: Product;
  isSelected: boolean;
  globalIndex: number;
  editingCell: { id: string; field: string } | null;
  editValue: string;
  onCheckboxClick: (e: React.MouseEvent, productId: string, index: number) => void;
  onRowClick: (e: React.MouseEvent, product: Product) => void;
  onStartEditing: (id: string, field: string, value: string) => void;
  onEditValueChange: (value: string) => void;
  onSaveEdit: () => void;
  onUpdateProduct: (id: string, updates: Partial<Product>) => void;
  onUpdateRtsTags?: (rtsId: string, tags: string[]) => Promise<void>;
  onRetryPublish: (id: string) => void;
  onDeleteProduct: (id: string) => void;
  onOpenVariantModal: (product: Product) => void;
}

const ProductTableRow = memo(function ProductTableRow({
  product,
  isSelected,
  globalIndex,
  editingCell,
  editValue,
  onCheckboxClick,
  onRowClick,
  onStartEditing,
  onEditValueChange,
  onSaveEdit,
  onUpdateProduct,
  onUpdateRtsTags,
  onRetryPublish,
  onDeleteProduct,
  onOpenVariantModal,
}: ProductTableRowProps) {
  const isEditingThis = editingCell?.id === product.id;

  return (
    <tr
      className={cn(
        'group h-[52px] border-b border-border transition-colors cursor-pointer hover:bg-slate-50 dark:hover:bg-muted/50',
        isSelected && 'bg-primary/5',
        product.source === 'shopify' && 'bg-emerald-500/[0.02]'
      )}
      onClick={(e) => onRowClick(e, product)}
    >
      {/* Checkbox */}
      <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); onCheckboxClick(e, product.id, globalIndex); }}>
        <Checkbox
          checked={isSelected}
          className="pointer-events-none"
        />
      </td>

      {/* Title + Image */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 text-left">
          <div className="h-9 w-9 rounded-md overflow-hidden flex-shrink-0 bg-white border border-border/50 aspect-square">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-muted">
                <span className="text-muted-foreground/40 text-[8px]">—</span>
              </div>
            )}
          </div>
          <span className="font-display text-xs font-bold leading-tight line-clamp-2 max-w-[180px]">
            {product.title}
          </span>
        </div>
      </td>

      {/* Description */}
      <td className="max-w-[200px] px-4 py-3">
        <div className="text-left">
          <span className={cn(
            'text-xs text-muted-foreground font-body',
            'line-clamp-2'
          )}>
            {product.description}
          </span>
        </div>
      </td>

      {/* SKU (產品編碼) — read-only here; edit via the product detail modal */}
      <td className="px-4 py-3">
        <span
          className="font-mono-data text-xs text-foreground cursor-default select-text"
          title="如需修改產品編碼，請點開產品詳情頁"
        >
          {product.sku ? product.sku : <span className="text-muted-foreground/50">—</span>}
        </span>
      </td>

      {/* Cost Price */}
      <td className="px-4 py-3">
        {isEditingThis && editingCell!.field === 'costPrice' ? (
          <Input
            autoFocus
            type="number"
            step="0.01"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            onBlur={onSaveEdit}
            className="h-8 w-24 font-mono-data text-xs bg-background"
          />
        ) : (
          <button
            onClick={() => onStartEditing(product.id, 'costPrice', (product.costPrice ?? '').toString())}
            className="font-mono-data text-xs"
          >
            {product.costPrice != null ? `$${product.costPrice.toFixed(2)}` : <span className="text-muted-foreground/50">—</span>}
          </button>
        )}
      </td>

      {/* Sale Price (售價) */}
      <td className="px-4 py-3">
        {isEditingThis && editingCell!.field === 'salePrice' ? (
          <div className="flex items-center gap-1">
            <span className="font-mono-data text-[10px] text-muted-foreground">HK$</span>
            <Input
              autoFocus
              type="number"
              step="0.01"
              min={0}
              value={editValue}
              onChange={e => onEditValueChange(e.target.value)}
              onBlur={onSaveEdit}
              className="h-8 w-24 font-mono-data text-xs bg-background"
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onStartEditing(product.id, 'salePrice', (product.salePrice ?? 0).toString())}
              className="font-mono-data text-xs font-bold text-emerald-500"
            >
              {product.salePrice != null && product.salePrice > 0 ? `HK$${product.salePrice.toFixed(2)}` : <span className="text-muted-foreground/50">HK$0.00</span>}
            </button>
            {product.bwfMasterId && product.salePrice != null && product.salePrice > 0 && (
              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500/20 text-emerald-400" title="Will sync to Master DB on save">
                <Database className="w-2 h-2" />
              </span>
            )}
          </div>
        )}
      </td>

      {/* Dimensions (產品尺寸 LWH) */}
      <td className="px-4 py-3">
        {(product.dimensionLMm || product.dimensionWMm || product.dimensionHMm) ? (
          <span className="font-mono-data text-[10px] text-foreground whitespace-nowrap">
            {product.dimensionLMm ?? '—'} × {product.dimensionWMm ?? '—'} × {product.dimensionHMm ?? '—'} mm
          </span>
        ) : (
          <span className="font-mono-data text-[10px] text-muted-foreground/50">—</span>
        )}
      </td>

      {/* Tags (產品標籤) — using TagSelector with official product tags */}
      <td className="px-4 py-3">
        <TagSelector
          selectedTags={product.tags}
          onChange={(tags) => {
            onUpdateProduct(product.id, { tags });
            if (onUpdateRtsTags) onUpdateRtsTags(product.id, tags);
          }}
          compact
          maxVisible={3}
        />
      </td>

      {/* Variants */}
      <td className="px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenVariantModal(product)}
          className="h-7 gap-1 text-[10px] font-mono-data"
        >
          {/* extra variants = all rows excluding the host product itself */}
          {product.variants.filter(v => v.id !== product.id).length} 個變體
          <ChevronDown className="h-3 w-3" />
        </Button>
      </td>

      {/* Delivery Term (送貨資訊) — in_stock=true 顯示「現貨」，否則顯示 customize */}
      <td className="px-4 py-3">
        {product.inStock === true ? (
          <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono-data text-xs font-medium text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
            現貨
          </span>
        ) : product.customize ? (
          <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 font-mono-data text-xs font-medium text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20">
            {product.customize}
          </span>
        ) : (
          <span className="font-mono-data text-[10px] text-muted-foreground/50">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <button
          onClick={() => onDeleteProduct(product.id)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
});

interface ProductTableViewProps {
  products: Product[];
  selectedIds: Set<string>;
  filterProductId: string | null;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onSelectRange: (ids: string[], selected: boolean) => void;
  onUpdateProduct: (id: string, updates: Partial<Product>) => void;
  onUpdateRtsTags?: (rtsId: string, tags: string[]) => Promise<void>;
  onRetryPublish: (id: string) => void;
  onDeleteProduct: (id: string) => void;
  onBatchDeleteProducts?: (ids: string[]) => Promise<void>;
  onClearFilter: () => void;
  onSyncFromShopify?: () => Promise<any>;
  onUploadUnsyncedToMaster?: () => Promise<any>;
  onRevertToInfo?: (ids: string[], reasons: { labels: string[]; other: string }) => Promise<void>;
  onVariantsSaved?: () => void;
  isSyncing?: boolean;
  isPublishing?: boolean;
  lastSyncTime?: string | null;
  readyToPublishMode?: boolean;
}

type TableTab = 'local' | 'shopify' | 'all';

export const ProductTableView = memo(function ProductTableView({
  products,
  selectedIds,
  filterProductId,
  onToggleSelect,
  onSelectAll,
  onSelectRange,
  onUpdateProduct,
  onUpdateRtsTags,
  onRetryPublish,
  onDeleteProduct,
  onBatchDeleteProducts,
  onClearFilter,
  onSyncFromShopify,
  onUploadUnsyncedToMaster,
  onRevertToInfo,
  onVariantsSaved,
  isSyncing,
  isPublishing,
  lastSyncTime,
  readyToPublishMode = false,
}: ProductTableViewProps) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  // expandedDesc removed — description now opens modal on click
  const [variantModal, setVariantModal] = useState<{ product: Product } | null>(null);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showRevertDialog, setShowRevertDialog] = useState(false);
  const [revertReasons, setRevertReasons] = useState<string[]>([]);
  const [revertOther, setRevertOther] = useState('');
  const [skuSortDir, setSkuSortDir] = useState<'asc' | 'desc'>('asc');
  const REVERT_OPTIONS = ['產品情景圖修改', '產品圖片角度不足', '產品說明修正', '其他'];
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerFactoryFilter, setPickerFactoryFilter] = useState('');
  const [pickerPage, setPickerPage] = useState(0);
  const PICKER_PAGE_SIZE = 10;
  const [activeTab, setActiveTab] = useState<TableTab>(readyToPublishMode ? 'all' : 'local');
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  // ── Filters (same UX as 產品信息): search by name/SKU, L1/L2 category, factory, page size ──
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [level1Filter, setLevel1Filter] = useState('');
  const [level2Filter, setLevel2Filter] = useState('');
  const [factoryFilter, setFactoryFilter] = useState('');
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  const PAGE_SIZE = pageSize;

  // Load L1/L2 category options once
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
    () => Array.from(new Set(products.map(p => p.factoriesDisplayName || p.factoryName || '').filter(Boolean))),
    [products]
  );

  // Shift-click range selection state
  const lastSelectedIndexRef = useRef<number | null>(null);

  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    setShowBatchDeleteModal(false);
    if (onBatchDeleteProducts) {
      await onBatchDeleteProducts(ids);
    } else {
      ids.forEach(id => onDeleteProduct(id));
      toast.success(`已成功刪除 ${count} 個產品`);
    }
  }, [selectedIds, onDeleteProduct, onBatchDeleteProducts]);

  const baseProducts = useMemo(() =>
    filterProductId
      ? products.filter(p => p.id === filterProductId)
      : products,
    [products, filterProductId]
  );

  // Separate local AI drafts from synced Shopify products
  const localProducts = useMemo(() => baseProducts.filter(p => p.source === 'local' || !p.source), [baseProducts]);
  const shopifyProducts = useMemo(() => baseProducts.filter(p => p.source === 'shopify'), [baseProducts]);
  
  const tabProducts = useMemo(() =>
    activeTab === 'all'
      ? baseProducts
      : activeTab === 'shopify'
        ? shopifyProducts
        : localProducts,
    [activeTab, baseProducts, shopifyProducts, localProducts]
  );

  // Apply search (name/SKU), L1/L2 category, and factory filters.
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tabProducts.filter(p => {
      if (q) {
        const sku = (p.sku || '').toLowerCase();
        const model = ((p as any).model || '').toLowerCase();
        const factoryId = (p.factoryId || '').toLowerCase();
        const title = (p.title || '').toLowerCase();
        if (!title.includes(q) && !sku.includes(q) && !model.includes(q) && !factoryId.includes(q)) return false;
      }
      if (level1Filter) {
        const l1 = (p as any).level1Category || p.collection || '';
        if (l1 !== level1Filter) return false;
      }
      if (level2Filter) {
        const l2 = (p as any).level2Category || '';
        if (l2 !== level2Filter) return false;
      }
      if (factoryFilter) {
        const f = p.factoriesDisplayName || p.factoryName || '';
        if (f !== factoryFilter) return false;
      }
      return true;
    });
  }, [tabProducts, searchQuery, level1Filter, level2Filter, factoryFilter]);

  const displayedProducts = useMemo(() => {
    if (!readyToPublishMode) return filteredProducts;
    return [...filteredProducts].sort((a, b) => {
      const cmp = compareSkuNatural(primarySortSku(a), primarySortSku(b));
      return skuSortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredProducts, readyToPublishMode, skuSortDir]);

  const allFilteredIds = useMemo(() => displayedProducts.map(p => p.id), [displayedProducts]);
  const allSelected = useMemo(
    () => allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id)),
    [allFilteredIds, selectedIds]
  );

  // Pagination
  const totalPages = Math.ceil(displayedProducts.length / PAGE_SIZE);
  const paginatedProducts = useMemo(
    () => displayedProducts.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [displayedProducts, currentPage, PAGE_SIZE]
  );

  // Reset page when tab or any filter changes
  useEffect(() => {
    setCurrentPage(0);
  }, [activeTab, filterProductId, searchQuery, level1Filter, level2Filter, factoryFilter, pageSize, skuSortDir]);

  // Handle checkbox click with shift-click range selection support
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const displayedProductsRef = useRef(displayedProducts);
  displayedProductsRef.current = displayedProducts;

  const handleCheckboxClick = useCallback((e: React.MouseEvent, productId: string, index: number) => {
    if (e.shiftKey && lastSelectedIndexRef.current !== null) {
      // Range selection
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end = Math.max(lastSelectedIndexRef.current, index);
      const rangeIds = displayedProductsRef.current.slice(start, end + 1).map(p => p.id);
      // Determine whether to select or deselect based on whether the anchor was being selected
      const anchorId = displayedProductsRef.current[lastSelectedIndexRef.current]?.id;
      const shouldSelect = anchorId ? selectedIdsRef.current.has(anchorId) : true;
      onSelectRange(rangeIds, shouldSelect);
    } else {
      // Standard single toggle
      onToggleSelect(productId);
    }
    lastSelectedIndexRef.current = index;
  }, [onToggleSelect, onSelectRange]);

  const startEditing = useCallback((id: string, field: string, value: string) => {
    setEditingCell({ id, field });
    setEditValue(value);
  }, []);

  // Use refs for edit state so saveEdit callback identity stays stable
  const editingCellRef = useRef(editingCell);
  editingCellRef.current = editingCell;
  const editValueRef = useRef(editValue);
  editValueRef.current = editValue;

  const saveEdit = useCallback(() => {
    const currentEditingCell = editingCellRef.current;
    const currentEditValue = editValueRef.current;
    if (!currentEditingCell) return;
    const { id, field } = currentEditingCell;
    if (field === 'price' || field === 'costPrice' || field === 'shippingFee' || field === 'salePrice') {
      onUpdateProduct(id, { [field]: parseFloat(currentEditValue) || 0 });
    } else if (field === 'shippingDays' || field === 'productionLeadTime') {
      onUpdateProduct(id, { [field]: parseInt(currentEditValue) || 0 });
    } else {
      onUpdateProduct(id, { [field]: currentEditValue });
    }
    setEditingCell(null);
    setEditValue('');
  }, [onUpdateProduct]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  // Handle row click to open detail modal (ignore checkbox/button clicks)
  const handleRowClick = useCallback((e: React.MouseEvent, product: Product) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('[role="checkbox"]') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('a')
    ) {
      return;
    }
    setDetailProduct(product);
  }, []);

  // Handle product updated from detail modal
  const handleProductUpdatedFromModal = useCallback((updatedProduct: any) => {
    onUpdateProduct(updatedProduct.id, updatedProduct);
    setDetailProduct(null);
  }, [onUpdateProduct]);

  // Memoized select all handler to prevent re-render cascades
  const handleSelectAll = useCallback(() => {
    onSelectAll(allFilteredIds);
  }, [onSelectAll, allFilteredIds]);

  const handleOpenVariantModal = useCallback((product: Product) => {
    const dims = [product.dimensionLMm, product.dimensionWMm, product.dimensionHMm].filter(Boolean).join('x') || '';
    const selfVariant: ProductVariant = {
      id: product.id,
      productId: product.productId,
      size: dims,
      color: product.color || '',
      sku: product.sku || '',
      price: product.salePrice ?? product.price ?? 0,
      inventory: 100,
      option1: dims,
    };
    // Always put the host product as the first row.
    // Keep any previously-added non-host variants after it.
    const otherVariants = product.variants.filter(v => v.id !== product.id);
    const variants = [selfVariant, ...otherVariants];
    const productWithSelf = { ...product, variants };
    onUpdateProduct(product.id, { variants });
    setVariantModal({ product: productWithSelf });
  }, [onUpdateProduct]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelEdit();
      if (e.key === 'Enter' && !e.shiftKey && editingCellRef.current?.field !== 'description') saveEdit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cancelEdit, saveEdit]);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* Tab Bar + Sync Controls */}
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-6 py-2">
          <div className="flex items-center gap-3">
            {/* Source Tabs */}
            <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
              <button
                onClick={() => setActiveTab('local')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-display font-bold transition-all',
                  activeTab === 'local'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Sparkles className="h-3 w-3" />
                本地 AI 草稿
                <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[9px]">
                  {localProducts.length}
                </Badge>
              </button>
              <button
                onClick={() => setActiveTab('shopify')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-display font-bold transition-all',
                  activeTab === 'shopify'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Database className="h-3 w-3" />
                已同步 Shopify
                <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[9px]">
                  {shopifyProducts.length}
                </Badge>
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-display font-bold transition-all',
                  activeTab === 'all'
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                全部
                <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[9px]">
                  {baseProducts.length}
                </Badge>
              </button>
            </div>

            {/* Product Count */}
            <div className="flex items-center gap-1.5 rounded-md bg-muted/60 border border-border/50 px-2.5 py-1">
              <Package className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono-data text-[11px] text-muted-foreground font-medium">
                {products.length} 個產品
              </span>
            </div>

            {filterProductId && (
              <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1">
                <Filter className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-primary font-body">已篩選至 1 個產品</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearFilter}
                  className="h-5 gap-1 px-1.5 text-xs"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}

          </div>

          <div className="flex items-center gap-2">
            {/* Revert to 產品文案 Button */}
            {onRevertToInfo && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedIds.size === 0) {
                    toast.info('請先勾選要退回的產品');
                    return;
                  }
                  setRevertReasons([]);
                  setRevertOther('');
                  setShowRevertDialog(true);
                }}
                disabled={selectedIds.size === 0}
                className={cn(
                  "gap-2 font-display text-xs font-bold border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400",
                  selectedIds.size === 0 && "opacity-50"
                )}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {`退回上一步${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
              </Button>
            )}

            {/* Batch Delete Button */}
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedIds.size === 0}
              onClick={() => setShowBatchDeleteModal(true)}
              className={cn(
                "gap-2 font-display text-xs font-bold transition-all",
                selectedIds.size === 0 && "opacity-50"
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              批量刪除
              {selectedIds.size > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 bg-white/20 px-1 text-[9px] text-white">
                  {selectedIds.size}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {/* Section info banner */}
        {activeTab === 'local' && (
          <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-6 py-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[11px] text-primary font-body">
              這些是 AI 生成及本地建立的產品。選擇項目以上傳到<strong>全域資料庫</strong>。
            </span>
          </div>
        )}
        {activeTab === 'shopify' && (
          <div className="flex items-center gap-2 border-b border-border bg-emerald-500/5 px-6 py-1.5">
            <Database className="h-3 w-3 text-emerald-500" />
            <span className="text-[11px] text-emerald-500 font-body">
              Shopify 安全備份副本。此為唯讀參考 — 請直接在 Shopify 管理後台編輯。
            </span>
          </div>
        )}

        {/* Filter toolbar — search (name/SKU) · page size · L1/L2 category · factory */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-6 py-2.5">
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
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
          >
            {[20, 25, 50, 100].map(n => <option key={n} value={n}>每頁 {n} 項</option>)}
          </select>
          <select
            value={level1Filter}
            onChange={(e) => { setLevel1Filter(e.target.value); setLevel2Filter(''); }}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
          >
            <option value="">全部一級分類</option>
            {level1Options.map(l1 => <option key={l1} value={l1}>{l1}</option>)}
          </select>
          <select
            value={level2Filter}
            onChange={(e) => setLevel2Filter(e.target.value)}
            disabled={!level1Filter}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer disabled:opacity-50"
          >
            <option value="">全部二級分類</option>
            {level2Options.map(l2 => <option key={l2} value={l2}>{l2}</option>)}
          </select>
          <select
            value={factoryFilter}
            onChange={(e) => setFactoryFilter(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
          >
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
          <span className="ml-auto font-mono-data text-[11px] text-muted-foreground">
            符合 {filteredProducts.length} 件
          </span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[1200px]">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
              <tr className="border-b border-border">
                <th className="w-12 px-4 py-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={handleSelectAll}
                  />
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    產品
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    描述
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  {readyToPublishMode ? (
                    <button
                      type="button"
                      onClick={() => setSkuSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                      title={skuSortDir === 'asc' ? 'SKU 升序（A→Z，1→9）' : 'SKU 降序（Z→A，9→1）'}
                      className="inline-flex items-center gap-1 font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                    >
                      產品編碼 (SKU)
                      {skuSortDir === 'asc' ? (
                        <ArrowUp className="h-3 w-3 text-primary" />
                      ) : (
                        <ArrowDown className="h-3 w-3 text-primary" />
                      )}
                    </button>
                  ) : (
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      產品編碼 (SKU)
                    </span>
                  )}
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    成本
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    售價 <span className="text-emerald-500/70 normal-case">(→ Master)</span>
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    產品尺寸（長 / 闊 / 高 mm）
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    產品標籤
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    變體
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    送貨資訊
                  </span>
                </th>
                <th className="w-16 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.map((product, i) => (
                <ProductTableRow
                  key={product.id}
                  product={product}
                  isSelected={selectedIds.has(product.id)}
                  globalIndex={currentPage * PAGE_SIZE + i}
                  editingCell={editingCell?.id === product.id ? editingCell : null}
                  editValue={editingCell?.id === product.id ? editValue : ''}
                  onCheckboxClick={handleCheckboxClick}
                  onRowClick={handleRowClick}
                  onStartEditing={startEditing}
                  onEditValueChange={setEditValue}
                  onSaveEdit={saveEdit}
                  onUpdateProduct={onUpdateProduct}
                  onUpdateRtsTags={onUpdateRtsTags}
                  onRetryPublish={onRetryPublish}
                  onDeleteProduct={onDeleteProduct}
                  onOpenVariantModal={handleOpenVariantModal}
                />
              ))}
            </tbody>
          </table>

          {filteredProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20">
              {activeTab === 'shopify' ? (
                <>
                  <Database className="mb-3 h-8 w-8 text-muted-foreground/40" />
                  <p className="font-display text-sm text-muted-foreground">尚未備份 Shopify 產品</p>
                  <p className="mt-1 text-xs text-muted-foreground/70 font-body">
                    點擊「從 Shopify 備份」建立目錄的安全副本
                  </p>
                </>
              ) : activeTab === 'local' ? (
                <>
                  <Sparkles className="mb-3 h-8 w-8 text-muted-foreground/40" />
                  <p className="font-display text-sm text-muted-foreground">暫無本地 AI 草稿</p>
                  <p className="mt-1 text-xs text-muted-foreground/70 font-body">
                    透過 AI 處理器處理產品以建立新草稿
                  </p>
                </>
              ) : (
                <p className="font-display text-sm text-muted-foreground">找不到產品</p>
              )}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-6 py-3 bg-muted/20">
              <span className="font-mono-data text-[11px] text-muted-foreground">
                第 {currentPage + 1} / {totalPages} 頁 · 共 {filteredProducts.length} 個產品
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                  className="h-7 px-3 text-xs font-mono-data"
                >
                  上一頁
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                  className="h-7 px-3 text-xs font-mono-data"
                >
                  下一頁
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Variant Modal */}
        <Dialog open={!!variantModal} onOpenChange={() => { setVariantModal(null); setShowProductPicker(false); setPickerSearch(''); setPickerFactoryFilter(''); setPickerPage(0); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <div className="flex items-start justify-between pr-6">
                <div>
                  <DialogTitle className="font-display">
                    變體 — {variantModal?.product.title}
                  </DialogTitle>
                  <DialogDescription className="font-body text-xs">
                    管理每個變體的 ID、SKU、售價、尺寸、Option1 和庫存
                  </DialogDescription>
                </div>
                <Button
                  size="sm"
                  className="shrink-0 gap-1.5 font-display text-xs"
                  onClick={async () => {
                    if (!variantModal) return;
                    // productId is the FK to products.id used for ready_to_shopify queries.
                    // product.id is ready_to_shopify.id (rts row UUID).
                    const hostProductId = variantModal.product.productId || variantModal.product.id;
                    const hostRtsId = variantModal.product.id;
                    const variants = variantModal.product.variants;

                    // rts ids of products CURRENTLY merged into this host (excluding host itself)
                    const currentMergedRtsIds = variants
                      .filter(v => v.id !== hostRtsId)
                      .map(v => v.id);

                    const shopifyVariants = variants.map(v => ({
                      id: v.id,
                      sku: v.sku,
                      price: v.price,
                      title: v.option1 || v.size || '',
                      option1: v.option1 || v.size || '',
                      option2: null,
                      option3: null,
                      compare_at_price: null,
                      inventory_quantity: v.inventory ?? 0,
                    }));

                    // Read the host's PREVIOUSLY-stored variants so we can detect which
                    // sub-products were removed this session and must be restored.
                    const { data: existingRow } = await supabase
                      .from('ready_to_shopify')
                      .select('variants')
                      .eq('product_id', hostProductId)
                      .maybeSingle();
                    const prevMergedRtsIds: string[] = Array.isArray(existingRow?.variants)
                      ? (existingRow!.variants as any[])
                          .map(v => String(v.id))
                          .filter(id => id && id !== hostRtsId)
                      : [];

                    // 1. Save variants to the host product's ready_to_shopify row
                    const { error } = await supabase
                      .from('ready_to_shopify')
                      .update({ variants: shopifyVariants })
                      .eq('product_id', hostProductId);
                    if (error) {
                      toast.error('儲存失敗', { description: error.message });
                      return;
                    }

                    // 2. Hide currently-merged sub-products from 準備上載 WITHOUT deleting
                    //    them — set furniture_group_checked=null so the row (and all its
                    //    data) survives. They can be restored by un-merging.
                    if (currentMergedRtsIds.length > 0) {
                      await supabase
                        .from('ready_to_shopify')
                        .update({ furniture_group_checked: null })
                        .in('id', currentMergedRtsIds);
                      currentMergedRtsIds.forEach(id => onUpdateProduct(id, { readyToPublish: false } as any));
                    }

                    // 3. Restore sub-products that were merged before but removed now —
                    //    bring them back as standalone products in 準備上載.
                    const restoredRtsIds = prevMergedRtsIds.filter(id => !currentMergedRtsIds.includes(id));
                    if (restoredRtsIds.length > 0) {
                      await supabase
                        .from('ready_to_shopify')
                        .update({ furniture_group_checked: true, variants: [] })
                        .in('id', restoredRtsIds);
                    }

                    const descParts: string[] = [`已儲存 ${variants.length} 個變體`];
                    if (currentMergedRtsIds.length > 0) descParts.push(`${currentMergedRtsIds.length} 件已合併`);
                    if (restoredRtsIds.length > 0) descParts.push(`${restoredRtsIds.length} 件已還原為單獨產品`);
                    toast.success('變體已儲存', { description: descParts.join('，') });
                    setVariantModal(null);
                    setShowProductPicker(false);
                    setPickerSearch('');
                    setPickerFactoryFilter('');
                    setPickerPage(0);
                    // Trigger parent to reload 準備上載 list so changes reflect
                    onVariantsSaved?.();
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  完成
                </Button>
              </div>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              {variantModal?.product.variants.map((v, idx) => (
                <VariantRow
                  key={v.id}
                  variant={v}
                  isHost={idx === 0}
                  onUpdate={(updates) => {
                    if (!variantModal) return;
                    const updatedVariants = variantModal.product.variants.map(
                      existing => existing.id === v.id ? { ...existing, ...updates } : existing
                    );
                    onUpdateProduct(variantModal.product.id, { variants: updatedVariants });
                    setVariantModal({ product: { ...variantModal.product, variants: updatedVariants } });
                  }}
                  onDelete={() => {
                    if (!variantModal) return;
                    const updatedVariants = variantModal.product.variants.filter(existing => existing.id !== v.id);
                    onUpdateProduct(variantModal.product.id, { variants: updatedVariants });
                    setVariantModal({ product: { ...variantModal.product, variants: updatedVariants } });
                  }}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowProductPicker(true); setPickerSearch(''); setPickerFactoryFilter(''); setPickerPage(0); }}
                className="gap-1.5 text-xs font-body"
              >
                <Plus className="h-3 w-3" />
                加入產品
              </Button>
            </div>

            {/* Inline Product Picker */}
            {showProductPicker && variantModal && (() => {
              const addedVariantIds = new Set(variantModal.product.variants.map(v => v.id));
              const otherProducts = products.filter(p => p.id !== variantModal.product.id && !addedVariantIds.has(p.id));
              const allFactories = [...new Set(otherProducts.map(p => p.factoryName || p.factoriesDisplayName || '').filter(Boolean))];
              const filtered = otherProducts.filter(p => {
                const matchSearch = !pickerSearch.trim() || p.title.toLowerCase().includes(pickerSearch.toLowerCase());
                const matchFactory = !pickerFactoryFilter || (p.factoryName || p.factoriesDisplayName || '') === pickerFactoryFilter;
                return matchSearch && matchFactory;
              });
              const totalPickerPages = Math.ceil(filtered.length / PICKER_PAGE_SIZE);
              const paginated = filtered.slice(pickerPage * PICKER_PAGE_SIZE, (pickerPage + 1) * PICKER_PAGE_SIZE);
              return (
                <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm font-semibold">選擇產品</span>
                    <button type="button" onClick={() => setShowProductPicker(false)} className="rounded p-1 hover:bg-accent text-muted-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                      <Input
                        value={pickerSearch}
                        onChange={e => { setPickerSearch(e.target.value); setPickerPage(0); }}
                        placeholder="搜尋產品名稱..."
                        className="pl-8 h-8 text-xs font-body"
                      />
                    </div>
                    <select
                      value={pickerFactoryFilter}
                      onChange={e => { setPickerFactoryFilter(e.target.value); setPickerPage(0); }}
                      className="rounded-md border border-border bg-background px-2 py-1 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 h-8"
                    >
                      <option value="">所有廠家</option>
                      {allFactories.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {paginated.length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted-foreground font-body">找不到產品</div>
                    ) : paginated.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          const dims = [p.dimensionLMm, p.dimensionWMm, p.dimensionHMm].filter(Boolean).join('x') || '';
                          const existingSkus = new Set(products.flatMap(prod => prod.variants.map(v => v.sku)));
                          let sku = p.sku || '';
                          if (!sku) {
                            let candidate = '';
                            do {
                              candidate = `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                            } while (existingSkus.has(candidate));
                            sku = candidate;
                          }
                          const newVariant: ProductVariant = {
                            id: p.id,
                            productId: p.productId,
                            size: dims,
                            color: p.color || '',
                            sku,
                            price: p.salePrice ?? NaN,
                            inventory: 100,
                            option1: dims,
                          };
                          const updatedVariants = [...variantModal.product.variants, newVariant];
                          onUpdateProduct(variantModal.product.id, { variants: updatedVariants });
                          setVariantModal({ product: { ...variantModal.product, variants: updatedVariants } });
                          setShowProductPicker(false);
                        }}
                        className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent transition-colors"
                      >
                        <div className="h-8 w-8 shrink-0 rounded overflow-hidden border border-border bg-muted/30">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Package className="h-3 w-3 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-body text-xs font-medium truncate">{p.title}</div>
                          <div className="font-mono-data text-[10px] text-muted-foreground">{p.factoryName || p.factoriesDisplayName || '—'} · {p.category || '—'}</div>
                        </div>
                        <div className="font-mono-data text-xs text-foreground shrink-0">
                          {p.salePrice != null ? `$${p.salePrice.toLocaleString()}` : p.price ? `$${p.price.toLocaleString()}` : '—'}
                        </div>
                      </button>
                    ))}
                  </div>
                  {totalPickerPages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <button type="button" disabled={pickerPage === 0} onClick={() => setPickerPage(p => Math.max(0, p - 1))} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-body hover:bg-accent disabled:opacity-40">
                        <ChevronLeft className="h-3 w-3" />上一頁
                      </button>
                      <span className="font-mono-data text-xs text-muted-foreground">{pickerPage + 1} / {totalPickerPages}</span>
                      <button type="button" disabled={pickerPage >= totalPickerPages - 1} onClick={() => setPickerPage(p => Math.min(totalPickerPages - 1, p + 1))} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-body hover:bg-accent disabled:opacity-40">
                        下一頁<ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Revert Reason Dialog */}
        <Dialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display">退回原因（可選）</DialogTitle>
              <DialogDescription className="font-body text-xs">
                選擇退回原因，可多選。退回後產品將移至「產品文案」頁面並顯示退回原因標籤。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              {REVERT_OPTIONS.map(opt => (
                <label key={opt} className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={revertReasons.includes(opt)}
                    onChange={e => {
                      setRevertReasons(prev =>
                        e.target.checked ? [...prev, opt] : prev.filter(r => r !== opt)
                      );
                    }}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="font-body text-sm text-foreground group-hover:text-primary transition-colors">{opt}</span>
                </label>
              ))}
              {revertReasons.includes('其他') && (
                <textarea
                  value={revertOther}
                  onChange={e => setRevertOther(e.target.value.slice(0, 200))}
                  placeholder="請輸入其他原因（最多約 100 個中文字）"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                />
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" className="font-display text-xs" onClick={() => setShowRevertDialog(false)}>
                取消
              </Button>
              <Button
                size="sm"
                className="font-display text-xs bg-amber-500 hover:bg-amber-600 text-white"
                onClick={async () => {
                  setShowRevertDialog(false);
                  await onRevertToInfo?.(Array.from(selectedIds), { labels: revertReasons, other: revertOther.trim() });
                }}
              >
                確認退回 ({selectedIds.size})
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Batch Delete Confirmation Modal */}
        <AlertDialog open={showBatchDeleteModal} onOpenChange={setShowBatchDeleteModal}>
          <AlertDialogContent className="max-w-md border-destructive/20">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-lg">
                確定要刪除產品嗎？
              </AlertDialogTitle>
              <AlertDialogDescription className="font-body text-sm leading-relaxed">
                你總共選擇了{' '}
                <span className="font-mono-data font-bold text-destructive">{selectedIds.size}</span>{' '}
                個產品。刪除後，若需重新加入，必須重新上傳 PDF 或圖片。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="font-display text-sm font-bold">
                否
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleBatchDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-display text-sm font-bold"
              >
                是
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Product Detail Modal.
            準備上載 (readyToPublishMode) reuses the 傢俬組檢查 card-style modal so
            both pages share the exact same layout + fields. detailProduct.id is the
            ready_to_shopify row id (see reloadReadyToPublish), which FGProductDetailModal
            expects as rtsId. Other modes keep the legacy ProductDetailModal. */}
        {detailProduct && readyToPublishMode && (
          <FGProductDetailModal
            rtsId={detailProduct.id}
            onClose={() => setDetailProduct(null)}
            onSaved={() => { setDetailProduct(null); onVariantsSaved?.(); }}
          />
        )}
        {detailProduct && !readyToPublishMode && (
          <ProductDetailModal
            product={{
              id: detailProduct.id,
              title: detailProduct.title,
              description: detailProduct.description,
              descriptionHtml: detailProduct.descriptionHtml,
              tags: detailProduct.tags,
              price: detailProduct.price,
              compareAtPrice: detailProduct.compareAtPrice,
              collection: detailProduct.collection,
              status: detailProduct.status,
              imageUrl: detailProduct.imageUrl,
              images: (detailProduct as any).images,
              shopifyProductId: detailProduct.shopifyProductId || null,
              source: detailProduct.source,
              syncedAt: detailProduct.syncedAt,
              createdAt: detailProduct.createdAt,
              color: detailProduct.color,
              factoryId: detailProduct.factoryId,
              factoriesDisplayName: detailProduct.factoriesDisplayName,
              costPrice: detailProduct.costPrice,
              productionLeadTime: detailProduct.productionLeadTime,
              shippingDays: detailProduct.shippingDays,
              shippingFee: detailProduct.shippingFee,
              totalLeadTime: (detailProduct as any).totalLeadTime,
              bwfMasterId: detailProduct.bwfMasterId,
              remarks: detailProduct.remarks,
              category: detailProduct.category,
              level1Category: (detailProduct as any).level1Category || detailProduct.collection || null,
              level2Category: (detailProduct as any).level2Category || null,
              deliveryTermId: detailProduct.deliveryTermId,
              deliveryTermName: detailProduct.deliveryTermName,
              inStock: (detailProduct as any).inStock ?? null,
              customize: (detailProduct as any).customize ?? null,
              dimensionLMm: detailProduct.dimensionLMm,
              dimensionWMm: detailProduct.dimensionWMm,
              dimensionHMm: detailProduct.dimensionHMm,
            }}
            open={!!detailProduct}
            onClose={() => setDetailProduct(null)}
            onProductUpdated={(updated) => {
              handleProductUpdatedFromModal(updated);
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
});

function VariantRow({
  variant,
  isHost,
  onUpdate,
  onDelete,
}: {
  variant: ProductVariant;
  isHost?: boolean;
  onUpdate: (updates: Partial<ProductVariant>) => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn('rounded-lg border p-3', isHost ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30')}>
      {isHost && (
        <div className="mb-2 flex items-center gap-1.5">
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-body text-[10px] font-semibold text-primary">主產品</span>
          <span className="font-body text-[10px] text-muted-foreground">此為上傳到 Shopify 的主體產品</span>
        </div>
      )}
      <div className="grid grid-cols-6 gap-2">
        <div className="space-y-1">
          <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
            ID
          </label>
          <Input
            value={variant.id}
            onChange={e => onUpdate({ id: e.target.value })}
            className="h-7 text-xs font-mono-data bg-background"
          />
        </div>
        <div className="space-y-1">
          <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
            SKU
          </label>
          <Input
            value={variant.sku}
            onChange={e => onUpdate({ sku: e.target.value })}
            className="h-7 text-xs font-mono-data bg-background"
          />
        </div>
        <div className="space-y-1">
          <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
            售價
          </label>
          <Input
            type="number"
            step="0.01"
            value={variant.price}
            onChange={e => onUpdate({ price: parseFloat(e.target.value) || 0 })}
            className="h-7 text-xs font-mono-data bg-background"
          />
        </div>
        <div className="space-y-1">
          <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
            尺寸
          </label>
          <Input
            value={variant.size}
            onChange={e => onUpdate({ size: e.target.value })}
            className="h-7 text-xs font-mono-data bg-background"
          />
        </div>
        <div className="space-y-1">
          <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
            Option1
          </label>
          <Input
            value={variant.option1 ?? ''}
            onChange={e => onUpdate({ option1: e.target.value })}
            className="h-7 text-xs font-mono-data bg-background"
          />
        </div>
        <div className="space-y-1">
          <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
            庫存
          </label>
          <Input
            type="number"
            value={variant.inventory}
            onChange={e => onUpdate({ inventory: parseInt(e.target.value) || 0 })}
            className="h-7 text-xs font-mono-data bg-background"
          />
        </div>
      </div>
      {!isHost && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-body text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
            移除
          </button>
        </div>
      )}
    </div>
  );
}

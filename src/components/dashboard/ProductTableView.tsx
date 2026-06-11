import { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import { cn } from '@/lib/utils';
import { Product, ProductVariant } from '@/types/product';
import { StatusBadge } from './StatusBadge';
import { TagSelector } from './TagSelector';
import { ColorSelector } from './ColorSelector';
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
import {
  RotateCcw,
  X,
  Plus,
  ChevronDown,
  ChevronLeft,
  Filter,
  Trash2,
  ExternalLink,
  Loader2,
  Database,
  Sparkles,
  Factory,
  Package,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

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

      {/* Price (產品價錢) */}
      <td className="px-4 py-3">
        {isEditingThis && editingCell!.field === 'price' ? (
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
            onClick={() => onStartEditing(product.id, 'price', product.price.toString())}
            className="font-mono-data text-sm font-bold"
          >
            ${product.price.toFixed(2)}
          </button>
        )}
      </td>

      {/* SKU (產品編碼) */}
      <td className="px-4 py-3">
        {isEditingThis && editingCell!.field === 'sku' ? (
          <Input
            autoFocus
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            onBlur={onSaveEdit}
            className="h-8 w-32 font-mono-data text-xs bg-background"
          />
        ) : (
          <button
            onClick={() => onStartEditing(product.id, 'sku', product.sku || '')}
            className="font-mono-data text-xs"
          >
            {product.sku ? product.sku : <span className="text-muted-foreground/50">—</span>}
          </button>
        )}
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
          onChange={(tags) => onUpdateProduct(product.id, { tags })}
          compact
          maxVisible={3}
        />
      </td>

      {/* Material (材質描述) */}
      <td className="max-w-[160px] px-4 py-3">
        <div className="text-left">
          <span className={cn(
            'text-xs text-muted-foreground font-body',
            'line-clamp-2'
          )}>
            {product.material || '—'}
          </span>
        </div>
      </td>

      {/* Variants */}
      <td className="px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenVariantModal(product)}
          className="h-7 gap-1 text-[10px] font-mono-data"
        >
          {product.variants.length} 個變體
          <ChevronDown className="h-3 w-3" />
        </Button>
      </td>

      {/* Factory / Manufacturer */}
      <td className="px-4 py-3">
        {product.factoriesDisplayName ? (
          <Badge className="gap-1 bg-violet-500/10 text-violet-400 border border-violet-500/20 font-mono-data text-[10px] max-w-[120px] truncate">
            <Factory className="h-2.5 w-2.5 flex-shrink-0" />
            <span className="truncate">{product.factoriesDisplayName}</span>
          </Badge>
        ) : (
          <span className="font-mono-data text-[10px] text-muted-foreground/50">—</span>
        )}
      </td>

      {/* Factory ID */}
      <td className="px-4 py-3">
        {product.factoryId ? (
          <Badge className="gap-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono-data text-[10px] max-w-[100px] truncate">
            <span className="truncate">{product.factoryId}</span>
          </Badge>
        ) : (
          <span className="font-mono-data text-[10px] text-muted-foreground/50">—</span>
        )}
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

      {/* Production Days */}
      <td className="px-4 py-3">
        {isEditingThis && editingCell!.field === 'productionLeadTime' ? (
          <Input
            autoFocus
            type="number"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            onBlur={onSaveEdit}
            className="h-8 w-20 font-mono-data text-xs bg-background"
          />
        ) : (
          <button
            onClick={() => onStartEditing(product.id, 'productionLeadTime', (product.productionLeadTime ?? '').toString())}
            className="font-mono-data text-xs"
          >
            {product.productionLeadTime != null ? `${product.productionLeadTime} 天` : <span className="text-muted-foreground/50">—</span>}
          </button>
        )}
      </td>

      {/* Shipping Days */}
      <td className="px-4 py-3">
        {isEditingThis && editingCell!.field === 'shippingDays' ? (
          <Input
            autoFocus
            type="number"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            onBlur={onSaveEdit}
            className="h-8 w-20 font-mono-data text-xs bg-background"
          />
        ) : (
          <button
            onClick={() => onStartEditing(product.id, 'shippingDays', (product.shippingDays ?? '').toString())}
            className="font-mono-data text-xs"
          >
            {product.shippingDays != null ? `${product.shippingDays} 天` : <span className="text-muted-foreground/50">—</span>}
          </button>
        )}
      </td>

      {/* Total Lead Time (auto-computed: productionLeadTime + shippingDays) */}
      <td className="px-4 py-3">
        {(() => {
          const prod = product.productionLeadTime;
          const ship = product.shippingDays;
          if (prod != null && ship != null) {
            return (
              <span className="font-mono-data text-xs font-bold text-primary">
                {prod + ship} 天
              </span>
            );
          } else if (prod != null || ship != null) {
            return (
              <Tooltip>
                <TooltipTrigger>
                  <span className="font-mono-data text-xs text-amber-500">
                    {(prod ?? 0) + (ship ?? 0)} 天
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-mono-data text-[11px]">
                    {prod == null ? '缺少生產天數' : '缺少船期天數'}，顯示部分合計
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          }
          return <span className="font-mono-data text-[10px] text-muted-foreground/50">—</span>;
        })()}
      </td>

      {/* Shipping Fee */}
      <td className="px-4 py-3">
        {isEditingThis && editingCell!.field === 'shippingFee' ? (
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
            onClick={() => onStartEditing(product.id, 'shippingFee', (product.shippingFee ?? '').toString())}
            className="font-mono-data text-xs"
          >
            {product.shippingFee != null ? `$${product.shippingFee.toFixed(2)}` : <span className="text-muted-foreground/50">—</span>}
          </button>
        )}
      </td>

      {/* Remarks */}
      <td className="max-w-[150px] px-4 py-3">
        {isEditingThis && editingCell!.field === 'remarks' ? (
          <div className="space-y-1">
            <Input
              autoFocus
              value={editValue}
              onChange={e => onEditValueChange(e.target.value)}
              onBlur={onSaveEdit}
              className="h-8 font-body text-xs bg-background"
            />
          </div>
        ) : (
          <button
            onClick={() => onStartEditing(product.id, 'remarks', product.remarks || '')}
            className="text-left"
          >
            {product.remarks ? (
              <span className="font-body text-xs text-muted-foreground line-clamp-1">{product.remarks}</span>
            ) : (
              <span className="font-mono-data text-[10px] text-muted-foreground/50">—</span>
            )}
          </button>
        )}
      </td>

      {/* Color */}
      <td className="px-4 py-3">
        <ColorSelector
          value={product.color || ''}
          onChange={(val) => onUpdateProduct(product.id, { color: val || null })}
          compact
        />
      </td>

      {/* Source */}
      <td className="px-4 py-3">
        {product.source === 'shopify' ? (
          <Badge className="gap-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-mono-data text-[10px]">
            <Database className="h-2.5 w-2.5" />
            Shopify
          </Badge>
        ) : (
          <Badge className="gap-1 bg-primary/10 text-primary border border-primary/20 font-mono-data text-[10px]">
            <Sparkles className="h-2.5 w-2.5" />
            本地
          </Badge>
        )}
      </td>

      {/* Category */}
      <td className="px-4 py-3">
        {product.category ? (
          <Badge variant="outline" className="font-mono-data text-[10px] border-indigo-500/30 text-indigo-400 bg-indigo-500/5">
            {product.category}
          </Badge>
        ) : (
          <span className="text-muted-foreground/40 font-mono-data text-[10px]">未分類</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={product.status} />
          {product.status === 'error' && !product.shopifyProductId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onRetryPublish(product.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-rose-500 transition-colors hover:bg-rose-500/10"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                <p className="font-mono-data text-[11px]">
                  {product.errorMessage || '未知錯誤。點擊重試。'}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </td>

      {/* Shopify Link */}
      <td className="px-4 py-3">
        {product.shopifyProductId ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                className="gap-1 cursor-pointer bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20 font-mono-data text-[10px]"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                {product.shopifyProductId.slice(-8)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-mono-data text-[11px]">
                Shopify 產品 ID: {product.shopifyProductId}
              </p>
            </TooltipContent>
          </Tooltip>
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
  onRetryPublish: (id: string) => void;
  onDeleteProduct: (id: string) => void;
  onClearFilter: () => void;
  onSyncFromShopify?: () => Promise<any>;
  onUploadUnsyncedToMaster?: () => Promise<any>;
  onRevertToInfo?: (ids: string[]) => Promise<void>;
  isSyncing?: boolean;
  isPublishing?: boolean;
  lastSyncTime?: string | null;
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
  onRetryPublish,
  onDeleteProduct,
  onClearFilter,
  onSyncFromShopify,
  onUploadUnsyncedToMaster,
  onRevertToInfo,
  isSyncing,
  isPublishing,
  lastSyncTime,
}: ProductTableViewProps) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  // expandedDesc removed — description now opens modal on click
  const [variantModal, setVariantModal] = useState<{ product: Product } | null>(null);
  const [activeTab, setActiveTab] = useState<TableTab>('local');
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 25;

  // Shift-click range selection state
  const lastSelectedIndexRef = useRef<number | null>(null);

  const handleBatchDelete = useCallback(() => {
    const count = selectedIds.size;
    selectedIds.forEach(id => {
      onDeleteProduct(id);
    });
    setShowBatchDeleteModal(false);
    toast.success(`已成功刪除 ${count} 個產品`);
  }, [selectedIds, onDeleteProduct]);

  const baseProducts = useMemo(() =>
    filterProductId
      ? products.filter(p => p.id === filterProductId)
      : products,
    [products, filterProductId]
  );

  // Separate local AI drafts from synced Shopify products
  const localProducts = useMemo(() => baseProducts.filter(p => p.source === 'local' || !p.source), [baseProducts]);
  const shopifyProducts = useMemo(() => baseProducts.filter(p => p.source === 'shopify'), [baseProducts]);
  
  const filteredProducts = useMemo(() =>
    activeTab === 'all'
      ? baseProducts
      : activeTab === 'shopify'
        ? shopifyProducts
        : localProducts,
    [activeTab, baseProducts, shopifyProducts, localProducts]
  );

  const allFilteredIds = useMemo(() => filteredProducts.map(p => p.id), [filteredProducts]);
  const allSelected = useMemo(
    () => allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id)),
    [allFilteredIds, selectedIds]
  );

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const paginatedProducts = useMemo(
    () => filteredProducts.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [filteredProducts, currentPage]
  );

  // Reset page when tab or filter changes
  useEffect(() => {
    setCurrentPage(0);
  }, [activeTab, filterProductId]);

  // Handle checkbox click with shift-click range selection support
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const filteredProductsRef = useRef(filteredProducts);
  filteredProductsRef.current = filteredProducts;

  const handleCheckboxClick = useCallback((e: React.MouseEvent, productId: string, index: number) => {
    if (e.shiftKey && lastSelectedIndexRef.current !== null) {
      // Range selection
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end = Math.max(lastSelectedIndexRef.current, index);
      const rangeIds = filteredProductsRef.current.slice(start, end + 1).map(p => p.id);
      // Determine whether to select or deselect based on whether the anchor was being selected
      const anchorId = filteredProductsRef.current[lastSelectedIndexRef.current]?.id;
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
    setVariantModal({ product });
  }, []);

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
            {/* Revert to 產品信息 Button */}
            {onRevertToInfo && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (selectedIds.size === 0) {
                    toast.info('請先勾選要退回的產品');
                    return;
                  }
                  await onRevertToInfo(Array.from(selectedIds));
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

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[2350px]">
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
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    產品價錢
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    產品編碼 (SKU)
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    送貨資訊
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
                    材質描述
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    變體
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    廠家
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Factory ID
                  </span>
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
                    生產天數
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    船期
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    預計總貨期
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    運費
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    備註
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    顏色
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    來源
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    類目
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    狀態
                  </span>
                </th>
                <th className="px-4 py-3 text-left">
                  <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Shopify
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
        <Dialog open={!!variantModal} onOpenChange={() => setVariantModal(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display">
                變體 — {variantModal?.product.title}
              </DialogTitle>
              <DialogDescription className="font-body text-xs">
                管理每個變體的尺寸、顏色和庫存
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              {variantModal?.product.variants.map((v) => (
                <VariantRow
                  key={v.id}
                  variant={v}
                  onUpdate={(updates) => {
                    if (!variantModal) return;
                    const updatedVariants = variantModal.product.variants.map(
                      existing => existing.id === v.id ? { ...existing, ...updates } : existing
                    );
                    onUpdateProduct(variantModal.product.id, { variants: updatedVariants });
                    setVariantModal({ product: { ...variantModal.product, variants: updatedVariants } });
                  }}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!variantModal) return;
                  const newVariant: ProductVariant = {
                    id: Math.random().toString(36).substring(7),
                    size: '',
                    color: '',
                    sku: `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
                    price: variantModal.product.price,
                    inventory: 0,
                  };
                  const updatedVariants = [...variantModal.product.variants, newVariant];
                  onUpdateProduct(variantModal.product.id, { variants: updatedVariants });
                  setVariantModal({ product: { ...variantModal.product, variants: updatedVariants } });
                }}
                className="gap-1.5 text-xs font-body"
              >
                <Plus className="h-3 w-3" />
                新增變體
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

        {/* Product Detail Modal */}
        {detailProduct && (
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
              deliveryTermId: detailProduct.deliveryTermId,
              deliveryTermName: detailProduct.deliveryTermName,
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
  onUpdate,
}: {
  variant: ProductVariant;
  onUpdate: (updates: Partial<ProductVariant>) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2 rounded-lg border border-border bg-muted/30 p-3">
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
          顏色
        </label>
        <Input
          value={variant.color}
          onChange={e => onUpdate({ color: e.target.value })}
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
          價格
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
  );
}

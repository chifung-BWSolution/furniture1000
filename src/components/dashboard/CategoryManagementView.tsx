import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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

import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Loader2,
  Package,
  Tag,
  Search,
  X,
  FolderOpen,
  Folder,
  RefreshCw,
  Save,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { CascadingCategorySelector } from './CascadingCategorySelector';
import { ProductDetailModal } from './ProductDetailModal';

// --- Types ---

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  level: number;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
  isExpanded: boolean;
  productCount?: number;
}

interface ProductItem {
  id: string;
  title: string;
  image_url: string | null;
  category: string | null;
  status: string;
  price: number;
  factories_display_name: string | null;
  description?: string | null;
  description_html?: string | null;
  tags?: string[];
  collection?: string | null;
  shopify_product_id?: string | null;
  source?: string | null;
  synced_at?: string | null;
  created_at?: string | null;
  color?: string | null;
  factory_id?: string | null;
  cost_price?: number | null;
  production_date?: number | null;
  shipping_days?: number | null;
  shipping_fee?: number | null;
  total_lead_time?: number | null;
  bwf_master_id?: string | null;
  remarks?: string | null;
  images?: { src: string; alt?: string; path?: string }[] | null;
  dimension_l_mm?: number | null;
  dimension_w_mm?: number | null;
  dimension_h_mm?: number | null;
  sale_price?: number | null;
}

// --- Helper to invoke edge function ---

const FUNCTION_SLUG = 'supabase-functions-manage-categories';

async function invokeCategories(body: Record<string, unknown>) {
  console.log(`[Categories] Invoking ${FUNCTION_SLUG} with action: ${body.action}`);
  const { data, error } = await supabase.functions.invoke(FUNCTION_SLUG, {
    body,
  });
  if (error) {
    console.error(`[Categories] Edge function error:`, error);
    throw new Error(error.message || 'Edge function error');
  }
  if (data?.error) {
    console.error(`[Categories] API returned error:`, data.error);
    throw new Error(data.error);
  }
  console.log(`[Categories] Success for action "${body.action}":`, data);
  return data;
}

// --- Build tree from flat list ---

function buildTree(categories: Category[], expandedIds: Set<string>): CategoryTreeNode[] {
  const map = new Map<string, CategoryTreeNode>();
  const roots: CategoryTreeNode[] = [];

  // Create all nodes
  for (const cat of categories) {
    map.set(cat.id, {
      ...cat,
      children: [],
      isExpanded: expandedIds.has(cat.id),
    });
  }

  // Build hierarchy
  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children.push(node);
    } else if (!cat.parent_id) {
      roots.push(node);
    }
  }

  // Sort children
  const sortNodes = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => a.sort_order - b.sort_order);
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);

  return roots;
}

// --- Component ---

export function CategoryManagementView() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Add/Edit dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryParent, setNewCategoryParent] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Delete
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Product assignment
  const [selectedCategory, setSelectedCategory] = useState<CategoryTreeNode | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);

  // Uncategorized products
  const [showUncategorized, setShowUncategorized] = useState(false);

  // Selected products for bulk assign
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [showBulkAssignDialog, setShowBulkAssignDialog] = useState(false);
  const [bulkAssignCategory, setBulkAssignCategory] = useState<string>('');

  // Product detail modal
  const [detailProduct, setDetailProduct] = useState<ProductItem | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Product counts per category
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [categorizedCount, setCategorizedCount] = useState(0);

  // --- Fetch product counts ---
  const fetchProductCounts = useCallback(async () => {
    try {
      const result = await invokeCategories({ action: 'product_counts' });
      setProductCounts(result.counts || {});
      setUncategorizedCount(result.uncategorized || 0);
      setCategorizedCount(result.categorized || 0);
    } catch (err: any) {
      console.error('Failed to fetch product counts:', err);
    }
  }, []);

  // --- Fetch categories ---
  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await invokeCategories({ action: 'list' });
      setCategories(result.categories || []);
    } catch (err: any) {
      toast.error('無法載入類目', { description: err.message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
    fetchProductCounts();
  }, [fetchCategories, fetchProductCounts]);

  // --- Tree ---
  const tree = useMemo(
    () => buildTree(categories, expandedIds),
    [categories, expandedIds]
  );

  const level1Categories = useMemo(
    () => categories.filter((c) => c.level === 1).sort((a, b) => a.sort_order - b.sort_order),
    [categories]
  );

  // --- Toggle expand ---
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- Expand all ---
  const expandAll = useCallback(() => {
    setExpandedIds(new Set(categories.filter((c) => c.level === 1).map((c) => c.id)));
  }, [categories]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  // --- Add category ---
  const handleOpenAdd = useCallback((parentId: string | null = null) => {
    setEditingCategory(null);
    setNewCategoryName('');
    setNewCategoryParent(parentId);
    setShowAddDialog(true);
  }, []);

  // --- Edit category ---
  const handleOpenEdit = useCallback((cat: Category) => {
    setEditingCategory(cat);
    setNewCategoryName(cat.name);
    setNewCategoryParent(cat.parent_id);
    setShowAddDialog(true);
  }, []);

  // --- Save category (add/edit) ---
  const handleSaveCategory = useCallback(async () => {
    if (!newCategoryName.trim()) {
      toast.error('請輸入類目名稱');
      return;
    }

    setIsSaving(true);
    try {
      if (editingCategory) {
        await invokeCategories({
          action: 'update',
          id: editingCategory.id,
          name: newCategoryName.trim(),
        });
        toast.success('類目已更新');
      } else {
        const level = newCategoryParent ? 2 : 1;
        await invokeCategories({
          action: 'create',
          name: newCategoryName.trim(),
          parent_id: newCategoryParent,
          level,
        });
        toast.success('類目已新增');
      }
      setShowAddDialog(false);
      fetchCategories();
    } catch (err: any) {
      toast.error('儲存失敗', { description: err.message });
    } finally {
      setIsSaving(false);
    }
  }, [editingCategory, newCategoryName, newCategoryParent, fetchCategories]);

  // --- Delete category ---
  const handleDelete = useCallback(async () => {
    if (!deletingCategory) return;
    setIsDeleting(true);
    try {
      await invokeCategories({ action: 'delete', id: deletingCategory.id });
      toast.success(`已刪除「${deletingCategory.name}」`);
      setDeletingCategory(null);
      fetchCategories();
      if (selectedCategory?.id === deletingCategory.id) {
        setSelectedCategory(null);
        setProducts([]);
      }
    } catch (err: any) {
      toast.error('刪除失敗', { description: err.message });
    } finally {
      setIsDeleting(false);
    }
  }, [deletingCategory, fetchCategories, selectedCategory]);

  // --- Move up/down ---
  const handleMove = useCallback(
    async (cat: Category, direction: 'up' | 'down') => {
      // Find siblings
      const siblings = categories
        .filter((c) => c.parent_id === cat.parent_id && c.level === cat.level)
        .sort((a, b) => a.sort_order - b.sort_order);

      const idx = siblings.findIndex((s) => s.id === cat.id);
      if (direction === 'up' && idx <= 0) return;
      if (direction === 'down' && idx >= siblings.length - 1) return;

      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      const items = [
        { id: siblings[idx].id, sort_order: siblings[swapIdx].sort_order },
        { id: siblings[swapIdx].id, sort_order: siblings[idx].sort_order },
      ];

      try {
        await invokeCategories({ action: 'reorder', items });
        fetchCategories();
      } catch (err: any) {
        toast.error('排序失敗', { description: err.message });
      }
    },
    [categories, fetchCategories]
  );

  // --- Fetch products for a category ---
  const fetchProducts = useCallback(
    async (categoryName: string | null, page = 1) => {
      setIsLoadingProducts(true);
      try {
        const result = await invokeCategories({
          action: 'list_products_by_category',
          category_name: categoryName,
          page,
          page_size: 50,
        });
        setProducts(result.products || []);
        setProductTotal(result.total || 0);
        setProductPage(page);
      } catch (err: any) {
        toast.error('無法載入產品列表', { description: err.message });
      } finally {
        setIsLoadingProducts(false);
      }
    },
    []
  );

  // --- Select category to view products ---
  const handleSelectCategory = useCallback(
    (node: CategoryTreeNode) => {
      setSelectedCategory(node);
      setShowUncategorized(false);
      setSelectedProductIds(new Set());
      fetchProducts(node.name, 1);
    },
    [fetchProducts]
  );

  const handleShowUncategorized = useCallback(() => {
    setSelectedCategory(null);
    setShowUncategorized(true);
    setSelectedProductIds(new Set());
    fetchProducts('__uncategorized__', 1);
  }, [fetchProducts]);

  // --- Assign single product ---
  const handleAssignProduct = useCallback(
    async (productId: string, categoryName: string) => {
      try {
        const actualCategory = categoryName === '__clear__' ? '' : categoryName;
        await invokeCategories({
          action: 'assign_product',
          product_id: productId,
          category_name: actualCategory,
        });
        toast.success(actualCategory ? '已分配類目' : '已清除分類');
        // Refresh products list
        if (showUncategorized) {
          fetchProducts('__uncategorized__', productPage);
        } else if (selectedCategory) {
          fetchProducts(selectedCategory.name, productPage);
        }
        fetchProductCounts();
      } catch (err: any) {
        toast.error('分配失敗', { description: err.message });
      }
    },
    [fetchProducts, fetchProductCounts, productPage, selectedCategory, showUncategorized]
  );

  // --- Bulk assign ---
  const handleBulkAssign = useCallback(async () => {
    if (!bulkAssignCategory || selectedProductIds.size === 0) return;
    try {
      await invokeCategories({
        action: 'bulk_assign',
        product_ids: Array.from(selectedProductIds),
        category_name: bulkAssignCategory,
      });
      toast.success(`已將 ${selectedProductIds.size} 個產品分配至「${bulkAssignCategory}」`);
      setShowBulkAssignDialog(false);
      setSelectedProductIds(new Set());
      setBulkAssignCategory('');
      // Refresh
      if (showUncategorized) {
        fetchProducts('__uncategorized__', productPage);
      } else if (selectedCategory) {
        fetchProducts(selectedCategory.name, productPage);
      }
      fetchProductCounts();
    } catch (err: any) {
      toast.error('批量分配失敗', { description: err.message });
    }
  }, [
    bulkAssignCategory,
    selectedProductIds,
    fetchProducts,
    fetchProductCounts,
    productPage,
    selectedCategory,
    showUncategorized,
  ]);

  // --- Open product detail modal ---
  const handleOpenProductDetail = useCallback((product: ProductItem) => {
    setDetailProduct(product);
    setShowDetailModal(true);
  }, []);

  // --- Handle product updated from detail modal ---
  const handleProductUpdated = useCallback((updatedProduct: any) => {
    // Update the product in the local list
    setProducts((prev) =>
      prev.map((p) =>
        p.id === updatedProduct.id
          ? {
              ...p,
              title: updatedProduct.title,
              image_url: updatedProduct.imageUrl || p.image_url,
              category: updatedProduct.category || updatedProduct.collection || p.category,
              price: updatedProduct.price ?? p.price,
            }
          : p
      )
    );
  }, []);

  // --- Render tree node ---
  const renderTreeNode = (node: CategoryTreeNode, depth: number = 0) => {
    const hasChildren = node.children.length > 0;
    const isSelected = selectedCategory?.id === node.id;

    return (
      <div key={node.id}>
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer transition-all duration-150',
            'hover:bg-accent/50',
            isSelected && 'bg-primary/10 ring-1 ring-primary/20'
          )}
          style={{ paddingLeft: `${depth * 24 + 8}px` }}
          onClick={() => handleSelectCategory(node)}
        >
          {/* Expand toggle */}
          <button
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
              hasChildren ? 'hover:bg-accent' : 'invisible'
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(node.id);
            }}
          >
            {hasChildren &&
              (node.isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              ))}
          </button>

          {/* Icon */}
          {node.level === 1 ? (
            node.isExpanded ? (
              <FolderOpen className="h-4 w-4 text-primary shrink-0" />
            ) : (
              <Folder className="h-4 w-4 text-primary/70 shrink-0" />
            )
          ) : (
            <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}

          {/* Name */}
          <span
            className={cn(
              'flex-1 truncate text-sm',
              node.level === 1 ? 'font-semibold' : 'font-normal text-muted-foreground'
            )}
          >
            {node.name}
          </span>

          {/* Product count badge */}
          {(() => {
            let count = 0;
            if (node.level === 1) {
              // Sum products in this category + all its subcategories
              count = productCounts[node.name] || 0;
              for (const child of node.children) {
                count += productCounts[child.name] || 0;
              }
            } else {
              count = productCounts[node.name] || 0;
            }
            return count > 0 ? (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono-data">
                {count}
              </Badge>
            ) : null;
          })()}

          {/* Actions (show on hover) */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.level === 1 && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenAdd(node.id);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">新增子類目</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenEdit(node);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">編輯</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMove(node, 'up');
                    }}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">上移</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMove(node, 'down');
                    }}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">下移</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingCategory(node);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">刪除</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </motion.div>

        {/* Children */}
        <AnimatePresence>
          {node.isExpanded && hasChildren && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  // --- Product list toggle selection ---
  const toggleProductSelect = useCallback((id: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllProducts = useCallback(() => {
    if (selectedProductIds.size === products.length) {
      setSelectedProductIds(new Set());
    } else {
      setSelectedProductIds(new Set(products.map((p) => p.id)));
    }
  }, [selectedProductIds, products]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: Category tree */}
      <div className="flex w-[340px] shrink-0 flex-col border-r bg-card/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderTree className="h-4.5 w-4.5 text-primary" />
            <h2 className="font-display text-sm font-bold tracking-tight">產品分類管理</h2>
          </div>
          <div className="flex items-center gap-1">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => { fetchCategories(); fetchProductCounts(); }}
                    disabled={isLoading}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>重新載入</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1 text-xs"
              onClick={() => handleOpenAdd(null)}
            >
              <Plus className="h-3 w-3" />
              新增一級類目
            </Button>
          </div>
        </div>

        {/* Expand / Collapse all */}
        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={expandAll}
          >
            全部展開
          </button>
          <span className="text-xs text-muted-foreground">·</span>
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={collapseAll}
          >
            全部收合
          </button>
          <div className="flex-1" />
          <Badge variant="outline" className="text-[10px] font-mono-data">
            已分類 {categorizedCount} · 未分類 {uncategorizedCount}
          </Badge>
        </div>

        {/* Tree */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            {isLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded-lg" />
                ))}
              </div>
            ) : tree.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FolderTree className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">尚無類目</p>
                <p className="text-xs text-muted-foreground/60 mt-1">點擊上方「新增一級類目」開始</p>
              </div>
            ) : (
              tree.map((node) => renderTreeNode(node, 0))
            )}
          </div>
        </ScrollArea>

        {/* Uncategorized link */}
        <div className="border-t px-4 py-2">
          <button
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
              'hover:bg-accent/50',
              showUncategorized && 'bg-amber-500/10 ring-1 ring-amber-500/20 text-amber-600'
            )}
            onClick={handleShowUncategorized}
          >
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="font-medium">未分類產品</span>
            {uncategorizedCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono-data bg-amber-500/10 text-amber-600">
                {uncategorizedCount}
              </Badge>
            )}
          </button>
        </div>
      </div>

      {/* Right panel: Product list */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-3">
            {selectedCategory ? (
              <>
                <Package className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-bold">
                  {selectedCategory.name}
                </h3>
                <Badge variant="secondary" className="font-mono-data text-xs">
                  {productTotal} 個產品
                </Badge>
              </>
            ) : showUncategorized ? (
              <>
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <h3 className="font-display text-sm font-bold">未分類產品</h3>
                <Badge variant="secondary" className="font-mono-data text-xs bg-amber-500/10 text-amber-600">
                  {productTotal} 個產品
                </Badge>
              </>
            ) : (
              <>
                <FolderTree className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm text-muted-foreground">
                  請從左側選擇一個類目查看產品
                </h3>
              </>
            )}
          </div>

          {selectedProductIds.size > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="default" className="font-mono-data">
                已選 {selectedProductIds.size}
              </Badge>
              <Button
                size="sm"
                variant="default"
                className="h-7 gap-1 text-xs"
                onClick={() => setShowBulkAssignDialog(true)}
              >
                <Tag className="h-3 w-3" />
                批量分類
              </Button>
            </div>
          )}
        </div>

        {/* Products */}
        <ScrollArea className="flex-1">
          {!selectedCategory && !showUncategorized ? (
            <div className="flex h-full items-center justify-center p-12">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/5">
                  <FolderTree className="h-8 w-8 text-primary/40" />
                </div>
                <p className="text-sm text-muted-foreground">
                  從左側類目樹選擇一個分類，<br />
                  或點擊「未分類產品」查看需要分類的產品
                </p>
              </div>
            </div>
          ) : isLoadingProducts ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Package className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">此類目下暫無產品</p>
            </div>
          ) : (
            <div className="divide-y">
              {/* Select all row */}
              <div className="flex items-center gap-3 px-6 py-2 bg-muted/30 sticky top-0 z-10">
                <Checkbox
                  checked={selectedProductIds.size === products.length && products.length > 0}
                  onCheckedChange={toggleAllProducts}
                />
                <span className="text-xs text-muted-foreground font-medium">全選</span>
              </div>

              {products.map((product) => (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-accent/30 transition-colors cursor-pointer"
                  onClick={() => handleOpenProductDetail(product)}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedProductIds.has(product.id)}
                      onCheckedChange={() => toggleProductSelect(product.id)}
                    />
                  </div>

                  {/* Image */}
                  <div className="h-10 w-10 shrink-0 rounded-md bg-muted overflow-hidden">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Package className="h-4 w-4 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{product.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {product.factories_display_name && (
                        <span className="text-[11px] text-muted-foreground font-mono-data">
                          {product.factories_display_name}
                        </span>
                      )}
                      {product.category && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                          {product.category}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Price */}
                  {product.price > 0 && (
                    <span className="text-sm font-mono-data text-muted-foreground">
                      ${product.price.toFixed(2)}
                    </span>
                  )}

                  {/* Assign category select - cascading */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <CascadingCategorySelector
                      categories={categories}
                      value={product.category || ''}
                      onValueChange={(val) => handleAssignProduct(product.id, val)}
                      placeholder="選擇類目"
                      showClear={true}
                      triggerClassName="w-[160px] h-8"
                      submenuSide="left"
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Pagination */}
        {productTotal > 50 && (
          <div className="flex items-center justify-center gap-2 border-t px-4 py-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={productPage <= 1}
              onClick={() =>
                fetchProducts(
                  showUncategorized ? '__uncategorized__' : selectedCategory?.name || null,
                  productPage - 1
                )
              }
            >
              上一頁
            </Button>
            <span className="text-xs text-muted-foreground font-mono-data">
              第 {productPage} / {Math.ceil(productTotal / 50)} 頁
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={productPage >= Math.ceil(productTotal / 50)}
              onClick={() =>
                fetchProducts(
                  showUncategorized ? '__uncategorized__' : selectedCategory?.name || null,
                  productPage + 1
                )
              }
            >
              下一頁
            </Button>
          </div>
        )}
      </div>

      {/* Add / Edit Category Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editingCategory ? '編輯類目' : newCategoryParent ? '新增二級類目' : '新增一級類目'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {newCategoryParent && !editingCategory && (
              <div className="text-xs text-muted-foreground">
                父類目：
                <Badge variant="outline" className="ml-1">
                  {categories.find((c) => c.id === newCategoryParent)?.name}
                </Badge>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                類目名稱
              </label>
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="輸入類目名稱"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCategory();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              取消
            </Button>
            <Button onClick={handleSaveCategory} disabled={isSaving}>
              {isSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {editingCategory ? '儲存' : '新增'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingCategory}
        onOpenChange={(open) => {
          if (!open) setDeletingCategory(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除類目？</AlertDialogTitle>
            <AlertDialogDescription>
              確定要刪除「{deletingCategory?.name}」嗎？
              {deletingCategory?.level === 1 && (
                <span className="block mt-1 text-destructive font-medium">
                  ⚠️ 此操作會一併刪除所有子類目，且無法還原。
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              確定刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Assign Dialog */}
      <Dialog open={showBulkAssignDialog} onOpenChange={setShowBulkAssignDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-display">批量分配類目</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              將 {selectedProductIds.size} 個產品分配至：
            </p>
            <CascadingCategorySelector
              categories={categories}
              value={bulkAssignCategory}
              onValueChange={setBulkAssignCategory}
              placeholder="選擇目標類目"
              showClear={false}
              triggerClassName="w-full h-9"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkAssignDialog(false)}>
              取消
            </Button>
            <Button onClick={handleBulkAssign} disabled={!bulkAssignCategory}>
              確定分配
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Detail Modal */}
      {detailProduct && (
        <ProductDetailModal
          product={{
            id: detailProduct.id,
            title: detailProduct.title,
            description: detailProduct.description || detailProduct.description_html || '',
            descriptionHtml: detailProduct.description_html || detailProduct.description || '',
            tags: detailProduct.tags || [],
            price: detailProduct.sale_price ?? detailProduct.price ?? 0,
            collection: detailProduct.collection || detailProduct.category || '',
            status: detailProduct.status || 'draft',
            imageUrl: detailProduct.image_url || '',
            images: detailProduct.images || undefined,
            shopifyProductId: detailProduct.shopify_product_id || null,
            source: detailProduct.source || 'manual',
            syncedAt: detailProduct.synced_at || null,
            createdAt: detailProduct.created_at || new Date().toISOString(),
            color: detailProduct.color || null,
            factoryId: detailProduct.factory_id || null,
            factoriesDisplayName: detailProduct.factories_display_name || null,
            costPrice: detailProduct.cost_price ?? null,
            productionLeadTime: detailProduct.production_date ?? null,
            shippingDays: detailProduct.shipping_days ?? null,
            shippingFee: detailProduct.shipping_fee ?? null,
            totalLeadTime: detailProduct.total_lead_time ?? null,
            bwfMasterId: detailProduct.bwf_master_id || null,
            remarks: detailProduct.remarks || null,
            category: detailProduct.category || null,
            dimensionLMm: detailProduct.dimension_l_mm ?? null,
            dimensionWMm: detailProduct.dimension_w_mm ?? null,
            dimensionHMm: detailProduct.dimension_h_mm ?? null,
          }}
          open={showDetailModal}
          onClose={() => {
            setShowDetailModal(false);
            setDetailProduct(null);
          }}
          onProductUpdated={handleProductUpdated}
        />
      )}
    </div>
  );
}

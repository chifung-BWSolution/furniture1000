import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ProductVariant } from '@/types/product';
import { StatusBadge } from './StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Ban,
  Calculator,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  CloudDownload,
  Database,
  ExternalLink,
  Factory,
  FolderTree,
  LayoutGrid,
  List,
  Loader2,
  Search,
  Send,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { removeFromCatalog, addToCatalog, addToShopifyQueue, dismissProducts } from '@/lib/catalogStore';
import { toast } from 'sonner';
import { getChineseColorLabel, getColorHex, multiColorToChineseDisplay } from '@/constants/color-map';
import { ProductDetailModal } from './ProductDetailModal';

type SortField = 'created_at' | 'title' | 'product_sku';
type SortOrder = 'asc' | 'desc';
type PageSize = 20 | 50 | 100 | 200 | 500;

interface ListedProduct {
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
  images?: { id?: number; src: string; alt?: string }[];
  shopifyProductId: string | null;
  source: string;
  syncedAt?: string | null;
  createdAt: string;
  variants: ProductVariant[];
  // New fields
  color?: string | null;
  factoryId?: string | null;
  factoriesDisplayName?: string | null;
  costPrice?: number | null;
  salePrice?: number | null;
  productionLeadTime?: number | null;
  shippingDays?: number | null;
  shippingFee?: number | null;
  totalLeadTime?: number | null;
  bwfMasterId?: string | null;
  remarks?: string | null;
  category?: string | null;
  level1Category?: string | null;
  level2Category?: string | null;
  productionTime?: string | null;
  material?: string | null;
  model?: string | null;
  specifications?: string | null;
  deliveryTermId?: string | null;
  deliveryTermName?: string | null;
  inStock?: boolean | null;
  customize?: string | null;
  dimensionLMm?: number | null;
  dimensionWMm?: number | null;
  dimensionHMm?: number | null;
  productSku?: string | null;
  isOnShopify?: boolean;
}

interface ListedProductsViewProps {
  onSyncFromShopify?: () => Promise<any>;
  isSyncing?: boolean;
  lastSyncTime?: string | null;
  onSendToPublishQueue?: (products: any[]) => void;
  /** Report total + selected counts (and selected IDs) up to the TopBar */
  onStatsChange?: (stats: { total: number; selected: number; selectedIds: string[] }) => void;
  /** 'catalog' = 產品目錄頁（僅顯示已加入目錄的產品）; undefined = 所有產品頁 */
  mode?: 'all' | 'catalog';
}

export function ListedProductsView({
  onSyncFromShopify,
  isSyncing,
  lastSyncTime,
  onSendToPublishQueue,
  onStatsChange,
  mode = 'all',
}: ListedProductsViewProps) {
  const isCatalog = mode === 'catalog';
  const [products, setProducts] = useState<ListedProduct[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [variantModal, setVariantModal] = useState<{ product: ListedProduct } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBatchRejectConfirm, setShowBatchRejectConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBatchRejecting, setIsBatchRejecting] = useState(false);
  const [showPricingDialog, setShowPricingDialog] = useState(false);
  const [pricingMultiplier, setPricingMultiplier] = useState('');
  const [isApplyingPricing, setIsApplyingPricing] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [detailProduct, setDetailProduct] = useState<ListedProduct | null>(null);
  const [shopifyFilter, setShopifyFilter] = useState<'all' | 'shopify' | 'database'>('all');
  const [factoryFilterOpen, setFactoryFilterOpen] = useState(false);
  const [selectedFactories, setSelectedFactories] = useState<string[]>([]);
  const [availableFactories, setAvailableFactories] = useState<string[]>([]);
  // 重複商品篩選：只顯示 product_sku 重複或為空的產品
  const [showDuplicates, setShowDuplicates] = useState(false);
  // Set of duplicate product_sku values (fetched when showDuplicates is toggled on)
  const [duplicateSkus, setDuplicateSkus] = useState<Set<string> | null>(null);
  // 一級/二級分類篩選（讀 product_category 表）
  const [level1Filter, setLevel1Filter] = useState<string>('');
  const [level2Filter, setLevel2Filter] = useState<string>('');
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);
  // Category product counts: { 'level1:工作臺': 42, 'level2:辦公桌': 12, ... }
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const level1Options = useMemo(
    () => Array.from(new Set(categoryPairs.map((p) => p.level1))),
    [categoryPairs]
  );
  const level2Options = useMemo(
    () => Array.from(new Set(categoryPairs.filter((p) => p.level1 === level1Filter && p.level2).map((p) => p.level2))),
    [categoryPairs, level1Filter]
  );
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const factoryDropdownRef = useRef<HTMLDivElement>(null);

  // Report total + selected counts up to the TopBar
  useEffect(() => {
    onStatsChange?.({ total: totalCount, selected: selectedIds.size, selectedIds: Array.from(selectedIds) });
  }, [totalCount, selectedIds, onStatsChange]);


  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1); // reset to page 1 on search change
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // Fetch 一級/二級分類選項 from product_category（用於分類篩選下拉）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('product_category')
        .select('level1, level2, sort_order')
        .order('sort_order', { ascending: true });
      if (!cancelled && data) {
        setCategoryPairs(
          data
            .map((r: { level1: string | null; level2: string | null }) => ({
              level1: String(r.level1 ?? '').trim(),
              level2: String(r.level2 ?? '').trim(),
            }))
            .filter((p) => p.level1)
        );
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch category product counts — paginated to bypass Supabase's 1000-row server cap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const BATCH = 1000;

      const applyVisibility = (q: any) => isCatalog
        ? q.eq('in_catalog', true)
        : q.or('in_shopify_queue.is.null,in_shopify_queue.eq.false')
            .or('info_done.is.null,info_done.eq.false')
            .or('ready_to_publish.is.null,ready_to_publish.eq.false')
            .or('copy_done.is.null,copy_done.eq.false')
            .is('copy_done_at', null)
            .is('copy_queued_at', null);

      // Paginated fetch helper
      const fetchAllPages = async (columns: string, extraFilter: (q: any) => any) => {
        const rows: any[] = [];
        let page = 0;
        while (true) {
          const { data } = await applyVisibility(
            extraFilter(
              supabase.from('products').select(columns)
            )
          ).range(page * BATCH, (page + 1) * BATCH - 1);
          if (!data || data.length === 0) break;
          rows.push(...data);
          if (data.length < BATCH) break;
          page++;
        }
        return rows;
      };

      const [l1Rows, l2Rows] = await Promise.all([
        fetchAllPages('level1_category', (q) =>
          q.not('level1_category', 'is', null).neq('level1_category', '')
        ),
        fetchAllPages('level1_category,level2_category', (q) =>
          q.not('level2_category', 'is', null).neq('level2_category', '')
        ),
      ]);

      if (cancelled) return;

      const counts: Record<string, number> = {};
      for (const row of l1Rows) {
        const l1 = (row.level1_category || '').trim();
        if (!l1) continue;
        counts[`level1:${l1}`] = (counts[`level1:${l1}`] || 0) + 1;
      }
      for (const row of l2Rows) {
        const l1 = (row.level1_category || '').trim();
        const l2 = (row.level2_category || '').trim();
        if (!l1 || !l2) continue;
        counts[`level2:${l1}:${l2}`] = (counts[`level2:${l1}:${l2}`] || 0) + 1;
      }
      if (!cancelled) setCategoryCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [isCatalog]);

  // Fetch unique factory names for filter — DEFERRED: only runs the first time
  // the user opens the factory dropdown, so it never competes with the
  // first-screen product query (previously scanned all 1464 rows on mount).
  const factoriesLoadedRef = useRef(false);
  useEffect(() => {
    if (!factoryFilterOpen || factoriesLoadedRef.current) return;
    factoriesLoadedRef.current = true;

    const fetchFactories = async () => {
      let allFactoryNames: string[] = [];
      let page = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data } = await supabase
          .from('products')
          .select('factories_display_name')
          .not('factories_display_name', 'is', null)
          .neq('factories_display_name', '')
          .range(page * batchSize, (page + 1) * batchSize - 1);

        if (data && data.length > 0) {
          allFactoryNames = allFactoryNames.concat(
            data.map((r: any) => r.factories_display_name as string).filter(Boolean)
          );
          if (data.length < batchSize) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      const unique = Array.from(new Set(allFactoryNames));
      unique.sort((a, b) => a.localeCompare(b, 'zh'));
      setAvailableFactories(unique);
    };
    fetchFactories();
  }, [factoryFilterOpen]);

  // Close factory dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (factoryDropdownRef.current && !factoryDropdownRef.current.contains(e.target as Node)) {
        setFactoryFilterOpen(false);
      }
    };
    if (factoryFilterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [factoryFilterOpen]);

  // Fetch duplicate product_sku values when the 重複商品 filter is turned on
  useEffect(() => {
    if (!showDuplicates) { setDuplicateSkus(null); return; }
    let cancelled = false;
    (async () => {
      // Find all product_sku values that appear more than once (within the same catalog mode)
      let q = supabase
        .from('products')
        .select('product_sku')
        .not('product_sku', 'is', null)
        .neq('product_sku', '');
      if (isCatalog) {
        q = q.eq('in_catalog', true);
      } else {
        q = q.or('in_shopify_queue.is.null,in_shopify_queue.eq.false')
             .or('info_done.is.null,info_done.eq.false')
             .or('ready_to_publish.is.null,ready_to_publish.eq.false')
             .or('copy_done.is.null,copy_done.eq.false')
             .is('copy_done_at', null)
             .is('copy_queued_at', null);
      }
      const { data } = await q;
      if (cancelled || !data) return;
      // Count occurrences
      const counts: Record<string, number> = {};
      for (const row of data) {
        const sku = row.product_sku as string;
        counts[sku] = (counts[sku] || 0) + 1;
      }
      const dups = new Set(Object.entries(counts).filter(([, n]) => n > 1).map(([sku]) => sku));
      setDuplicateSkus(dups);
      setCurrentPage(1);
    })();
    return () => { cancelled = true; };
  }, [showDuplicates, isCatalog]);

  // Fetch products from Supabase — ALL products, sorted by created_at DESC by default
  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      // Always use 'exact' count — 'estimated' uses planner stats and is inaccurate
      // when filters are applied (e.g. level2_category), giving wrong totals.
      let countQuery = supabase
        .from('products')
        .select('id', { count: 'exact', head: true });

      if (debouncedSearch.trim()) {
        countQuery = countQuery.ilike('title', `%${debouncedSearch.trim()}%`);
      }

      // Apply shopify filter to count query
      if (shopifyFilter === 'shopify') {
        countQuery = countQuery.not('shopify_product_id', 'is', null).neq('shopify_product_id', '');
      } else if (shopifyFilter === 'database') {
        countQuery = countQuery.or('shopify_product_id.is.null,shopify_product_id.eq.');
      }

      // Apply factory filter to count query
      if (selectedFactories.length > 0) {
        countQuery = countQuery.in('factories_display_name', selectedFactories);
      }

      // Apply category filters to count query
      if (level1Filter) countQuery = countQuery.eq('level1_category', level1Filter);
      if (level2Filter) countQuery = countQuery.eq('level2_category', level2Filter);

      // 產品目錄頁：只計算已加入目錄的產品
      if (isCatalog) {
        countQuery = countQuery.eq('in_catalog', true);
      } else {
        countQuery = countQuery
          .or('in_shopify_queue.eq.true,info_done.eq.true,ready_to_publish.eq.true,copy_done.eq.true')
          .is('copy_queued_at', null);
      }

      // 重複商品篩選：product_sku 為空，或屬於重複的 sku 集合
      if (showDuplicates && duplicateSkus !== null) {
        const dupArr = Array.from(duplicateSkus);
        if (dupArr.length > 0) {
          countQuery = countQuery.or(`product_sku.is.null,product_sku.eq.,product_sku.in.(${dupArr.map(s => `"${s}"`).join(',')})`);
        } else {
          countQuery = countQuery.or('product_sku.is.null,product_sku.eq.');
        }
      }

      // Build data query — explicit columns (avoid heavy JSONB like description_html when not needed for list view)
      const LIST_COLUMNS = [
        'id', 'title', 'description', 'tags', 'price', 'compare_at_price',
        'collection', 'status', 'image_url', 'images',
        'shopify_product_id', 'source', 'synced_at', 'created_at',
        'color', 'factory_id', 'factories_display_name',
        'cost_price', 'sale_price', 'production_date', 'shipping_days', 'total_lead_time',
        'bwf_master_id', 'remarks', 'shipping_fee', 'category',
        'level1_category', 'level2_category', 'production_time',
        'material', 'model', 'specifications',
        'delivery_term_id', 'delivery_term_name',
        'dimension_l_mm', 'dimension_w_mm', 'dimension_h_mm',
        'in_stock', 'customize', 'product_sku',
      ].join(',');
      // 重複商品模式且未選擇系列排序：先按 product_sku 聚集，NULL 最後；一般模式或系列排序用使用者選的排序。
      const baseDataQuery = supabase.from('products').select(LIST_COLUMNS);
      let dataQuery = (showDuplicates && sortField !== 'product_sku'
        ? baseDataQuery
            .order('product_sku', { ascending: true, nullsFirst: false })
            .order('title', { ascending: true })
        : baseDataQuery
            .order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false })
      ).range(from, to);

      if (debouncedSearch.trim()) {
        dataQuery = dataQuery.ilike('title', `%${debouncedSearch.trim()}%`);
      }

      // Apply shopify filter to data query
      if (shopifyFilter === 'shopify') {
        dataQuery = dataQuery.not('shopify_product_id', 'is', null).neq('shopify_product_id', '');
      } else if (shopifyFilter === 'database') {
        dataQuery = dataQuery.or('shopify_product_id.is.null,shopify_product_id.eq.');
      }

      // Apply factory filter to data query
      if (selectedFactories.length > 0) {
        dataQuery = dataQuery.in('factories_display_name', selectedFactories);
      }

      // Apply category filters to data query
      if (level1Filter) dataQuery = dataQuery.eq('level1_category', level1Filter);
      if (level2Filter) dataQuery = dataQuery.eq('level2_category', level2Filter);

      // 產品目錄頁：只顯示已加入目錄的產品
      if (isCatalog) {
        dataQuery = dataQuery.eq('in_catalog', true);
      } else {
        dataQuery = dataQuery
          .or('in_shopify_queue.eq.true,info_done.eq.true,ready_to_publish.eq.true,copy_done.eq.true')
          .is('copy_queued_at', null);
      }

      // 重複商品篩選
      if (showDuplicates && duplicateSkus !== null) {
        const dupArr = Array.from(duplicateSkus);
        if (dupArr.length > 0) {
          dataQuery = dataQuery.or(`product_sku.is.null,product_sku.eq.,product_sku.in.(${dupArr.map(s => `"${s}"`).join(',')})`);
        } else {
          dataQuery = dataQuery.or('product_sku.is.null,product_sku.eq.');
        }
      }

      // Run count + data IN PARALLEL — they no longer block each other.
      const [{ count, error: countErr }, { data: productRows, error: prodErr }] =
        await Promise.all([countQuery, dataQuery]);

      if (countErr) {
        console.error('[ProductCatalog] Count error:', countErr);
      }
      setTotalCount(count || 0);

      if (prodErr) {
        console.error('[ProductCatalog] Fetch error:', prodErr);
        setFetchError(prodErr.message || '無法連接到資料庫，請稍後重試');
        setProducts([]);
        setIsLoading(false);
        return;
      }

      if (!productRows || productRows.length === 0) {
        setProducts([]);
        setIsLoading(false);
        return;
      }

      const mapped: ListedProduct[] = productRows.map((row: any) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        descriptionHtml: row.description_html || undefined,
        tags: row.tags || [],
        price: parseFloat(row.price),
        compareAtPrice: row.compare_at_price ? parseFloat(row.compare_at_price) : undefined,
        collection: row.collection,
        status: row.status,
        imageUrl: row.image_url,
        images: row.images || [],
        shopifyProductId: row.shopify_product_id || null,
        source: row.source || 'local',
        syncedAt: row.synced_at || null,
        createdAt: row.created_at,
        // New fields
        color: row.color || null,
        factoryId: row.factory_id || null,
        factoriesDisplayName: row.factories_display_name || null,
        costPrice: row.cost_price != null ? parseFloat(row.cost_price) : null,
        salePrice: row.sale_price != null ? parseFloat(row.sale_price) : null,
        productionLeadTime: row.production_date != null ? parseInt(row.production_date) : null,
        shippingDays: row.shipping_days != null ? parseInt(row.shipping_days) : null,
        totalLeadTime: row.total_lead_time != null ? parseInt(row.total_lead_time) : null,
        bwfMasterId: row.bwf_master_id || null,
        remarks: row.remarks || null,
        shippingFee: row.shipping_fee != null ? parseFloat(row.shipping_fee) : null,
        category: row.category || null,
        level1Category: row.level1_category || null,
        level2Category: row.level2_category || null,
        productionTime: row.production_time || null,
        material: row.material || null,
        model: row.model || null,
        specifications: row.specifications || null,
        deliveryTermId: row.delivery_term_id || null,
        deliveryTermName: row.delivery_term_name || null,
        inStock: row.in_stock != null ? Boolean(row.in_stock) : null,
        customize: row.customize || null,
        dimensionLMm: row.dimension_l_mm != null ? parseInt(row.dimension_l_mm) : null,
        dimensionWMm: row.dimension_w_mm != null ? parseInt(row.dimension_w_mm) : null,
        dimensionHMm: row.dimension_h_mm != null ? parseInt(row.dimension_h_mm) : null,
        productSku: row.product_sku || null,
        // variants 先留空，下方背景非阻塞補上，讓首屏立即顯示
        variants: [],
      }));

      // 立即渲染前 N 件 — 首屏不再等 variants
      setProducts(mapped);
      setIsLoading(false);

      // 背景非阻塞抓取 variants，回來後再 patch 進已渲染的列
      const productIds = productRows.map((p: any) => p.id);
      supabase
        .from('product_variants')
        .select('*')
        .in('product_id', productIds)
        .then(({ data: variantRows }) => {
          if (!variantRows || variantRows.length === 0) return;
          const variantsByProduct: Record<string, any[]> = {};
          variantRows.forEach((v: any) => {
            (variantsByProduct[v.product_id] ||= []).push(v);
          });
          setProducts((prev) =>
            prev.map((p) =>
              variantsByProduct[p.id]
                ? {
                    ...p,
                    variants: variantsByProduct[p.id].map((v: any) => ({
                      id: v.id, size: v.size, color: v.color, sku: v.sku,
                      price: parseFloat(v.price), inventory: v.inventory,
                    })),
                  }
                : p
            )
          );
        });

      // 背景查詢 shopify_products，以 uuid 欄位配對 products.id，標記已上架產品
      supabase
        .from('shopify_products')
        .select('uuid')
        .in('uuid', productIds)
        .then(({ data: shopifyRows }) => {
          if (!shopifyRows || shopifyRows.length === 0) return;
          const onShopifyIds = new Set(shopifyRows.map((r: any) => r.uuid));
          setProducts((prev) =>
            prev.map((p) =>
              onShopifyIds.has(p.id) ? { ...p, isOnShopify: true } : p
            )
          );
        });

      return;
    } catch (err) {
      console.error('[ProductCatalog] Unexpected error:', err);
      setFetchError('連線逾時或發生未預期的錯誤，請檢查資料庫狀態');
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, sortField, sortOrder, debouncedSearch, shopifyFilter, selectedFactories, level1Filter, level2Filter, isCatalog, showDuplicates, duplicateSkus]);

  // Fetch on mount and when deps change
  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Re-fetch after sync with toast notifications
  const handleSync = useCallback(async () => {
    if (!onSyncFromShopify) return;
    
    const toastId = toast.loading('正在從 Shopify 同步產品...', {
      description: '正在從您的 Shopify 商店取得所有產品。',
    });

    try {
      const summary = await onSyncFromShopify();
      await fetchProducts();

      if (summary) {
        const parts: string[] = [];
        if (summary.created > 0) parts.push(`${summary.created} 已建立`);
        if (summary.updated > 0) parts.push(`${summary.updated} 已更新`);
        if (summary.skipped > 0) parts.push(`${summary.skipped} 已略過`);
        if (summary.errors > 0) parts.push(`${summary.errors} 錯誤`);

        const hasErrors = summary.errors > 0;
        
        if (hasErrors) {
          toast.warning('同步完成但有錯誤', {
            id: toastId,
            description: `已處理 ${summary.total_shopify} 個產品：${parts.join('、')}`,
            duration: 8000,
          });
        } else {
          toast.success('同步成功完成', {
            id: toastId,
            description: `已同步 ${summary.total_shopify} 個產品：${parts.join('、')}`,
            duration: 5000,
          });
        }
      } else {
        toast.success('同步完成', {
          id: toastId,
          description: '產品已從 Shopify 重新整理。',
          duration: 4000,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('[ProductCatalog] Sync error details:', err);
      
      // Show full error body in toast for debugging
      let fullDescription = errorMessage;
      if (errorMessage.length > 200) {
        fullDescription = errorMessage.substring(0, 200) + '...';
      }
      
      toast.error('同步失敗', {
        id: toastId,
        description: fullDescription,
        duration: 15000,
      });
    }
  }, [onSyncFromShopify, fetchProducts]);

  // Sync from Master DB — pull products from bwf_product_master that aren't in local DB
  const [isSyncingMaster, setIsSyncingMaster] = useState(false);
  const handleSyncFromMaster = useCallback(async () => {
    setIsSyncingMaster(true);
    const toastId = toast.loading('正在從全域資料庫同步產品...', {
      description: '正在從 bwf_product_master 取得最新產品資料。',
    });

    try {
      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-sync-from-master-db',
        { body: {} }
      );

      if (error) {
        toast.error('全域資料庫同步失敗', {
          id: toastId,
          description: error.message,
        });
        setIsSyncingMaster(false);
        return;
      }

      if (!data?.products || data.products.length === 0) {
        toast.info('全域資料庫無可同步產品', { id: toastId });
        setIsSyncingMaster(false);
        return;
      }

      // Get existing bwf_master_ids to avoid duplicates
      const { data: existingProducts } = await supabase
        .from('products')
        .select('bwf_master_id')
        .not('bwf_master_id', 'is', null);

      const existingMasterIds = new Set(
        (existingProducts || []).map((p: any) => p.bwf_master_id)
      );

      // Filter to only products not yet in local DB
      const newProducts = data.products.filter(
        (mp: any) => !existingMasterIds.has(mp.master_id)
      );

      if (newProducts.length === 0) {
        toast.success('所有全域產品已同步至本地', {
          id: toastId,
          description: `全域資料庫共有 ${data.products.length} 個產品，全部已存在於本地資料庫。`,
        });
        setIsSyncingMaster(false);
        return;
      }

      // Insert new products into local DB
      const localRows = newProducts.map((mp: any) => ({
        id: crypto.randomUUID(),
        title: mp.title || 'Untitled',
        description: mp.description || '',
        description_html: mp.description_html || mp.description || '',
        tags: mp.tags || [],
        price: mp.price ?? 0,
        compare_at_price: mp.compare_at_price ?? null,
        collection: mp.collection || '',
        status: 'draft',
        image_url: mp.image_url || '',
        images: mp.images || [],
        source: 'master-sync',
        factory_id: mp.factory_id || '',
        factories_display_name: mp.factories_display_name || '',
        cost_price: mp.cost_price ?? null,
        production_date: mp.production_date ?? null,
        shipping_days: mp.shipping_days ?? null,
        shipping_fee: mp.shipping_fee ?? null,
        total_lead_time: mp.total_lead_time ?? null,
        remarks: mp.remarks || '',
        color: mp.color || '',
        bwf_master_id: mp.master_id,
        synced_at: new Date().toISOString(),
        created_at: mp.created_at || new Date().toISOString(),
        dimension_l_mm: mp.dimension_l_mm ?? null,
        dimension_w_mm: mp.dimension_w_mm ?? null,
        dimension_h_mm: mp.dimension_h_mm ?? null,
        material: mp.material || '',
        lifestyle_image_url: mp.lifestyle_image_url || null,
        delivery_term_id: mp.delivery_term_id || null,
        delivery_term_name: mp.delivery_term_name || null,
      }));

      const { error: insertErr } = await supabase
        .from('products')
        .upsert(localRows, { onConflict: 'id' });

      if (insertErr) {
        toast.error('同步至本地資料庫失敗', {
          id: toastId,
          description: insertErr.message,
        });
      } else {
        toast.success(`✅ 已同步 ${newProducts.length} 個新產品至本地`, {
          id: toastId,
          description: `從全域資料庫同步了 ${newProducts.length} 個產品，${data.products.length - newProducts.length} 個已存在。`,
        });
        await fetchProducts(); // Refresh the table
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error('同步異常', { id: toastId, description: msg });
    } finally {
      setIsSyncingMaster(false);
    }
  }, [fetchProducts]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  // Compute total lead time display
  const getLeadTimeDisplay = (product: ListedProduct) => {
    if (product.totalLeadTime != null) return `${product.totalLeadTime}天`;
    if (product.productionLeadTime != null && product.shippingDays != null) {
      return `${product.productionLeadTime + product.shippingDays}天`;
    }
    if (product.productionLeadTime != null) return `${product.productionLeadTime}天 (生產)`;
    if (product.shippingDays != null) return `${product.shippingDays}天 (運輸)`;
    return '—';
  };

  // Synced status badge component
  const SyncStatusBadge = ({ product }: { product: ListedProduct }) => {
    if (product.bwfMasterId) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className="gap-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20 font-mono-data text-[9px] cursor-default">
              <Check className="h-2.5 w-2.5" />
              已同步
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              <p className="font-mono-data text-[11px]">已同步至全域資料庫</p>
              <p className="font-mono-data text-[10px] text-muted-foreground">
                Master ID: {product.bwfMasterId.slice(0, 8)}...
              </p>
              {product.syncedAt && (
                <p className="font-mono-data text-[10px] text-muted-foreground">
                  同步時間: {new Date(product.syncedAt).toLocaleString()}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 font-mono-data text-[9px] text-muted-foreground border-dashed">
        未同步
      </Badge>
    );
  };

  // Selection logic
  const toggleSelectProduct = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (products.length === 0) return;
    const currentPageIds = products.map(p => p.id);
    const allCurrentSelected = currentPageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allCurrentSelected) {
        for (const id of currentPageIds) next.delete(id);
      } else {
        for (const id of currentPageIds) next.add(id);
      }
      return next;
    });
  }, [products, selectedIds]);

  const isAllSelected = products.length > 0 && products.every(p => selectedIds.has(p.id));
  const isSomeSelected = products.some(p => selectedIds.has(p.id)) && !isAllSelected;

  // Clear selection when products change (e.g. page change, search)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [currentPage, debouncedSearch, sortField, sortOrder, pageSize, shopifyFilter, selectedFactories, level1Filter, level2Filter, showDuplicates]);

  // Delete selected products — master DB + local DB
  const handleDeleteSelected = useCallback(async () => {
    const idsToDelete = Array.from(selectedIds);
    const productsToDelete = products.filter(p => idsToDelete.includes(p.id));

    if (productsToDelete.length === 0) return;

    // 產品目錄頁：「刪除」只把產品移出目錄（in_catalog=false），不刪除產品本身
    if (isCatalog) {
      setShowDeleteConfirm(false);
      const res = await removeFromCatalog(idsToDelete);
      setSelectedIds(new Set());
      if (res.ok) {
        toast.success(`已從產品目錄移除 ${idsToDelete.length} 件產品`);
        fetchProducts();
      } else {
        toast.error('移除失敗', { description: res.error });
      }
      return;
    }

    setIsDeleting(true);
    setShowDeleteConfirm(false);

    const toastId = toast.loading(`正在刪除 ${productsToDelete.length} 件產品...`, {
      description: '正在從全域資料庫和本地資料庫中移除產品。',
    });

    try {
      // Step 1: Delete from master DB (bwf_product_master) for products that have bwf_master_id
      const masterIds = productsToDelete
        .filter(p => p.bwfMasterId)
        .map(p => p.bwfMasterId as string);

      const masterDeleteErrors: string[] = [];

      if (masterIds.length > 0) {
        try {
          const { data, error } = await supabase.functions.invoke(
            'supabase-functions-delete-from-master-db',
            {
              body: { master_ids: masterIds },
            }
          );

          if (error) {
            console.error('[DeleteProducts] Master DB edge function error:', error);
            masterDeleteErrors.push(`全域資料庫刪除失敗: ${error.message}`);
          } else if (data?.results) {
            const failedMaster = data.results.filter((r: any) => !r.success);
            if (failedMaster.length > 0) {
              failedMaster.forEach((r: any) => {
                masterDeleteErrors.push(`Master ID ${r.master_id.slice(0, 8)}...: ${r.error}`);
              });
            }
            console.log('[DeleteProducts] Master DB delete summary:', data.summary);
          }
        } catch (masterErr) {
          console.error('[DeleteProducts] Master DB delete exception:', masterErr);
          masterDeleteErrors.push(
            `全域資料庫刪除異常: ${masterErr instanceof Error ? masterErr.message : 'Unknown error'}`
          );
        }
      }

      // Step 2: Delete variants from local DB
      const localIds = productsToDelete.map(p => p.id);
      const { error: variantDelErr } = await supabase
        .from('product_variants')
        .delete()
        .in('product_id', localIds);

      if (variantDelErr) {
        console.error('[DeleteProducts] Local variant delete error:', variantDelErr);
      }

      // Step 3: Delete products from local DB
      const { error: productDelErr } = await supabase
        .from('products')
        .delete()
        .in('id', localIds);

      if (productDelErr) {
        console.error('[DeleteProducts] Local product delete error:', productDelErr);
        toast.error('本地資料庫刪除失敗', {
          id: toastId,
          description: productDelErr.message,
          duration: 8000,
        });
        setIsDeleting(false);
        return;
      }

      // Step 4: Update local state — remove deleted products from the table
      setProducts(prev => prev.filter(p => !localIds.includes(p.id)));
      setTotalCount(prev => prev - localIds.length);
      setSelectedIds(new Set());

      // Step 5: Show result toast
      if (masterDeleteErrors.length > 0) {
        toast.warning(`已刪除 ${localIds.length} 件產品（部分全域資料庫刪除失敗）`, {
          id: toastId,
          description: masterDeleteErrors.join('\n'),
          duration: 10000,
        });
      } else {
        toast.success(`已成功刪除 ${localIds.length} 件產品`, {
          id: toastId,
          description: masterIds.length > 0
            ? `已從全域資料庫和本地資料庫中移除 ${localIds.length} 件產品。`
            : `已從本地資料庫移除 ${localIds.length} 件產品。`,
          duration: 5000,
        });
      }

      // Refresh if the current page might be empty now
      if (products.length === localIds.length && currentPage > 1) {
        setCurrentPage(prev => Math.max(1, prev - 1));
      }
    } catch (err) {
      console.error('[DeleteProducts] Unexpected error:', err);
      toast.error('刪除失敗', {
        id: toastId,
        description: err instanceof Error ? err.message : '未知錯誤',
        duration: 8000,
      });
    } finally {
      setIsDeleting(false);
    }
  }, [selectedIds, products, currentPage, isCatalog]);

  // ── Per-row processing actions (所有產品頁) ──
  // Optimistically remove the row from view, then persist the flag.
  const [dismissTarget, setDismissTarget] = useState<ListedProduct | null>(null);

  const dropRowLocally = useCallback((id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setTotalCount((c) => Math.max(0, c - 1));
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  // Upsert one or more products into ready_to_shopify
  const upsertToReadyToShopify = useCallback(async (prods: ListedProduct[]) => {
    const rows = prods.map((p) => ({
      product_id: p.id,
      title: p.title || null,
      body_html: p.description || null,
      vendor: p.factoriesDisplayName || null,
      product_type: [p.level1Category, p.level2Category].filter(Boolean).join(' / ') || p.collection || null,
      image_url: p.imageUrl || null,
      images: Array.isArray(p.images) && p.images.length > 0
        ? p.images.map((img, idx) => ({ src: img.src, position: idx + 1 }))
        : null,
      tags: Array.isArray(p.tags) && p.tags.length > 0 ? p.tags : null,
      price: p.salePrice ?? p.price ?? null,
      // cost = products.cost_price (成本，供產品信息頁參考)
      cost: p.costPrice ?? null,
      status: 'draft',
      imported_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('ready_to_shopify')
      .upsert(rows, { onConflict: 'product_id' });
    if (error) console.error('[ready_to_shopify] upsert error:', error.message);
  }, []);

  const handleRowToShopify = useCallback(async (product: ListedProduct) => {
    dropRowLocally(product.id);
    const [res] = await Promise.all([
      addToShopifyQueue([product.id]),
      upsertToReadyToShopify([product]),
    ]);
    res.ok
      ? toast.success('已加入 Shopify', { description: `${product.title} — 已送往產品文案與產品目錄` })
      : toast.error('操作失敗', { description: res.error });
  }, [dropRowLocally, upsertToReadyToShopify]);

  const handleRowToCatalog = useCallback(async (product: ListedProduct) => {
    dropRowLocally(product.id);
    const res = await addToCatalog([product.id]);
    res.ok
      ? toast.success('已加到產品目錄', { description: product.title })
      : toast.error('操作失敗', { description: res.error });
  }, [dropRowLocally]);

  const confirmDismiss = useCallback(async () => {
    const product = dismissTarget;
    setDismissTarget(null);
    if (!product) return;
    dropRowLocally(product.id);
    const res = await dismissProducts([product.id]);
    res.ok
      ? toast.success('已移除', { description: product.title })
      : toast.error('操作失敗', { description: res.error });
  }, [dismissTarget, dropRowLocally]);

  // 批量「暫不考慮」— save to products_rejected then dismiss
  const handleBatchReject = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const productsToReject = products.filter(p => ids.includes(p.id));
    if (productsToReject.length === 0) return;

    setIsBatchRejecting(true);
    setShowBatchRejectConfirm(false);

    setProducts(prev => prev.filter(p => !selectedIds.has(p.id)));
    setTotalCount(c => Math.max(0, c - ids.length));
    setSelectedIds(new Set());

    const toastId = toast.loading(`正在將 ${productsToReject.length} 件產品標記為「暫不考慮」...`);
    try {
      const rejectedRows = productsToReject.map(p => ({
        original_product_id: p.id,
        title: p.title,
        description: p.description,
        tags: p.tags,
        price: p.price,
        image_url: p.imageUrl,
        factory_id: p.factoryId ?? null,
        factories_display_name: p.factoriesDisplayName ?? null,
        cost_price: p.costPrice ?? null,
        color: p.color ?? null,
        category: p.category ?? null,
        source: p.source,
        shopify_product_id: p.shopifyProductId ?? null,
        bwf_master_id: p.bwfMasterId ?? null,
        rejection_source: 'listed_products',
      }));
      await supabase.from('products_rejected').insert(rejectedRows);
      const res = await dismissProducts(ids);
      if (res.ok) {
        toast.success(`已將 ${ids.length} 件產品標記為「暫不考慮」`, {
          id: toastId, description: '資料已儲存至 products_rejected。', duration: 5000,
        });
      } else {
        toast.error('部分操作失敗', { id: toastId, description: res.error });
      }
    } catch (err) {
      toast.error('操作失敗', { id: toastId, description: err instanceof Error ? err.message : '未知錯誤' });
    } finally {
      setIsBatchRejecting(false);
    }
  }, [selectedIds, products]);

  // 批量定價 — 套用定價倍數並寫入 Supabase sale_price
  const handleApplyPricing = useCallback(async () => {
    const multiplier = parseFloat(pricingMultiplier);
    if (isNaN(multiplier) || multiplier <= 0) {
      toast.error('請輸入有效的倍數，例如 2.3、2.5、2.7');
      return;
    }
    const toUpdate = products.filter(p => p.costPrice != null && p.costPrice > 0);
    if (toUpdate.length === 0) {
      toast.error('當前頁面沒有含成本的產品可計算售價');
      return;
    }
    setIsApplyingPricing(true);
    setShowPricingDialog(false);
    const toastId = toast.loading(`正在為 ${toUpdate.length} 件產品套用定價 ×${multiplier}...`);
    try {
      const updates = toUpdate.map(p => ({
        id: p.id,
        newSalePrice: Math.ceil(p.costPrice! * multiplier),
      }));
      const results = await Promise.all(
        updates.map(u => supabase.from('products').update({ sale_price: u.newSalePrice }).eq('id', u.id))
      );
      const firstErr = results.find(r => r.error)?.error ?? null;
      if (firstErr) {
        toast.error('售價更新失敗', { id: toastId, description: firstErr.message });
        return;
      }
      const updateMap = new Map(updates.map(u => [u.id, u.newSalePrice]));
      setProducts(prev => prev.map(p => updateMap.has(p.id) ? { ...p, salePrice: updateMap.get(p.id)! } : p));
      toast.success(`已為 ${updates.length} 件產品套用售價`, {
        id: toastId,
        description: `定價倍數 ×${multiplier}，售價已同步至 Supabase。`,
        duration: 5000,
      });
      setPricingMultiplier('');
    } catch (err) {
      toast.error('操作失敗', { id: toastId, description: err instanceof Error ? err.message : '未知錯誤' });
    } finally {
      setIsApplyingPricing(false);
    }
  }, [pricingMultiplier, products]);

  // 「待上傳到 Shopify」（批量）— 與單列「A 加入Shopify」一致：
  // 標記 in_shopify_queue=true + in_catalog=true（寫入 Supabase），
  // 產品即出現在「網上發佈 > 產品文案」與「產品目錄」，並從本頁前端消失。
  const [isQueuing, setIsQueuing] = useState(false);
  const handleSendToPublishQueue = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const selectedProducts = products.filter((p) => selectedIds.has(p.id));
    setIsQueuing(true);
    // 前端先樂觀移除選中的列，並清空選取
    setProducts((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    setTotalCount((c) => Math.max(0, c - ids.length));
    setSelectedIds(new Set());
    try {
      const [res] = await Promise.all([
        addToShopifyQueue(ids),
        upsertToReadyToShopify(selectedProducts),
      ]);
      if (res.ok) {
        toast.success(`已將 ${ids.length} 件產品加入 Shopify`, {
          description: '已送往「網上發佈 > 產品文案」與「產品目錄」',
        });
      } else {
        toast.error('操作失敗', { description: res.error });
        fetchProducts(); // 失敗時還原列表
      }
    } finally {
      setIsQueuing(false);
    }
  }, [selectedIds, products, fetchProducts, upsertToReadyToShopify]);

  // Handle product updated from detail modal
  const handleProductUpdated = useCallback((updatedProduct: ListedProduct) => {
    setProducts(prev =>
      prev.map(p => (p.id === updatedProduct.id ? { ...p, ...updatedProduct } : p))
    );
  }, []);

  // Handle row click to open detail modal (ignore checkbox/button clicks)
  const handleRowClick = useCallback((e: React.MouseEvent, product: ListedProduct) => {
    const target = e.target as HTMLElement;
    // Don't open modal if clicking checkbox, button, badge, or interactive elements
    if (
      target.closest('button') ||
      target.closest('[role="checkbox"]') ||
      target.closest('input') ||
      target.closest('a')
    ) {
      return;
    }
    setDetailProduct(product);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-6 py-2.5">
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜尋產品..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-8 w-[220px] pl-8 pr-8 text-xs font-body bg-background"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="h-4 w-px bg-border" />

            {/* Items per page */}
            <Select
              value={pageSize.toString()}
              onValueChange={(val) => {
                setPageSize(parseInt(val) as PageSize);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[130px] text-xs font-body">
                <SelectValue placeholder="Per page" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">每頁 20 項</SelectItem>
                <SelectItem value="50">每頁 50 項</SelectItem>
                <SelectItem value="100">每頁 100 項</SelectItem>
                <SelectItem value="200">每頁 200 項</SelectItem>
                <SelectItem value="500">每頁 500 項</SelectItem>
              </SelectContent>
            </Select>

            <div className="h-4 w-px bg-border" />

            {/* 一級分類 Filter */}
            <Select
              value={level1Filter || '__all__'}
              onValueChange={(val) => {
                setLevel1Filter(val === '__all__' ? '' : val);
                setLevel2Filter(''); // reset 二級 when 一級 changes
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs font-body gap-1">
                <FolderTree className="h-3 w-3 text-muted-foreground" />
                <SelectValue placeholder="一級分類" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部一級分類</SelectItem>
                {level1Options.map((l1) => {
                  // When this option is active and no level2 filter, totalCount is exact.
                  const cnt = (l1 === level1Filter && !level2Filter)
                    ? totalCount
                    : categoryCounts[`level1:${l1}`];
                  return (
                    <SelectItem key={l1} value={l1}>
                      <span className="flex items-center justify-between gap-3 w-full">
                        <span>{l1}</span>
                        {cnt != null && (
                          <span className="font-mono-data text-xs font-semibold text-foreground/70 ml-auto">{cnt}</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            {/* 二級分類 Filter — only when a 一級 is chosen */}
            {level1Filter && level2Options.length > 0 && (
              <Select
                value={level2Filter || '__all__'}
                onValueChange={(val) => {
                  setLevel2Filter(val === '__all__' ? '' : val);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs font-body gap-1">
                  <FolderTree className="h-3 w-3 text-muted-foreground" />
                  <SelectValue placeholder="二級分類" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部二級分類</SelectItem>
                  {level2Options.map((l2) => {
                    // When this option is the active filter, use totalCount (exact from main query).
                    // For other options, fall back to categoryCounts (approximate).
                    const cnt = l2 === level2Filter
                      ? totalCount
                      : categoryCounts[`level2:${level1Filter}:${l2}`];
                    return (
                      <SelectItem key={l2} value={l2}>
                        <span className="flex items-center justify-between gap-3 w-full">
                          <span>{l2}</span>
                          {cnt != null && (
                            <span className="font-mono-data text-xs font-semibold text-foreground/70 ml-auto">{cnt}</span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}

            {/* Count */}
            <Badge variant="secondary" className="font-mono-data text-[10px]">
              {totalCount} 產品
            </Badge>

            <div className="h-4 w-px bg-border" />

            {/* Factory Filter (multi-select) */}
            <div className="relative" ref={factoryDropdownRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFactoryFilterOpen(!factoryFilterOpen)}
                className={cn(
                  "h-8 gap-1.5 text-xs font-body",
                  selectedFactories.length > 0 && "border-indigo-500/50 text-indigo-500"
                )}
              >
                <Factory className="h-3 w-3" />
                {selectedFactories.length > 0
                  ? `廠家 (${selectedFactories.length})`
                  : '篩選廠家'}
                <ChevronDown className="h-3 w-3" />
              </Button>
              {selectedFactories.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFactories([]);
                    setCurrentPage(1);
                  }}
                  className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[9px] hover:bg-indigo-600"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
              {factoryFilterOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 w-[240px] max-h-[300px] overflow-auto rounded-lg border border-border bg-background shadow-lg p-2">
                  {availableFactories.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 px-2">無可用廠家</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between px-2 pb-2 border-b border-border mb-1">
                        <span className="text-[10px] text-muted-foreground font-mono-data">
                          {selectedFactories.length} / {availableFactories.length} 已選
                        </span>
                        <button
                          onClick={() => {
                            setSelectedFactories([]);
                            setCurrentPage(1);
                          }}
                          className="text-[10px] text-indigo-500 hover:underline"
                        >
                          清除全部
                        </button>
                      </div>
                      {availableFactories.map((factory) => (
                        <label
                          key={factory}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedFactories.includes(factory)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedFactories(prev => [...prev, factory]);
                              } else {
                                setSelectedFactories(prev => prev.filter(f => f !== factory));
                              }
                              setCurrentPage(1);
                            }}
                          />
                          <span className="text-xs font-body truncate">{factory}</span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            {/* 重複商品 Filter */}
            <Button
              variant={showDuplicates ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowDuplicates((v) => !v)}
              className={cn(
                'h-8 gap-1.5 text-xs font-body',
                showDuplicates && 'bg-rose-500 hover:bg-rose-600 text-white border-rose-500'
              )}
            >
              重複商品
            </Button>

            {/* Sort order selector */}
            <Select
              value={`${sortField}_${sortOrder}`}
              onValueChange={(v) => {
                const lastUnderscore = v.lastIndexOf('_');
                const field = v.slice(0, lastUnderscore) as SortField;
                const order = v.slice(lastUnderscore + 1) as SortOrder;
                setSortField(field);
                setSortOrder(order);
              }}
            >
              <SelectTrigger className="h-8 w-[190px] text-xs font-body">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="product_sku_asc" className="text-xs font-body">按系列排列（從 A 到 Z）</SelectItem>
                <SelectItem value="product_sku_desc" className="text-xs font-body">按系列排列（從 Z 到 A）</SelectItem>
                <SelectItem value="created_at_desc" className="text-xs font-body">按日期排列（從近到遠）</SelectItem>
                <SelectItem value="created_at_asc" className="text-xs font-body">按日期排列（從遠到近）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <Badge variant="secondary" className="font-mono-data text-xs animate-in fade-in">
                已選 {selectedIds.size} 項
              </Badge>
            )}

            {/* Grid / List toggle */}
            <div className="flex items-center rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors',
                  viewMode === 'grid'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
                title="Grid 格式"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors',
                  viewMode === 'list'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
                title="List 格式"
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>

            {!isCatalog && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSendToPublishQueue}
                disabled={selectedIds.size === 0 || isQueuing}
                className={cn(
                  "gap-2 font-display text-xs font-bold transition-all border-indigo-500/40 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10",
                  selectedIds.size === 0 && "opacity-50"
                )}
              >
                {isQueuing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                待上傳到 Shopify
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowBatchRejectConfirm(true)}
              disabled={selectedIds.size === 0 || isBatchRejecting}
              className={cn(
                "gap-2 font-display text-xs font-bold transition-all border-rose-500/40 text-rose-500 hover:bg-rose-500/10",
                selectedIds.size === 0 && "opacity-50"
              )}
            >
              {isBatchRejecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Ban className="h-3.5 w-3.5" />
              )}
              {isBatchRejecting ? '處理中...' : '暫不考慮'}
              {selectedIds.size > 0 && !isBatchRejecting && (
                <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 px-1 text-[9px]">
                  {selectedIds.size}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {/* Info banner */}
        <AnimatePresence mode="wait">
          {isSyncing ? (
            <motion.div
              key="syncing"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              <span className="text-[11px] text-amber-500 font-body font-medium">
                正在從 Shopify Admin API 取得產品... 大型目錄可能需要較長時間。
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="info"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 border-b border-border bg-indigo-500/5 px-6 py-1.5"
            >
              <Database className="h-3 w-3 text-indigo-500" />
              <span className="text-[11px] text-indigo-500 font-body">
                {isCatalog
                  ? `產品目錄 • 共 ${totalCount.toLocaleString()} 件 — 此處只顯示已加入目錄的產品，所有裝置即時同步`
                  : `已優化載入速度 • 預設顯示前 ${pageSize} 件產品，其餘資料將於滾動或切換分頁時延遲載入`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="px-6 py-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground font-body">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                Lazy Loading 已啟用 • 正在載入前 {pageSize} 件產品...
              </div>
              <div className="space-y-2">
                {Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 rounded-md border border-border/60 bg-card/30 px-4 py-3"
                  >
                    <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                    <div className="h-12 w-12 animate-pulse rounded-md bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                      <div className="h-2.5 w-1/4 animate-pulse rounded bg-muted/70" />
                    </div>
                    <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-14 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-10 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center py-20">
              <AlertTriangle className="mb-3 h-8 w-8 text-rose-400" />
              <p className="font-display text-sm text-rose-400">
                資料庫連線失敗
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70 font-body max-w-md text-center">
                {fetchError}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => fetchProducts()}
              >
                重試
              </Button>
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Database className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="font-display text-sm text-muted-foreground">
                {debouncedSearch ? '找不到符合搜尋的產品' : isCatalog ? '產品目錄是空的' : '產品目錄是空的'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70 font-body">
                {debouncedSearch
                  ? '請嘗試其他搜尋字詞'
                  : isCatalog
                    ? '到「所有產品」勾選產品，按「上傳到產品目錄」即可加入'
                    : '從「上載PDF」新增產品或從 Shopify 同步現有產品'}
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            /* ── GRID VIEW — 一行 2 款，每款左圖右資訊，底部 A/B/C ── */
            <div className="p-4 grid grid-cols-2 gap-4">
              {products.map((product, i) => {
                const imgSrc = product.images?.[0]?.src || product.imageUrl || '';
                const dimStr = [product.dimensionLMm, product.dimensionWMm, product.dimensionHMm]
                  .filter(Boolean).length > 0
                  ? `${product.dimensionLMm ?? '—'} × ${product.dimensionWMm ?? '—'} × ${product.dimensionHMm ?? '—'} mm`
                  : null;
                return (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="relative flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                    onClick={(e) => handleRowClick(e, product)}
                  >
                    {/* 已上架Shopify badge */}
                    {product.isOnShopify && (
                      <div className="absolute top-2 right-2 z-10 rounded px-2 py-0.5 bg-blue-600 text-white font-display text-[11px] font-semibold tracking-wide shadow-sm pointer-events-none">
                        已上架Shopify
                      </div>
                    )}
                    {/* Top: image left + info right */}
                    <div className="flex gap-0">
                      {/* Image — 1:1 square, object-contain to show full product */}
                      <div className="relative flex-shrink-0 w-[40%] aspect-square bg-white dark:bg-muted overflow-hidden border-r border-border">
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt={product.title}
                            loading="lazy"
                            className="absolute inset-0 h-full w-full object-contain p-2"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Store className="h-10 w-10 text-muted-foreground/30" />
                          </div>
                        )}
                        {/* Checkbox */}
                        <div
                          className="absolute top-2 left-2"
                          onClick={(e) => { e.stopPropagation(); toggleSelectProduct(product.id); }}
                        >
                          <Checkbox checked={selectedIds.has(product.id)} className="bg-white/80" />
                        </div>
                      </div>

                      {/* Info — right side, stretched to full image height */}
                      <div className="flex flex-col flex-1 min-w-0 px-3 py-2 justify-between">
                        {/* Title — 18px */}
                        <p className="font-display text-[18px] font-bold leading-snug line-clamp-2">
                          {product.title}
                        </p>

                        {/* Prices + Dimensions — 14px */}
                        <div>
                          <div className="flex flex-wrap gap-x-2 gap-y-0">
                            {product.costPrice != null && (
                              <span className="font-mono-data text-[14px] text-amber-600 dark:text-amber-400">
                                成本 ¥{product.costPrice.toFixed(0)}
                              </span>
                            )}
                            {product.salePrice != null && product.salePrice > 0 && (
                              <span className="font-mono-data text-[14px] font-bold text-emerald-600 dark:text-emerald-400">
                                售 HK${product.salePrice.toLocaleString()}
                              </span>
                            )}
                          </div>
                          {dimStr && (
                            <p className="font-mono-data text-[14px] text-muted-foreground/60 mt-0.5">
                              {dimStr}
                            </p>
                          )}
                        </div>

                        {/* Factory name — 14px */}
                        {product.factoriesDisplayName && (
                          <div className="flex items-center gap-1">
                            <Factory className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="font-body text-[14px] text-muted-foreground truncate">
                              {product.factoriesDisplayName}
                            </span>
                          </div>
                        )}

                        {/* Category Badge — 14px */}
                        {(product.level1Category || product.category) && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {product.level1Category && (
                              <Badge variant="outline" className="text-[14px] px-2 py-0.5 h-6 leading-none">
                                {product.level1Category}
                              </Badge>
                            )}
                            {product.level2Category && (
                              <Badge variant="outline" className="text-[14px] px-2 py-0.5 h-6 leading-none text-muted-foreground">
                                {product.level2Category}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Material — 16px, always reserves 4 lines */}
                        <div className="min-h-[66px]">
                          <p className="font-body text-[16px] text-muted-foreground line-clamp-4 leading-snug">
                            {product.material ?? ''}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Bottom: A/B/C action buttons */}
                    {!isCatalog && (
                      <div
                        className="grid grid-cols-3 border-t border-border"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleRowToShopify(product)}
                          className="flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-indigo-600 bg-indigo-500/5 hover:bg-indigo-500/15 transition-colors border-r border-border"
                        >
                          <Send className="h-3 w-3 flex-shrink-0" />
                          A 加入Shopify
                        </button>
                        <button
                          onClick={() => handleRowToCatalog(product)}
                          className="flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-emerald-600 bg-emerald-500/5 hover:bg-emerald-500/15 transition-colors border-r border-border"
                        >
                          <Database className="h-3 w-3 flex-shrink-0" />
                          B 加到目錄
                        </button>
                        <button
                          onClick={() => setDismissTarget(product)}
                          className="flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 className="h-3 w-3 flex-shrink-0" />
                          C 暫不考慮
                        </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          ) : (
            /* ── LIST VIEW ── */
            <table className="w-full min-w-[1580px]">
              <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                <tr className="border-b border-border">
                  <th className="px-3 py-3 text-left w-[40px]">
                    <Checkbox
                      checked={isAllSelected ? true : isSomeSelected ? "indeterminate" : false}
                      onCheckedChange={toggleSelectAll}
                      aria-label="全選"
                    />
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      圖片
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      標題
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      顏色
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      廠家代號
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      廠家
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      一級分類
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      二級分類
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      系列
                    </span>
                  </th>
                  {isCatalog && (
                    <th className="px-3 py-3 text-left">
                      <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        生產時間
                      </span>
                    </th>
                  )}
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      成本
                    </span>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => setShowPricingDialog(true)}
                        className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
                      >
                        <Calculator className="h-2.5 w-2.5" />
                        定價
                      </button>
                      <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        售價
                      </span>
                    </div>
                  </th>
                  {!isCatalog && (
                    <th className="px-3 py-3 text-center">
                      <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        處理
                      </span>
                    </th>
                  )}
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      材質
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      規格
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      總交期
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      貨期類型
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      標籤
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <span className="font-mono-data text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      SKU No.
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, i) => (
                  <motion.tr
                    key={product.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02, duration: 0.25 }}
                    className="group h-[72px] border-b border-border transition-colors hover:bg-muted/60 cursor-pointer"
                    onClick={(e) => handleRowClick(e, product)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-3 w-[40px]">
                      <Checkbox
                        checked={selectedIds.has(product.id)}
                        onCheckedChange={() => toggleSelectProduct(product.id)}
                        aria-label={`選擇 ${product.title}`}
                      />
                    </td>

                    {/* Image */}
                    <td className="px-3 py-3">
                      {(() => {
                        const imgSrc = product.images?.[0]?.src || product.imageUrl || '';
                        return imgSrc ? (
                          <img
                            src={imgSrc}
                            alt={product.images?.[0]?.alt || product.title}
                            loading="lazy"
                            decoding="async"
                            className="h-14 w-14 aspect-square rounded-md object-cover flex-shrink-0 bg-muted"
                          />
                        ) : (
                          <div className="h-14 w-14 aspect-square rounded-md bg-muted flex items-center justify-center">
                            <Store className="h-5 w-5 text-muted-foreground/40" />
                          </div>
                        );
                      })()}
                    </td>

                    {/* Title */}
                    <td className="px-3 py-3 max-w-[180px]">
                      <div className="space-y-0.5">
                        <span className="font-display text-xs font-bold leading-tight line-clamp-2">
                          {product.title}
                        </span>
                        {product.factoriesDisplayName && (
                          <p className="text-[10px] text-muted-foreground font-body truncate">
                            {product.factoriesDisplayName}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Color (Chinese) — supports comma-separated multi-color */}
                    <td className="px-3 py-3">
                      {product.color ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {product.color.split(',').map(s => s.trim()).filter(Boolean).map((colorEn) => (
                            <div key={colorEn} className="flex items-center gap-1 rounded-full bg-muted/50 border border-border/50 px-1.5 py-0.5">
                              <div
                                className="h-2.5 w-2.5 rounded-full border border-border/40 flex-shrink-0"
                                style={{ backgroundColor: getColorHex(colorEn) }}
                              />
                              <span className="font-body text-xs">
                                {getChineseColorLabel(colorEn) || colorEn}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Factory Code */}
                    <td className="px-3 py-3">
                      {product.factoryId ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="font-mono-data text-[9px] gap-1 cursor-default">
                              <Factory className="h-2.5 w-2.5" />
                              {product.factoryId}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-mono-data text-[11px]">
                              廠家代號: {product.factoryId}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Factory Name */}
                    <td className="px-3 py-3">
                      {product.factoriesDisplayName ? (
                        <span className="font-body text-[11px] text-foreground truncate max-w-[120px] inline-block">
                          {product.factoriesDisplayName}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Level 1 Category */}
                    <td className="px-3 py-3">
                      {product.level1Category ? (
                        <Badge variant="outline" className="font-body text-[10px] border-indigo-500/30 text-indigo-600 dark:text-indigo-400">
                          {product.level1Category}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Level 2 Category */}
                    <td className="px-3 py-3">
                      {product.level2Category ? (
                        <span className="font-body text-[11px] text-foreground">{product.level2Category}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* 系列 (product_sku) */}
                    <td className="px-3 py-3">
                      {product.productSku ? (
                        <span className="font-mono-data text-[11px] text-foreground">{product.productSku}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Production Time (catalog only) */}
                    {isCatalog && (
                      <td className="px-3 py-3">
                        {product.productionTime ? (
                          <Badge variant="outline" className="font-body text-[10px] border-sky-500/30 text-sky-600 dark:text-sky-400 whitespace-nowrap">
                            {product.productionTime}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                    )}

                    {/* Cost Price */}
                    <td className="px-3 py-3">
                      {product.costPrice != null ? (
                        <span className="font-mono-data text-[11px] text-amber-600 dark:text-amber-400">
                          ¥{product.costPrice.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Sale Price (sale_price column) */}
                    <td className="px-3 py-3">
                      {product.salePrice != null && product.salePrice > 0 ? (
                        <span className="font-mono-data text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                          HK${product.salePrice.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* 處理動作 A/B/C (所有產品頁) */}
                    {!isCatalog && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col gap-1 w-[112px]">
                          <button
                            onClick={() => handleRowToShopify(product)}
                            className="flex items-center justify-center gap-1 rounded-md bg-indigo-500/10 px-2 py-1 text-[10.5px] font-medium text-indigo-600 transition-colors hover:bg-indigo-500/20"
                          >
                            <Send className="h-3 w-3" /> A 加入Shopify
                          </button>
                          <button
                            onClick={() => handleRowToCatalog(product)}
                            className="flex items-center justify-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[10.5px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20"
                          >
                            <Database className="h-3 w-3" /> B 加到產品目錄
                          </button>
                          <button
                            onClick={() => setDismissTarget(product)}
                            className="flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                          >
                            <Trash2 className="h-3 w-3" /> C 暫不考慮
                          </button>
                        </div>
                      </td>
                    )}

                    {/* 材質 (material) */}
                    <td className="px-3 py-3 max-w-[180px]">
                      {product.material ? (
                        <span className="font-body text-[11px] text-foreground line-clamp-2">{product.material}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* 規格 (specifications) */}
                    <td className="px-3 py-3 max-w-[180px]">
                      {product.specifications ? (
                        <span className="font-body text-[11px] text-foreground line-clamp-2">{product.specifications}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Total Lead Time */}
                    <td className="px-3 py-3">
                      {getLeadTimeDisplay(product) !== '—' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 cursor-default">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="font-mono-data text-[11px]">
                                {getLeadTimeDisplay(product)}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="space-y-1">
                              {product.productionLeadTime != null && (
                                <p className="font-mono-data text-[10px]">
                                  生產: {product.productionLeadTime}天
                                </p>
                              )}
                              {product.shippingDays != null && (
                                <p className="font-mono-data text-[10px]">
                                  運輸: {product.shippingDays}天
                                </p>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Delivery Term Name */}
                    <td className="px-3 py-3">
                      {product.deliveryTermName ? (
                        <span className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 font-mono-data text-[10px] font-medium text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20">
                          {product.deliveryTermName}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Tags */}
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[140px]">
                        {(product.tags || []).slice(0, 2).map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-[9px] font-mono-data px-1.5 py-0"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {product.tags.length > 2 && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono-data px-1.5 py-0"
                          >
                            +{product.tags.length - 2}
                          </Badge>
                        )}
                      </div>
                    </td>

                    {/* SKU No. (product_sku) */}
                    <td className="px-3 py-3">
                      {product.productSku ? (
                        <span className={cn(
                          'font-mono-data text-[11px]',
                          showDuplicates && 'text-rose-500 font-semibold'
                        )}>
                          {product.productSku}
                        </span>
                      ) : (
                        <span className="font-mono-data text-[10px] text-muted-foreground/40">—</span>
                      )}
                    </td>

                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        {!isLoading && products.length > 0 && (
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-6 py-2.5">
            <span className="font-mono-data text-xs text-muted-foreground">
              顯示 {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalCount)}，共 {totalCount} 項
            </span>

            <div className="flex items-center gap-1">
              {/* First */}
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="h-7 w-7 p-0"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>

              {/* Previous */}
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              {/* Page Numbers */}
              {getPageNumbers().map((page, idx) =>
                page === '...' ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="flex h-7 w-7 items-center justify-center font-mono-data text-[10px] text-muted-foreground"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={page}
                    variant={currentPage === page ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setCurrentPage(page as number)}
                    className={cn(
                      'h-7 w-7 p-0 font-mono-data text-[11px]',
                      currentPage === page && 'bg-primary text-primary-foreground'
                    )}
                  >
                    {page}
                  </Button>
                )
              )}

              {/* Next */}
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>

              {/* Last */}
              <Button
                variant="ghost"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="h-7 w-7 p-0"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Variant Modal */}
        <Dialog open={!!variantModal} onOpenChange={() => setVariantModal(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display">
                款式 — {variantModal?.product.title}
              </DialogTitle>
              <DialogDescription className="font-body text-xs">
                產品款式詳情（唯讀模式）
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              {variantModal?.product.variants.length === 0 && (
                <p className="text-xs text-muted-foreground font-body">沒有可用的款式</p>
              )}
              {variantModal?.product.variants.map((v) => (
                <div
                  key={v.id}
                  className="grid grid-cols-5 gap-2 rounded-lg border border-border bg-muted/30 p-3"
                >
                  <div className="space-y-1">
                    <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
                      尺寸
                    </label>
                    <p className="text-xs font-mono-data">{v.size || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
                      顏色
                    </label>
                    <p className="text-xs font-mono-data">{v.color || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
                      SKU
                    </label>
                    <p className="text-xs font-mono-data">{v.sku || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
                      價格
                    </label>
                    <p className="text-xs font-mono-data font-bold">${v.price.toFixed(2)}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="font-mono-data text-[9px] uppercase tracking-widest text-muted-foreground">
                      庫存
                    </label>
                    <p className="text-xs font-mono-data">{v.inventory}</p>
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                確認刪除
              </AlertDialogTitle>
              <AlertDialogDescription className="font-body text-sm">
                是否刪除所選的 <span className="font-bold text-foreground">{selectedIds.size}</span> 件產品？
                <br />
                <span className="text-xs text-muted-foreground mt-2 block">
                  此操作將從本地資料庫和全域資料庫（bwf_product_master）中永久移除所選產品。此操作無法撤銷。
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="font-display text-xs font-bold">
                否
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteSelected}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-display text-xs font-bold gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                是
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* C 暫不考慮 — 確認移除單一產品 */}
        <AlertDialog open={!!dismissTarget} onOpenChange={(o) => { if (!o) setDismissTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-rose-500" />
                確認移除
              </AlertDialogTitle>
              <AlertDialogDescription className="font-body text-sm">
                是否同意移除 <span className="font-bold text-foreground">1</span> 項的產品？
                <br />
                <span className="text-xs text-muted-foreground mt-2 block">
                  「{dismissTarget?.title}」將從「所有產品」頁面移除（產品資料保留於資料庫，可日後找回）。
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="font-display text-xs font-bold">否</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDismiss}
                className="bg-rose-500 text-white hover:bg-rose-600 font-display text-xs font-bold gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" /> 是，移除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 批量「暫不考慮」確認 */}
        <AlertDialog open={showBatchRejectConfirm} onOpenChange={setShowBatchRejectConfirm}>
          <AlertDialogContent className="max-w-md border-rose-500/20">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display flex items-center gap-2">
                <Ban className="h-5 w-5 text-rose-500" />
                確認批量「暫不考慮」
              </AlertDialogTitle>
              <AlertDialogDescription className="font-body text-sm">
                將所選的{' '}
                <span className="font-mono-data font-bold text-rose-500">{selectedIds.size}</span>{' '}
                件產品標記為「暫不考慮」？
                <br />
                <span className="text-xs text-muted-foreground mt-2 block">
                  產品資料將儲存至{' '}
                  <code className="font-mono-data text-rose-500">products_rejected</code>{' '}
                  記錄，並從列表中移除。
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="font-display text-xs font-bold">取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleBatchReject}
                className="bg-rose-500 text-white hover:bg-rose-600 font-display text-xs font-bold gap-1.5"
              >
                <Ban className="h-3.5 w-3.5" /> 確認暫不考慮
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 定價對話框 */}
        <Dialog open={showPricingDialog} onOpenChange={setShowPricingDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-display flex items-center gap-2">
                <Calculator className="h-4 w-4 text-emerald-500" />
                批量定價
              </DialogTitle>
              <DialogDescription className="font-body text-sm">
                輸入定價倍數，售價 = 成本 × 倍數（小數進位取整數）
                <br />
                <span className="text-xs text-muted-foreground mt-1 block">
                  套用至當前頁面顯示的{' '}
                  <span className="font-mono-data font-bold text-foreground">
                    {products.filter(p => p.costPrice != null && p.costPrice > 0).length}
                  </span>{' '}
                  件有成本的產品（依目前篩選及分頁）
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="font-mono-data text-[11px] text-muted-foreground uppercase tracking-widest">
                  定價倍數
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  placeholder="例如 2.3、2.5、2.7"
                  value={pricingMultiplier}
                  onChange={e => setPricingMultiplier(e.target.value)}
                  className="font-mono-data text-sm"
                  onKeyDown={e => { if (e.key === 'Enter') handleApplyPricing(); }}
                  autoFocus
                />
                {pricingMultiplier && !isNaN(parseFloat(pricingMultiplier)) && (
                  <p className="text-[11px] text-muted-foreground font-body">
                    預覽：成本 ¥360 → 售價 HK$
                    <span className="font-mono-data font-bold text-emerald-500">
                      {Math.ceil(360 * parseFloat(pricingMultiplier))}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {['2.3', '2.5', '2.7', '3.0'].map(v => (
                  <button
                    key={v}
                    onClick={() => setPricingMultiplier(v)}
                    className={cn(
                      'rounded-md border px-3 py-1 text-xs font-mono-data transition-colors',
                      pricingMultiplier === v
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600'
                        : 'border-border hover:border-emerald-500/50 hover:bg-muted'
                    )}
                  >
                    ×{v}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowPricingDialog(false)} className="font-display text-xs">
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleApplyPricing}
                disabled={!pricingMultiplier || isNaN(parseFloat(pricingMultiplier)) || parseFloat(pricingMultiplier) <= 0 || isApplyingPricing}
                className="gap-1.5 font-display text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {isApplyingPricing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
                套用定價
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Product Detail Modal */}
        {detailProduct && (
          <ProductDetailModal
            product={detailProduct}
            open={!!detailProduct}
            onClose={() => setDetailProduct(null)}
            onProductUpdated={(updated) => {
              handleProductUpdated(updated as unknown as ListedProduct);
              setDetailProduct(null);
            }}
            showAIImageTools={isCatalog}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

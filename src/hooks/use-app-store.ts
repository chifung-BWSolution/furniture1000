import { useState, useCallback, useEffect, useRef } from 'react';
import { Product, ProductVariant, ProductStatus, ProductSource, AppSettings, ViewType } from '@/types/product';
import { supabase } from '@/lib/supabase';
import { removeProductFromPublishPipeline } from '@/lib/publishPipeline';
import { resolveRowsImagesToStorage, productImageFieldsPendingStorage, stripBase64ForDb } from '@/lib/imageStorage';
import { toast } from 'sonner';

const generateId = () => Math.random().toString(36).substring(2, 15);

const SAMPLE_PRODUCTS: Product[] = [
  {
    id: generateId(),
    title: 'Artisan Ceramic Mug — Matte Black',
    description: 'Handcrafted ceramic mug with a smooth matte black finish. Perfect for everyday use. Microwave and dishwasher safe. Capacity: 12oz.',
    tags: ['ceramics', 'kitchenware', 'handmade', 'matte-black'],
    price: 34.99,
    compareAtPrice: 44.99,
    collection: 'Home & Kitchen',
    status: 'draft',
    imageUrl: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400&q=80',
    variants: [
      { id: generateId(), size: '12oz', color: 'Matte Black', sku: 'MUG-BLK-12', price: 34.99, inventory: 120 },
      { id: generateId(), size: '16oz', color: 'Matte Black', sku: 'MUG-BLK-16', price: 39.99, inventory: 85 },
    ],
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    source: 'local' as ProductSource,
  },
  {
    id: generateId(),
    title: 'Minimalist Leather Wallet — Cognac',
    description: 'Slim bifold wallet crafted from full-grain vegetable-tanned leather. Features 6 card slots, 2 hidden pockets, and a bill compartment.',
    tags: ['leather', 'accessories', 'minimalist', 'wallet'],
    price: 79.00,
    collection: 'Accessories',
    status: 'draft',
    imageUrl: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=400&q=80',
    variants: [
      { id: generateId(), size: 'One Size', color: 'Cognac', sku: 'WLT-COG-01', price: 79.00, inventory: 200 },
      { id: generateId(), size: 'One Size', color: 'Black', sku: 'WLT-BLK-01', price: 79.00, inventory: 150 },
    ],
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    source: 'local' as ProductSource,
  },
  {
    id: generateId(),
    title: 'Organic Cotton Tee — Cloud White',
    description: 'Ultra-soft organic cotton t-shirt with a relaxed fit. Pre-shrunk, enzyme-washed for lived-in comfort from day one.',
    tags: ['organic', 'cotton', 'apparel', 't-shirt', 'sustainable'],
    price: 42.00,
    compareAtPrice: 55.00,
    collection: 'Apparel',
    status: 'success',
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80',
    variants: [
      { id: generateId(), size: 'S', color: 'Cloud White', sku: 'TEE-WHT-S', price: 42.00, inventory: 50 },
      { id: generateId(), size: 'M', color: 'Cloud White', sku: 'TEE-WHT-M', price: 42.00, inventory: 75 },
      { id: generateId(), size: 'L', color: 'Cloud White', sku: 'TEE-WHT-L', price: 42.00, inventory: 60 },
      { id: generateId(), size: 'XL', color: 'Cloud White', sku: 'TEE-WHT-XL', price: 42.00, inventory: 40 },
    ],
    createdAt: new Date(Date.now() - 604800000).toISOString(),
    source: 'local' as ProductSource,
  },
  {
    id: generateId(),
    title: 'Wireless Charging Pad — Slate',
    description: '15W fast wireless charger compatible with Qi-enabled devices. Premium aluminum body with non-slip silicone surface. LED indicator ring.',
    tags: ['electronics', 'charger', 'wireless', 'tech'],
    price: 49.95,
    collection: 'Electronics',
    status: 'error',
    errorMessage: 'Shopify API: Product variant SKU already exists in store.',
    imageUrl: 'https://images.unsplash.com/photo-1586816879360-004f5b0c51e3?w=400&q=80',
    variants: [
      { id: generateId(), size: 'Standard', color: 'Slate', sku: 'CHG-SLT-01', price: 49.95, inventory: 300 },
    ],
    createdAt: new Date(Date.now() - 259200000).toISOString(),
    source: 'local' as ProductSource,
  },
  {
    id: generateId(),
    title: 'Soy Wax Candle — Cedar & Sage',
    description: 'Hand-poured soy wax candle with natural essential oils. Clean burn time of 50+ hours. Reusable glass vessel.',
    tags: ['candles', 'home', 'soy-wax', 'aromatherapy'],
    price: 28.00,
    collection: 'Home & Kitchen',
    status: 'draft',
    imageUrl: 'https://images.unsplash.com/photo-1602028915047-37269d1a73f7?w=400&q=80',
    variants: [
      { id: generateId(), size: '8oz', color: 'Amber Glass', sku: 'CND-CS-8', price: 28.00, inventory: 180 },
      { id: generateId(), size: '12oz', color: 'Amber Glass', sku: 'CND-CS-12', price: 38.00, inventory: 95 },
    ],
    createdAt: new Date(Date.now() - 345600000).toISOString(),
    source: 'local' as ProductSource,
  },
  {
    id: generateId(),
    title: 'Stainless Steel Water Bottle — Midnight',
    description: 'Double-wall vacuum insulated bottle. Keeps drinks cold for 24h or hot for 12h. BPA-free, leak-proof cap. 750ml capacity.',
    tags: ['drinkware', 'stainless-steel', 'eco-friendly', 'insulated'],
    price: 35.00,
    collection: 'Accessories',
    status: 'publishing',
    imageUrl: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&q=80',
    variants: [
      { id: generateId(), size: '500ml', color: 'Midnight', sku: 'BTL-MID-500', price: 29.00, inventory: 220 },
      { id: generateId(), size: '750ml', color: 'Midnight', sku: 'BTL-MID-750', price: 35.00, inventory: 160 },
    ],
    createdAt: new Date(Date.now() - 432000000).toISOString(),
    source: 'local' as ProductSource,
  },
];

const DEFAULT_SETTINGS: AppSettings = {
  shopifyApiKey: '',
  shopifyStoreUrl: '',
  defaultCollection: 'Home & Kitchen',
  aiModel: 'gemini-2.5-flash',
  isConnected: false,
  geminiProxyUrl: '',
};

const PRODUCT_LIST_PAGE_LIMIT = 100;

/** Lightweight list page via RPC — never ships description_html or base64 image_url. */
async function fetchProductsListPage(limit = PRODUCT_LIST_PAGE_LIMIT, offset = 0) {
  const { data, error } = await supabase.rpc('get_products_list_page', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return { rows: null as any[] | null, error };
  return { rows: (data ?? []) as Record<string, unknown>[], error: null };
}

// Helper: convert DB row to Product
function dbRowToProduct(row: any, variants: any[]): Product {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    descriptionHtml: row.description_html || undefined,
    tags: row.tags || [],
    price: parseFloat(row.price),
    compareAtPrice: row.compare_at_price ? parseFloat(row.compare_at_price) : undefined,
    collection: row.collection,
    status: row.status as ProductStatus,
    imageUrl: typeof row.image_url === 'string' && row.image_url.startsWith('data:') ? undefined : row.image_url,
    errorMessage: row.error_message || undefined,
    shopifyProductId: row.shopify_product_id || null,
    sku: row.sku || undefined,
    createdAt: row.created_at,
    source: (row.source as ProductSource) || 'local',
    syncedAt: row.synced_at || null,
    uploadSessionId: row.upload_session_id || null,
    factoriesDisplayName: row.factories_display_name || '',
    factoryId: row.factory_id || null,
    material: row.material || '',
    bwfMasterId: row.bwf_master_id || null,
    costPrice: row.cost_price != null ? parseFloat(row.cost_price) : null,
    salePrice: row.sale_price != null ? parseFloat(row.sale_price) : 0,
    productionLeadTime: row.production_lead_time != null ? parseInt(row.production_lead_time) : (row.production_date != null ? parseInt(row.production_date) : null),
    shippingDays: row.shipping_days != null ? parseInt(row.shipping_days) : null,
    shippingFee: row.shipping_fee != null ? parseFloat(row.shipping_fee) : null,
    remarks: row.remarks || null,
    color: row.color || null,
    category: row.category || undefined,
    dimensionLMm: row.dimension_l_mm != null ? parseInt(row.dimension_l_mm) : null,
    dimensionWMm: row.dimension_w_mm != null ? parseInt(row.dimension_w_mm) : null,
    dimensionHMm: row.dimension_h_mm != null ? parseInt(row.dimension_h_mm) : null,
    deliveryTermId: row.delivery_term_id || null,
    deliveryTermName: row.delivery_term_name || null,
    inStock: row.in_stock != null ? Boolean(row.in_stock) : null,
    customize: row.customize || null,
    readyToPublish: row.ready_to_publish === true,
    variants: variants.map(v => ({
      id: v.id,
      size: v.size,
      color: v.color,
      sku: v.sku,
      price: parseFloat(v.price),
      inventory: v.inventory,
    })),
  };
}

// Save products to Supabase — batched upserts, images to Storage first (never base64 in DB).
async function saveProductsToDb(productsToSave: Product[]) {
  const productRows = productsToSave.map(p => ({
    id: p.id,
    title: p.title,
    description: p.description,
    description_html: p.descriptionHtml || p.description,
    tags: p.tags,
    price: p.price,
    compare_at_price: p.compareAtPrice || null,
    collection: p.collection,
    status: p.status,
    image_url: stripBase64ForDb(p.imageUrl),
    error_message: p.errorMessage || null,
    shopify_product_id: p.shopifyProductId || null,
    sku: p.sku || '',
    created_at: p.createdAt,
    source: p.source || 'local',
    synced_at: p.syncedAt || null,
    upload_session_id: p.uploadSessionId || null,
    factories_display_name: p.factoriesDisplayName || '',
    factory_id: p.factoryId || '',
    bwf_master_id: p.bwfMasterId || null,
    cost_price: p.costPrice ?? null,
    sale_price: p.salePrice ?? 0,
    production_date: p.productionLeadTime ?? null,
    shipping_days: p.shippingDays ?? null,
    shipping_fee: p.shippingFee ?? null,
    remarks: p.remarks || '',
    color: p.color || '',
    dimension_l_mm: p.dimensionLMm ?? null,
    dimension_w_mm: p.dimensionWMm ?? null,
    dimension_h_mm: p.dimensionHMm ?? null,
    material: p.material || '',
    category: p.category || null,
    delivery_term_id: p.deliveryTermId || null,
    delivery_term_name: p.deliveryTermName || null,
  }));

  const resolvedRows = await resolveRowsImagesToStorage(productRows);
  if (resolvedRows.some((r) => productImageFieldsPendingStorage(r))) {
    throw new Error('部分產品圖片未能上傳至 Storage，已取消儲存');
  }
  const UPSERT_CHUNK = 8;

  for (let ci = 0; ci < resolvedRows.length; ci += UPSERT_CHUNK) {
    const batch = resolvedRows.slice(ci, ci + UPSERT_CHUNK);
    const { error: prodErr } = await supabase
      .from('products')
      .upsert(batch, { onConflict: 'id' });

    if (prodErr) {
      console.error(`[Supabase] Error saving products batch ${Math.floor(ci / UPSERT_CHUNK) + 1}:`, prodErr);
      throw prodErr;
    }
  }

  const productIds = productsToSave.map(p => p.id);

  if (productIds.length > 0) {
    const { error: delErr } = await supabase
      .from('product_variants')
      .delete()
      .in('product_id', productIds);

    if (delErr) {
      console.error('[Supabase] Error deleting variants:', delErr);
      throw delErr;
    }
  }

  const allVariants = productsToSave.flatMap(p =>
    p.variants.map(v => ({
      id: v.id,
      product_id: p.id,
      size: v.size,
      color: v.color,
      sku: v.sku,
      price: v.price,
      inventory: v.inventory,
    }))
  );

  const VARIANT_CHUNK = 50;
  for (let vi = 0; vi < allVariants.length; vi += VARIANT_CHUNK) {
    const batch = allVariants.slice(vi, vi + VARIANT_CHUNK);
    if (batch.length === 0) continue;
    const { error: varErr } = await supabase
      .from('product_variants')
      .insert(batch);

    if (varErr) {
      console.error('[Supabase] Error inserting variants:', varErr);
      throw varErr;
    }
  }
}

export function useAppStore() {
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('app-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch { /* ignore */ }
    return DEFAULT_SETTINGS;
  });
  const [currentView, setCurrentViewRaw] = useState<ViewType>(() => {
    try {
      const saved = sessionStorage.getItem('current-view') as ViewType | null;
      if (saved) return saved;
    } catch { /* ignore */ }
    return 'quick-quote';
  });
  const setCurrentView = (view: ViewType) => {
    try { sessionStorage.setItem('current-view', view); } catch { /* ignore */ }
    setCurrentViewRaw(view);
  };
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [filterProductId, setFilterProductId] = useState<string | null>(null);
  const [factoryDetailCode, setFactoryDetailCode] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState<{ succeeded: number; total: number } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [totalProductCount, setTotalProductCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [readyToPublishList, setReadyToPublishList] = useState<Product[]>([]);
  const initialLoadDone = useRef(false);
  const reloadReadyToPublishGen = useRef(0);

  // Sync dark mode class on mount
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Load products from Supabase on mount
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    async function loadProducts() {
      setIsLoading(true);
      try {
        // Limit initial load to 100 products for performance
        const countPromise = supabase
          .from('products')
          .select('id', { count: 'estimated', head: true });
        const dataPromise = fetchProductsListPage(PRODUCT_LIST_PAGE_LIMIT, 0);

        const [{ count: totalCount }, { rows: productRows, error: prodErr }] =
          await Promise.all([countPromise, dataPromise]);

        setTotalProductCount(totalCount || 0);

        if (prodErr) {
          console.warn('[Supabase] Error loading products, using sample data:', prodErr.message);
          setProducts(SAMPLE_PRODUCTS);
          setIsLoading(false);
          return;
        }

        if (!productRows || productRows.length === 0) {
          // No products in DB — seed with sample and auto-save
          setProducts(SAMPLE_PRODUCTS);
          setIsLoading(false);
          try {
            await saveProductsToDb(SAMPLE_PRODUCTS);
          } catch {
            console.warn('[Supabase] Could not seed sample products');
          }
          return;
        }

        // Render products immediately with empty variants — unblocks the whole
        // app shell now instead of waiting for the variants round-trip.
        const loaded = productRows.map((row: any) => dbRowToProduct(row, []));
        setProducts(loaded);
        setIsLoading(false);

        // Fetch variants in the background and patch them in afterwards.
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
        return;
      } catch (err) {
        console.warn('[Supabase] Unexpected error, using sample data:', err);
        setProducts(SAMPLE_PRODUCTS);
        setIsLoading(false);
      }
    }

    loadProducts();
  }, []);

  // Reload products from Supabase (used after publish/sync)
  // 準備上載 = all rows in ready_to_shopify (has product_id FK → products table).
  // Strategy:
  //   Step 1 – lightweight RTS fetch (no images) → render list immediately
  //   Step 2 – batch-fetch products rows for SKU/cost/dimensions/tags → patch in
  //   Step 3 – batch-fetch images 20 at a time → patch thumbnails progressively
  // Legacy hook for post-publish refresh — 準備上載 list is now server-paginated in ReadyToPublishView.
  const reloadReadyToPublish = useCallback(async () => {
    /* no-op: use ReadyToPublishView.useReadyToPublishList().reload instead */
  }, []);

  const reloadProducts = useCallback(async () => {
    try {
      // Refresh total count
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true });
      setTotalProductCount(count || 0);

      const { rows: productRows, error: prodErr } = await fetchProductsListPage(
        PRODUCT_LIST_PAGE_LIMIT,
        0,
      );

      if (prodErr) {
        console.warn('[Supabase] Error reloading products:', prodErr.message);
        return;
      }

      // Only fetch variants for loaded products
      const productIds = (productRows || []).map((p: any) => p.id);
      const { data: variantRows } = productIds.length > 0
        ? await supabase
            .from('product_variants')
            .select('*')
            .in('product_id', productIds)
        : { data: [] };

      const variantsByProduct: Record<string, any[]> = {};
      (variantRows || []).forEach((v: any) => {
        if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
        variantsByProduct[v.product_id].push(v);
      });

      const loaded = (productRows || []).map((row: any) =>
        dbRowToProduct(row, variantsByProduct[row.id] || [])
      );

      setProducts(loaded);
      setHasUnsavedChanges(false);
    } catch (err) {
      console.warn('[Supabase] Reload error:', err);
    }
  }, []);

  // Sync sale_price and shopify_price to the Master DB for products that have a bwfMasterId
  const updateMasterProductPrice = useCallback(async (productsToSync: Product[]) => {
    const productsWithMasterId = productsToSync.filter(p => p.bwfMasterId);
    if (productsWithMasterId.length === 0) {
      console.log('[updateMasterProductPrice] No products with bwfMasterId to sync');
      return { synced: 0, errors: 0 };
    }

    let synced = 0;
    let errors = 0;

    for (const p of productsWithMasterId) {
      try {
        const { error } = await supabase.functions.invoke('supabase-functions-update-master-db', {
          body: {
            master_id: p.bwfMasterId,
            product: {
              sale_price: p.salePrice ?? 0,
              shopify_price: p.salePrice ?? 0,
            },
          },
        });

        if (error) {
          console.error(`[updateMasterProductPrice] Error syncing "${p.title}":`, error.message);
          errors++;
        } else {
          synced++;
        }
      } catch (err) {
        console.error(`[updateMasterProductPrice] Exception syncing "${p.title}":`, err);
        errors++;
      }
    }

    console.log(`[updateMasterProductPrice] Synced ${synced}/${productsWithMasterId.length} products to Master DB (${errors} errors)`);
    return { synced, errors };
  }, []);

  // Public save function — syncs current state to Supabase
  const saveProducts = useCallback(async () => {
    setIsSaving(true);
    try {
      // Get current DB product IDs to detect deletions
      const { data: dbProducts } = await supabase.from('products').select('id');
      const dbIds = new Set((dbProducts || []).map((p: any) => p.id));
      const currentIds = new Set(products.map(p => p.id));

      // Delete products removed locally
      const toDelete = [...dbIds].filter(id => !currentIds.has(id));
      if (toDelete.length > 0) {
        await supabase.from('product_variants').delete().in('product_id', toDelete);
        await supabase.from('products').delete().in('id', toDelete);
      }

      // Upsert current products
      if (products.length > 0) {
        await saveProductsToDb(products);
      }

      // Auto-sync to Master DB: upload products that already have a bwfMasterId
      const productsWithMasterId = products.filter(p => p.bwfMasterId);
      if (productsWithMasterId.length > 0) {
        console.log(`[saveProducts] Auto-syncing ${productsWithMasterId.length} products to Master DB...`);
        const masterPayload = productsWithMasterId.map(p => ({
          local_id: p.id,
          master_id: p.bwfMasterId || null,
          title: p.title,
          description_html: p.descriptionHtml || p.description,
          description: p.description,
          tags: p.tags,
          price: p.price,
          compare_at_price: p.compareAtPrice || null,
          collection: p.collection,
          image_url: p.imageUrl,
          shopify_product_id: p.shopifyProductId || null,
          category: p.category || p.collection || '',
          factory_name: p.factoryName || p.factoriesDisplayName || '',
          factory_id: p.factoryId || '',
          material: p.material || '',
          dimension_l_mm: p.dimensionLMm || null,
          dimension_w_mm: p.dimensionWMm || null,
          dimension_h_mm: p.dimensionHMm || null,
          cost_price: p.costPrice || null,
          sale_price: p.salePrice ?? 0,
          shopify_price: p.price || 0,
          shopify_compare_at_price: p.shopifyCompareAtPrice || p.compareAtPrice || null,
          delivery_days: p.deliveryDays || null,
          shopify_id: p.shopifyProductId || null,
          production_lead_time: p.productionLeadTime ?? null,
          total_lead_time: (p.productionLeadTime != null && p.shippingDays != null)
            ? (p.productionLeadTime + p.shippingDays)
            : (p.productionLeadTime ?? p.shippingDays ?? null),
          shipping_days: p.shippingDays ?? null,
          shipping_fee: p.shippingFee ?? null,
          remarks: p.remarks || null,
          color: p.color || null,
          factory_highlight: p.factoryHighlight || [],
          delivery_term_id: p.deliveryTermId || null,
          delivery_term_name: p.deliveryTermName || null,
          lifestyle_image_url: p.lifestyleImageUrl || null,
        }));

        try {
          const { data: masterData, error: masterError } = await supabase.functions.invoke('supabase-functions-upload-to-master-db', {
            body: { products: masterPayload },
          });

          if (masterError) {
            console.error('[saveProducts] Auto-sync to Master DB failed:', masterError.message);
            toast.error('Master DB 自動同步失敗', {
              description: masterError.message || 'upload-to-master-db edge function error',
            });
          } else if (masterData?.results) {
            const successCount = (masterData.results as any[]).filter(r => r.success).length;
            const errorCount = (masterData.results as any[]).filter(r => !r.success).length;

            // Update bwfMasterId for any newly assigned master IDs
            const resultsMap = new Map(
              (masterData.results as { local_id: string; success: boolean; master_id?: string }[])
                .map(r => [r.local_id, r])
            );
            setProducts(prev => prev.map(p => {
              const result = resultsMap.get(p.id);
              if (result?.success && result.master_id) {
                return { ...p, bwfMasterId: result.master_id };
              }
              return p;
            }));

            // Persist updated bwf_master_id to local DB
            const syncTimestamp = new Date().toISOString();
            for (const [localId, result] of resultsMap.entries()) {
              if (result.success && result.master_id) {
                await supabase.from('products').update({
                  bwf_master_id: result.master_id,
                  synced_at: syncTimestamp,
                }).eq('id', localId);
              }
            }

            if (successCount > 0) {
              toast.success(`已自動同步 ${successCount} 個產品到 Master DB`, {
                description: 'Products auto-synced to Master Database on save',
                icon: '🔄',
              });
            }
            if (errorCount > 0) {
              toast.error(`${errorCount} 個產品同步到 Master DB 失敗`, {
                description: 'Some products failed to sync',
              });
            }
          }
        } catch (masterSyncErr) {
          console.error('[saveProducts] Auto-sync exception:', masterSyncErr);
          toast.error('Master DB 自動同步異常', {
            description: String(masterSyncErr),
          });
        }
      }

      // Sync sale_price to Master DB for products that have a bwfMasterId (legacy direct DB update)
      const productsWithPrice = products.filter(p => p.bwfMasterId && (p.salePrice ?? 0) > 0);
      if (productsWithPrice.length > 0) {
        const result = await updateMasterProductPrice(productsWithPrice);
        if (result.synced > 0) {
          console.log(`[saveProducts] sale_price synced for ${result.synced} products`);
        }
        if (result.errors > 0) {
          console.warn(`[saveProducts] sale_price sync errors: ${result.errors}`);
        }
      }

      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('[Supabase] Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [products, updateMasterProductPrice]);

  // Remove a single product from DB immediately
  // NOTE: Only removes from the PRIMARY project (products + product_variants).
  // The bwf_product_master record in the Global Master project is NEVER deleted
  // — it serves as a permanent archive of all products ever published.
  const removeProductFromDb = async (id: string) => {
    try {
      await supabase.from('product_variants').delete().eq('product_id', id);
      await supabase.from('products').delete().eq('id', id);
      console.log(`[Supabase] Product ${id} removed from primary project. Master archive preserved.`);
    } catch (err) {
      console.error('[Supabase] Error deleting product:', err);
    }
  };

  const addProduct = useCallback((product: Omit<Product, 'id' | 'createdAt' | 'status' | 'source'>) => {
    const newProduct: Product = {
      ...product,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: 'draft',
      source: 'local',
    };
    setProducts(prev => [newProduct, ...prev]);
    setHasUnsavedChanges(true);

    // Immediately persist to local DB — images must be Storage HTTP URLs, never base64.
    (async () => {
      const ext = product as Product & { imageUrl2?: string | null; imageUrl3?: string | null };
      const [resolved] = await resolveRowsImagesToStorage([{
        id: newProduct.id,
        image_url: newProduct.imageUrl || '',
        image_url_2: ext.imageUrl2 ?? null,
        image_url_3: ext.imageUrl3 ?? null,
        lifestyle_image_url: newProduct.lifestyleImageUrl ?? null,
      }]);
      if (productImageFieldsPendingStorage(resolved)) {
        console.error('[addProduct] Image upload to Storage failed — product saved in memory only');
        return;
      }
      const { error } = await supabase.from('products').upsert({
        id: newProduct.id,
        title: newProduct.title,
        description: newProduct.description,
        description_html: newProduct.descriptionHtml || newProduct.description,
        tags: newProduct.tags,
        price: newProduct.price,
        compare_at_price: newProduct.compareAtPrice || null,
        collection: newProduct.collection,
        status: newProduct.status,
        image_url: resolved.image_url,
        image_url_2: resolved.image_url_2,
        image_url_3: resolved.image_url_3,
        lifestyle_image_url: resolved.lifestyle_image_url,
        error_message: null,
        shopify_product_id: null,
        sku: newProduct.sku || '',
        created_at: newProduct.createdAt,
        source: newProduct.source || 'local',
        synced_at: newProduct.syncedAt || null,
        upload_session_id: newProduct.uploadSessionId || null,
        factories_display_name: newProduct.factoriesDisplayName || '',
        factory_id: newProduct.factoryId || '',
        bwf_master_id: newProduct.bwfMasterId || null,
        cost_price: newProduct.costPrice ?? null,
        sale_price: newProduct.salePrice ?? 0,
        production_date: newProduct.productionLeadTime ?? null,
        shipping_days: newProduct.shippingDays ?? null,
        shipping_fee: newProduct.shippingFee ?? null,
        remarks: newProduct.remarks || '',
        color: newProduct.color || '',
        dimension_l_mm: newProduct.dimensionLMm ?? null,
        dimension_w_mm: newProduct.dimensionWMm ?? null,
        dimension_h_mm: newProduct.dimensionHMm ?? null,
        material: newProduct.material || '',
        category: newProduct.category || null,
        delivery_term_id: newProduct.deliveryTermId || null,
        delivery_term_name: newProduct.deliveryTermName || null,
      }, { onConflict: 'id' });
      if (error) {
        console.error('[addProduct] Failed to persist to DB:', error.message);
      } else {
        console.log(`[addProduct] ✅ Product ${newProduct.id} persisted to local DB with Storage URLs`);
      }
    })();

    return newProduct;
  }, []);

  // Batch add products (e.g. from Listed Products to Ready-to-Publish queue)
  // Skips products already in the queue (by bwfMasterId or title match)
  const addProducts = useCallback((newProducts: Product[]) => {
    setProducts(prev => {
      const existingIds = new Set(prev.map(p => p.id));
      const existingMasterIds = new Set(prev.filter(p => p.bwfMasterId).map(p => p.bwfMasterId));
      const existingTitles = new Set(prev.map(p => p.title));

      const toAdd: Product[] = [];
      for (const product of newProducts) {
        // Skip if already exists by id
        if (existingIds.has(product.id)) continue;
        // Skip if same bwfMasterId already in queue
        if (product.bwfMasterId && existingMasterIds.has(product.bwfMasterId)) continue;
        // Skip if same title already in queue
        if (existingTitles.has(product.title)) continue;

        const newProduct: Product = {
          ...product,
          id: generateId(),
          createdAt: new Date().toISOString(),
          status: 'draft' as ProductStatus,
          source: 'local' as ProductSource,
        };
        toAdd.push(newProduct);
        existingIds.add(newProduct.id);
        existingMasterIds.add(newProduct.bwfMasterId || '');
        existingTitles.add(newProduct.title);
      }

      if (toAdd.length === 0) return prev;

      // Persist each new product to DB in background
      for (const np of toAdd) {
        supabase.from('products').upsert({
          id: np.id,
          title: np.title,
          description: np.description,
          description_html: np.descriptionHtml || np.description,
          tags: np.tags,
          price: np.price,
          compare_at_price: np.compareAtPrice || null,
          collection: np.collection,
          status: np.status,
          image_url: np.imageUrl,
          error_message: null,
          shopify_product_id: null,
          sku: np.sku || '',
          created_at: np.createdAt,
          source: np.source || 'local',
          synced_at: np.syncedAt || null,
          upload_session_id: np.uploadSessionId || null,
          factories_display_name: np.factoriesDisplayName || '',
          factory_id: np.factoryId || '',
          bwf_master_id: np.bwfMasterId || null,
          cost_price: np.costPrice ?? null,
          sale_price: np.salePrice ?? 0,
          production_date: np.productionLeadTime ?? null,
          shipping_days: np.shippingDays ?? null,
          shipping_fee: np.shippingFee ?? null,
          remarks: np.remarks || '',
          color: np.color || '',
          dimension_l_mm: np.dimensionLMm ?? null,
          dimension_w_mm: np.dimensionWMm ?? null,
          dimension_h_mm: np.dimensionHMm ?? null,
          material: np.material || '',
          category: np.category || null,
          delivery_term_id: np.deliveryTermId || null,
          delivery_term_name: np.deliveryTermName || null,
        }, { onConflict: 'id' }).then(({ error }) => {
          if (error) {
            console.error('[addProducts] Failed to persist to DB:', error.message);
          }
        });
      }

      setHasUnsavedChanges(true);
      return [...toAdd, ...prev];
    });
  }, []);

  const updateProduct = useCallback((id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    setHasUnsavedChanges(true);
  }, []);

  // Update tags for a ready-to-publish product: patches both local state and ready_to_shopify.tags
  const updateReadyToPublishTags = useCallback(async (rtsId: string, tags: string[]) => {
    setReadyToPublishList(prev =>
      prev.map(p => p.id === rtsId ? { ...p, tags } : p)
    );
    const { error } = await supabase
      .from('ready_to_shopify')
      .update({ tags: tags.length > 0 ? tags : null })
      .eq('id', rtsId);
    if (error) {
      console.error('[updateReadyToPublishTags] Failed:', error.message);
      toast.error('標籤更新失敗', { description: error.message });
    }
  }, []);

  const deleteProduct = useCallback((id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setHasUnsavedChanges(true);
    removeProductFromDb(id);
  }, []);

  const toggleProductSelection = useCallback((id: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllProducts = useCallback((ids: string[]) => {
    setSelectedProductIds(prev => {
      if (ids.length === 0) return prev; // no-op if nothing to select
      const allSelected = ids.every(id => prev.has(id));
      if (allSelected) {
        // Deselect all — only create new Set if prev wasn't already empty
        if (prev.size === 0) return prev;
        return new Set<string>();
      }
      return new Set(ids);
    });
  }, []);

  const selectRangeProducts = useCallback((ids: string[], selected: boolean) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedProductIds(new Set());
  }, []);

  // Upload selected products to Global Master Database (bwf_product_master on kqwktnplkqucsbasyfjl)
  const publishSelected = useCallback(async () => {
    const ids = Array.from(selectedProductIds);
    setIsPublishing(true);

    // Search both the main list and the ready-to-publish list (they are separate state)
    const allAvailable = [...products, ...readyToPublishList];
    const seen = new Set<string>();
    const dedupedAvailable = allAvailable.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
    let selectedProducts = dedupedAvailable.filter(p => ids.includes(p.id));

    // Server-paginated 準備上載 may not keep every selected row in memory — resolve from DB.
    if (selectedProducts.length < ids.length) {
      const missingIds = ids.filter((id) => !selectedProducts.some((p) => p.id === id));
      const { data: rtsPickRows } = await supabase
        .from('ready_to_shopify')
        .select('id, product_id, title, vendor, price, tags, sku, product_type, variants')
        .in('id', missingIds);
      for (const row of rtsPickRows ?? []) {
        selectedProducts.push({
          id: row.id,
          productId: row.product_id,
          title: row.title || '',
          description: '',
          tags: Array.isArray(row.tags) ? row.tags : [],
          price: row.price != null ? parseFloat(String(row.price)) : 0,
          collection: row.product_type || '',
          status: 'draft',
          imageUrl: '',
          factoriesDisplayName: row.vendor || '',
          createdAt: new Date().toISOString(),
          source: 'local',
          variants: [],
          sku: row.sku || undefined,
        } as Product);
      }
    }

    if (selectedProducts.length === 0) {
      console.warn('[uploadToMasterDb] No products selected');
      setIsPublishing(false);
      setSelectedProductIds(new Set());
      return;
    }

    // For readyToPublishList products p.id = RTS row UUID and p.productId = products.id.
    // For products list products p.id = products.id directly.
    // Use productId when available so all downstream queries hit the products table correctly.
    let productsToPublish = selectedProducts;
    let productIdsToPublish = selectedProducts.map(p => (p as any).productId || p.id);

    // Guard: never re-upload products that already have a Shopify ID (force_create
    // would create duplicates on Shopify).
    const { data: alreadyPublished } = await supabase
      .from('products')
      .select('id, shopify_product_id')
      .in('id', productIdsToPublish)
      .not('shopify_product_id', 'is', null);
    if (alreadyPublished?.length) {
      const blocked = new Set(alreadyPublished.map((p: { id: string }) => p.id));
      toast.error('部分產品已在 Shopify', {
        description: `${blocked.size} 個產品已有 Shopify ID，已跳過以避免重複上傳。`,
      });
      productsToPublish = selectedProducts.filter(
        (p) => !blocked.has((p as any).productId || p.id),
      );
      productIdsToPublish = productsToPublish.map((p) => (p as any).productId || p.id);
      if (productIdsToPublish.length === 0) {
        setIsPublishing(false);
        setSelectedProductIds(new Set());
        return;
      }
    }

    // Save products to local DB first to ensure consistency.
    // RTS products have productId != id — skip them here; they're already in the products table.
    const productsToSave = productsToPublish.filter(p => !(p as any).productId);
    try {
      if (productsToSave.length > 0) await saveProductsToDb(productsToSave);
      console.log('[uploadToMasterDb] Pre-upload save successful for', productsToSave.length, 'products');
    } catch (saveErr) {
      console.error('[uploadToMasterDb] Pre-upload save failed:', saveErr);
      // Try individual upserts as fallback
      for (const p of productsToSave) {
        try {
          await supabase.from('products').upsert({
            id: p.id,
            title: p.title,
            description: p.description,
            description_html: p.descriptionHtml || p.description,
            tags: p.tags,
            price: p.price,
            compare_at_price: p.compareAtPrice || null,
            collection: p.collection,
            status: p.status,
            image_url: p.imageUrl,
            error_message: p.errorMessage || null,
            shopify_product_id: p.shopifyProductId || null,
            sku: p.sku || '',
            created_at: p.createdAt,
            source: p.source || 'local',
            synced_at: p.syncedAt || null,
            factories_display_name: p.factoriesDisplayName || '',
            factory_id: p.factoryId || '',
            bwf_master_id: p.bwfMasterId || null,
            cost_price: p.costPrice ?? null,
            sale_price: p.salePrice ?? 0,
            production_date: p.productionLeadTime ?? null,
            shipping_days: p.shippingDays ?? null,
            shipping_fee: p.shippingFee ?? null,
            remarks: p.remarks || '',
            color: p.color || '',
            delivery_term_id: p.deliveryTermId || null,
            delivery_term_name: p.deliveryTermName || null,
          }, { onConflict: 'id' });
        } catch (individualErr) {
          console.error(`[uploadToMasterDb] Individual save failed for "${p.title}":`, individualErr);
        }
      }
    }

    // Set products to "publishing" status
    setProducts(prev => prev.map(p =>
      productIdsToPublish.includes(p.id) ? { ...p, status: 'publishing' as ProductStatus } : p
    ));

    const { error: statusErr } = await supabase
      .from('products')
      .update({ status: 'publishing' })
      .in('id', productIdsToPublish);

    if (statusErr) {
      console.error('[uploadToMasterDb] Failed to set publishing status in DB:', statusErr.message);
    }

    // Fetch ready_to_shopify rows for the selected products to get the
    // finalised title, body_html, price, image_url, images, variants.
    const { data: rtsRows, error: rtsErr } = await supabase
      .from('ready_to_shopify')
      .select('id,product_id,title,body_html,vendor,price,image_url,images,variants,product_type,tags,shopify_url,shopify_page_title,shopify_page_description,dimension_l_mm,dimension_w_mm,dimension_h_mm,material,"my_fields.materials",customize,sku')
      .in('product_id', productIdsToPublish);
    if (rtsErr) {
      console.warn('[publishToShopify] ready_to_shopify fetch error:', rtsErr.message);
    }
    const rtsMap = new Map<string, any>((rtsRows || []).map((r: any) => [r.product_id, r]));

    // Build payload for publish-to-shopify edge function.
    // Content fields (title, description, price, images, variants) come from
    // ready_to_shopify; meta fields (vendor, category, dimensions, etc.) come
    // from the products state.
    const payload = productsToPublish.map(p => {
      // productId is the products table UUID; for readyToPublishList p.id is the RTS UUID
      const productId = (p as any).productId || p.id;
      const rts = rtsMap.get(productId);
      // Merge tags from both tables, deduplicated
      const rtsTags: string[] = Array.isArray(rts?.tags) ? rts.tags : (typeof rts?.tags === 'string' && rts.tags ? rts.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);
      const productTags: string[] = Array.isArray(p.tags) ? p.tags : [];
      const mergedTags = Array.from(new Set([...productTags, ...rtsTags]));
      // Build additional images list from RTS (exclude primary to avoid duplicate)
      const primaryUrl: string = rts?.image_url || p.imageUrl || '';
      const additionalImages: { src: string }[] = [];
      if (Array.isArray(rts?.images)) {
        for (const im of rts.images) {
          const src: string = im?.src || im?.url || (typeof im === 'string' ? im : '');
          if (src && src !== primaryUrl) additionalImages.push({ src });
        }
      } else if (Array.isArray((p as any).images)) {
        for (const im of (p as any).images) {
          const src: string = im?.src || im?.url || (typeof im === 'string' ? im : '');
          if (src && src !== primaryUrl) additionalImages.push({ src });
        }
      }

      // ── Build metafields from ready_to_shopify fields (variant-less mapping) ──
      // 準備上載 always force-creates a brand-new Shopify product, so always
      // derive metafields fresh from the RTS row per the agreed mapping.
      const productTitle = rts?.title || p.title || '';
      let metafields: Record<string, string> | undefined;
      if (rts) {
        const mf: Record<string, string> = {};
        // normal_size: "{L}(W)x{W}(D)x{H}(H)(mm)" — only when all three dims present
        const L = rts.dimension_l_mm, W = rts.dimension_w_mm, H = rts.dimension_h_mm;
        if (L != null && W != null && H != null) {
          mf['my_fields.normal_size'] = `${L}(W)x${W}(D)x${H}(H)(mm)`;
        }
        // 產品物料 → my_fields.materials. Prefer the dedicated metafield column
        // (edited on 產品信息頁), fall back to the legacy `material` column.
        const materialsVal = (rts['my_fields.materials'] ?? rts.material ?? '');
        if (materialsVal && String(materialsVal).trim()) mf['my_fields.materials'] = String(materialsVal).trim();
        if (rts.customize && String(rts.customize).trim()) mf['my_fields.production_time'] = String(rts.customize).trim();
        // more_image_link_1..4 ← all RTS image URLs in order (primary first, then extras),
        // capped at 4; any beyond the 4th are dropped per spec.
        // more_image_alt_1..4 ← product title (one alt per populated link).
        const allImageUrls: string[] = [];
        if (primaryUrl) allImageUrls.push(primaryUrl);
        for (const im of additionalImages) allImageUrls.push(im.src);
        for (let i = 0; i < Math.min(allImageUrls.length, 4); i++) {
          mf[`custom.more_image_link_${i + 1}`] = allImageUrls[i];
          if (productTitle) mf[`custom.more_image_alt_${i + 1}`] = productTitle;
        }
        if (Object.keys(mf).length > 0) metafields = mf;
      }

      // Product SKU comes from ready_to_shopify.sku (falls back to products.sku).
      // Shopify stores SKU on the VARIANT, so seed it into the variant(s): use the
      // existing variants if any (filling a blank sku), otherwise let the edge
      // function create a default variant carrying this sku.
      const productSku: string = (rts?.sku || (p as any).sku || '').toString().trim();
      const rawVariants = (rts?.variants && rts.variants.length > 0)
        ? rts.variants
        : ((p.variants && p.variants.length > 0) ? p.variants : []);
      const variants = rawVariants.map((v: any) => ({ ...v, sku: (v?.sku && String(v.sku).trim()) || productSku }));

      return {
        id: productId,
        rts_id: rts?.id || undefined,
        handle: rts?.shopify_url || undefined,
        shopify_page_title: rts?.shopify_page_title || rts?.title || p.title || undefined,
        shopify_page_description: rts?.shopify_page_description || undefined,
        title: rts?.title || p.title,
        description_html: rts?.body_html || p.descriptionHtml || p.description || '',
        tags: mergedTags,
        price: rts?.price ?? p.salePrice ?? p.price ?? 0,
        compare_at_price: p.compareAtPrice ?? null,
        image_url: primaryUrl,
        images: additionalImages,
        shopify_product_id: p.shopifyProductId || null,
        // Top-level sku so the edge function can stamp it onto the default
        // variant when no explicit variants exist.
        sku: productSku,
        variants,
        vendor: rts?.vendor || p.factoriesDisplayName || p.factoryName || '',
        product_type: rts?.product_type || '',
        factory_name: p.factoriesDisplayName || p.factoryName || '',
        cost_price: p.costPrice ?? null,
        sale_price: rts?.price ?? p.salePrice ?? 0,
        metafields,
      };
    });

    setPublishProgress({ succeeded: 0, total: payload.length });

    let successCount = 0;
    let errorCount = 0;
    let firstErr: string | undefined;

    // Upload one product per edge-function call. A single bulk invoke easily
    // exceeds the 60s client fetch timeout for multi-select uploads, which
    // left products on Shopify (server finished) but stuck on 準備上載 (client
    // never processed results / never cleared furniture_group_checked).
    try {
      console.log(`[publishToShopify] Uploading ${payload.length} product(s) sequentially`);

      for (let i = 0; i < payload.length; i++) {
        const item = payload[i];
        const matchedProduct = productsToPublish.find(
          p => ((p as any).productId || p.id) === item.id
        );
        const rtsUuid = matchedProduct?.id ?? item.rts_id;

        const { data, error } = await supabase.functions.invoke('supabase-functions-publish-to-shopify', {
          body: { products: [item], force_create: true },
        });

        console.log(`[publishToShopify] [${i + 1}/${payload.length}] response — data:`, JSON.stringify(data), 'error:', error);

        if (error) {
          let detailedMsg = error.message || 'Unknown error';
          if (error.name === 'FunctionsHttpError') {
            try {
              const ctx = (error as any).context;
              if (ctx && typeof ctx.json === 'function') {
                const errorBody = await ctx.json();
                if (errorBody?.error) {
                  detailedMsg = errorBody.error + (errorBody.hint ? ` — ${errorBody.hint}` : '');
                }
              } else if (ctx && typeof ctx.text === 'function') {
                const rawText = await ctx.text();
                try {
                  const errorBody = JSON.parse(rawText);
                  if (errorBody?.error) detailedMsg = errorBody.error;
                } catch { /* not JSON */ }
              }
            } catch { /* ignore parse errors */ }
          } else if (error.name === 'FunctionsRelayError') {
            detailedMsg = 'Edge function failed to start. It may have a deployment issue. Please check Settings and try again.';
          }

          errorCount++;
          if (!firstErr) firstErr = detailedMsg;
          await supabase
            .from('products')
            .update({ status: 'error', error_message: detailedMsg })
            .eq('id', item.id);
          setProducts(prev => prev.map(p =>
            p.id === item.id ? { ...p, status: 'error' as ProductStatus, errorMessage: detailedMsg } : p
          ));
        } else if (data?.results?.length) {
          const result = data.results[0] as {
            id: string; success: boolean; shopify_product_id?: string; error?: string; action?: string;
          };

          if (result.success) {
            successCount++;
            const syncTimestamp = new Date().toISOString();
            await supabase
              .from('products')
              .update({
                status: 'success',
                error_message: null,
                shopify_product_id: result.shopify_product_id || null,
                synced_at: syncTimestamp,
                ready_to_publish: false,
              })
              .eq('id', item.id);

            const newSid = result.shopify_product_id;
            if (newSid) {
              const { error: staleErr } = await supabase
                .from('shopify_products')
                .delete()
                .eq('source_product_id', item.id)
                .neq('shopify_product_id', newSid);
              if (staleErr) {
                console.warn(`[publishToShopify] stale mirror cleanup failed for ${item.id}:`, staleErr.message);
              }
            }

            // Remove from entire 網上發佈 pipeline (delete RTS + clear queue flags).
            const pipelineErr = await removeProductFromPublishPipeline(supabase, item.id);
            if (pipelineErr.rtsError || pipelineErr.productsError) {
              console.warn(
                `[publishToShopify] pipeline cleanup for ${item.id}:`,
                pipelineErr.rtsError || pipelineErr.productsError,
              );
            }

            setReadyToPublishList(prev => prev.filter(p => {
              const pid = (p as any).productId || p.id;
              return pid !== item.id && p.id !== rtsUuid;
            }));
            setProducts(prev => prev.map(p => {
              if (p.id !== item.id && (p as any).productId !== item.id) return p;
              return {
                ...p,
                status: 'success' as ProductStatus,
                shopifyProductId: result.shopify_product_id || p.shopifyProductId,
                errorMessage: undefined,
                syncedAt: syncTimestamp,
              };
            }));
          } else {
            errorCount++;
            if (!firstErr && result.error) firstErr = result.error;
            await supabase
              .from('products')
              .update({ status: 'error', error_message: result.error || 'Unknown error' })
              .eq('id', item.id);
            setProducts(prev => prev.map(p =>
              p.id === item.id
                ? { ...p, status: 'error' as ProductStatus, errorMessage: result.error }
                : p
            ));
          }
        } else if (data?.error) {
          const errMsg = data.error as string;
          errorCount++;
          if (!firstErr) firstErr = errMsg;
          await supabase
            .from('products')
            .update({ status: 'error', error_message: errMsg })
            .eq('id', item.id);
          setProducts(prev => prev.map(p =>
            p.id === item.id ? { ...p, status: 'error' as ProductStatus, errorMessage: errMsg } : p
          ));
        } else {
          const errMsg = 'Unexpected response from upload function. Check console for details.';
          errorCount++;
          if (!firstErr) firstErr = errMsg;
          await supabase
            .from('products')
            .update({ status: 'error', error_message: errMsg })
            .eq('id', item.id);
          console.error('[uploadToMasterDb] Unexpected response format:', JSON.stringify(data));
        }

        setPublishProgress({ succeeded: successCount, total: payload.length });
      }

      if (successCount > 0 && errorCount === 0) {
        toast.success('產品已成功上傳至 Shopify', {
          description: `${successCount} 個產品已成功上傳`,
          duration: 6000,
          action: { label: '前往已上載產品', onClick: () => setCurrentView('listed-products') },
        });
      } else if (successCount > 0 && errorCount > 0) {
        toast.warning(`${successCount} 個成功、${errorCount} 個失敗`, {
          description: firstErr ? `失敗原因：${firstErr.slice(0, 200)}` : '部分產品上傳失敗',
          duration: 12000,
          action: { label: '前往已上載產品', onClick: () => setCurrentView('listed-products') },
        });
      } else if (errorCount > 0) {
        toast.error(`${errorCount} 個產品上傳失敗`, {
          description: firstErr ? firstErr.slice(0, 300) : '請查看控制台了解詳情',
          duration: 12000,
        });
        console.error('[publishToShopify] First product error:', firstErr);
      }
    } catch (err) {
      console.error('[uploadToMasterDb] Unexpected error:', err);
      const errMsg = `Upload error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      toast.error('上傳失敗', { description: errMsg });
    } finally {
      setSelectedProductIds(new Set());
      setIsPublishing(false);
      setPublishProgress(null);
      await reloadProducts();
      await reloadReadyToPublish();
    }
  }, [selectedProductIds, products, readyToPublishList, reloadProducts, reloadReadyToPublish]);

  // Retry upload to Global Master Database (single product)
  const retryPublish = useCallback(async (id: string) => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    setProducts(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'publishing' as ProductStatus } : p
    ));

    await supabase
      .from('products')
      .update({ status: 'publishing' })
      .eq('id', id);

    // Fetch the ready_to_shopify row for this product to get finalised content
    const { data: rtsRetryRows } = await supabase
      .from('ready_to_shopify')
      .select('product_id,title,body_html,price,image_url,images,variants,product_type,tags')
      .eq('product_id', id)
      .maybeSingle();
    const rts = rtsRetryRows as any;
    const rtsTags: string[] = Array.isArray(rts?.tags) ? rts.tags : (typeof rts?.tags === 'string' && rts?.tags ? rts.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);
    const productTags: string[] = Array.isArray(product.tags) ? product.tags : [];
    const mergedTags = Array.from(new Set([...productTags, ...rtsTags]));

    const payload = [{
      id: product.id,
      title: rts?.title || product.title,
      description_html: rts?.body_html || product.descriptionHtml || product.description || '',
      tags: mergedTags,
      price: rts?.price ?? product.salePrice ?? product.price ?? 0,
      compare_at_price: product.compareAtPrice ?? null,
      image_url: rts?.image_url || product.imageUrl || '',
      images: (rts?.images && rts.images.length > 0) ? rts.images : ((product as any).images || []),
      shopify_product_id: product.shopifyProductId || null,
      variants: (rts?.variants && rts.variants.length > 0) ? rts.variants : [],
      vendor: product.factoriesDisplayName || product.factoryName || '',
      product_type: rts?.product_type || '',
      factory_name: product.factoriesDisplayName || product.factoryName || '',
      cost_price: product.costPrice ?? null,
      sale_price: rts?.price ?? product.salePrice ?? 0,
    }];

    try {
      const { data, error } = await supabase.functions.invoke('supabase-functions-publish-to-shopify', {
        body: { products: payload },
      });

      console.log('[retryUpload] Edge function response — data:', JSON.stringify(data), 'error:', error);

      if (error) {
        let detailedMsg = error.message || 'Unknown error';
        if (error.name === 'FunctionsHttpError') {
          try {
            const ctx = (error as any).context;
            if (ctx && typeof ctx.json === 'function') {
              const errorBody = await ctx.json();
              console.error('[retryUpload] Edge function response body:', JSON.stringify(errorBody, null, 2));
              if (errorBody?.error) {
                detailedMsg = errorBody.error + (errorBody.hint ? ` — ${errorBody.hint}` : '');
              }
            } else if (ctx && typeof ctx.text === 'function') {
              const rawText = await ctx.text();
              console.error('[retryUpload] Edge function raw response:', rawText);
              try {
                const errorBody = JSON.parse(rawText);
                if (errorBody?.error) detailedMsg = errorBody.error;
              } catch { /* not JSON */ }
            }
          } catch (_) { /* ignore parse error */ }
        } else if (error.name === 'FunctionsRelayError') {
          detailedMsg = 'Edge function failed to start. Check deployment status.';
        }
        setProducts(prev => prev.map(p => {
          if (p.id !== id) return p;
          return {
            ...p,
            status: 'error' as ProductStatus,
            errorMessage: detailedMsg,
          };
        }));
        toast.error('重試上傳失敗', { description: detailedMsg });
      } else if (data?.results?.[0]) {
        const result = data.results[0] as { id: string; success: boolean; shopify_product_id?: string; error?: string };
        setProducts(prev => prev.map(p => {
          if (p.id !== id) return p;
          return {
            ...p,
            status: result.success ? 'success' as ProductStatus : 'error' as ProductStatus,
            shopifyProductId: result.shopify_product_id || p.shopifyProductId,
            errorMessage: result.success ? undefined : result.error,
          };
        }));
        // Persist status, shopify_product_id, and synced_at to local DB
        if (result.success) {
          const syncTimestamp = new Date().toISOString();
          await supabase
            .from('products')
            .update({
              status: 'success',
              error_message: null,
              shopify_product_id: result.shopify_product_id || null,
              synced_at: syncTimestamp,
              ready_to_publish: false,
            })
            .eq('id', id);
          await removeProductFromPublishPipeline(supabase, id);
          setProducts(prev => prev.map(p =>
            p.id === id ? { ...p, syncedAt: syncTimestamp } : p
          ));
          // Mirror into shopify_products so the product shows up in 已上載產品 page
          await supabase
            .from('shopify_products')
            .upsert({
              shopify_product_id: result.shopify_product_id || product.shopifyProductId || `pending-${product.id}`,
              source_product_id: id,
              title: product.title,
              body_html: product.descriptionHtml || product.description || null,
              vendor: product.factoryName || product.factoriesDisplayName || null,
              product_type: product.collection || null,
              status: 'active',
              published_at: syncTimestamp,
              image_url: product.imageUrl || null,
              images: Array.isArray((product as any).images) ? (product as any).images : [],
              variants: [],
              tags: product.tags ?? [],
              price: product.price ?? null,
              compare_at_price: product.compareAtPrice ?? null,
              shopify_created_at: syncTimestamp,
              shopify_updated_at: syncTimestamp,
              imported_at: syncTimestamp,
            }, { onConflict: 'shopify_product_id' });
          toast.success('產品已成功發佈至 Shopify', {
            action: {
              label: '前往產品目錄',
              onClick: () => setCurrentView('listed-products'),
            },
          });
        } else {
          await supabase
            .from('products')
            .update({ status: 'error', error_message: result.error || 'Unknown error' })
            .eq('id', id);
          toast.error('上傳失敗', { description: result.error });
        }
      }
    } catch (err) {
      setProducts(prev => prev.map(p => {
        if (p.id !== id) return p;
        return {
          ...p,
          status: 'error' as ProductStatus,
          errorMessage: `Retry error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        };
      }));
      toast.error('重試上傳失敗');
    }

    await reloadProducts();
  }, [products, reloadProducts]);

  // Sync/Backup products FROM Shopify — preserves local edits
  const syncFromShopify = useCallback(async () => {
    setIsSyncing(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      console.log('[syncFromShopify] Supabase URL:', supabaseUrl);
      console.log('[syncFromShopify] Invoking edge function: supabase-functions-sync-from-shopify');

      const { data, error } = await supabase.functions.invoke('supabase-functions-sync-from-shopify', {
        body: {
          shopify_access_token: settings.shopifyApiKey || undefined,
          shopify_store_url: settings.shopifyStoreUrl || undefined,
        },
      });

      if (error) {
        console.error('[syncFromShopify] Edge function error:', error.name, error.message);
        
        // For FunctionsHttpError, the context is a Response object — read its body
        let errorBody: Record<string, unknown> | null = null;
        if (error.name === 'FunctionsHttpError') {
          try {
            const ctx = (error as any).context;
            if (ctx && typeof ctx.json === 'function') {
              errorBody = await ctx.json();
              console.error('[syncFromShopify] Edge function response body:', JSON.stringify(errorBody, null, 2));
            } else if (ctx && typeof ctx.text === 'function') {
              const rawText = await ctx.text();
              console.error('[syncFromShopify] Edge function raw response:', rawText);
              try { errorBody = JSON.parse(rawText); } catch { /* not JSON */ }
            }
          } catch (parseErr) {
            console.error('[syncFromShopify] Could not parse error response body:', parseErr);
          }
        } else if (error.name === 'FunctionsRelayError') {
          console.error('[syncFromShopify] FunctionsRelayError — the edge function may have crashed during boot. Check for import errors or missing dependencies.');
        }

        if (errorBody?.error) {
          const hint = errorBody.hint ? ` — ${errorBody.hint}` : '';
          const missing = errorBody.missing_secrets ? ` (missing: ${(errorBody.missing_secrets as string[]).join(', ')})` : '';
          const shopifyErr = errorBody.shopify_error ? ` | Shopify: ${JSON.stringify(errorBody.shopify_error)}` : '';
          throw new Error(`${errorBody.error}${hint}${missing}${shopifyErr}`);
        }

        throw new Error(`Sync failed (${error.name}): ${error.message || 'Unknown edge function error'}`);
      }

      if (data?.error) {
        console.error('[syncFromShopify] API-level error from edge function:', data.error);
        if (data?.hint) console.error('[syncFromShopify] Hint:', data.hint);
        if (data?.missing_secrets) console.error('[syncFromShopify] Missing secrets:', data.missing_secrets);
        if (data?.shopify_error) console.error('[syncFromShopify] Shopify error details:', JSON.stringify(data.shopify_error));
        const hint = data.hint ? ` — ${data.hint}` : '';
        throw new Error(`${data.error}${hint}`);
      }

      console.log('[syncFromShopify] Sync results:', data?.summary);
      setLastSyncTime(new Date().toISOString());

      // Reload products from DB to reflect synced data
      await reloadProducts();

      return data?.summary;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      console.error('[syncFromShopify] Full error:', errorObj);
      console.error('[syncFromShopify] Stack trace:', errorObj.stack);
      
      // Check for common network-level issues
      if (errorObj.message.includes('Failed to fetch') || errorObj.message.includes('NetworkError')) {
        console.error('[syncFromShopify] NETWORK ERROR: The edge function URL may be unreachable. Check CORS and deployment status.');
      }
      
      throw errorObj;
    } finally {
      setIsSyncing(false);
    }
  }, [reloadProducts]);

  // Alias: backupFromShopify = syncFromShopify (explicit backup naming)
  const backupFromShopify = syncFromShopify;

  // Upload all products that have no bwf_master_id to Master DB
  const uploadUnsyncedToMaster = useCallback(async () => {
    const unsyncedProducts = products.filter(p => !p.bwfMasterId && p.source !== 'shopify');
    if (unsyncedProducts.length === 0) {
      toast.info('所有產品均已上傳到 Master DB', { description: '沒有找到未同步的產品' });
      return { total: 0, success: 0, errors: 0 };
    }

    toast.info(`找到 ${unsyncedProducts.length} 個未上傳產品`, { description: '開始批量上傳到 Master DB...' });
    setIsPublishing(true);

    // Set status to publishing for these products
    setProducts(prev => prev.map(p => {
      if (unsyncedProducts.some(u => u.id === p.id)) {
        return { ...p, status: 'publishing' as ProductStatus };
      }
      return p;
    }));

    // Process in batches of 20
    const BATCH_SIZE = 20;
    let totalSuccess = 0;
    let totalErrors = 0;

    for (let i = 0; i < unsyncedProducts.length; i += BATCH_SIZE) {
      const batch = unsyncedProducts.slice(i, i + BATCH_SIZE);
      const payload = batch.map(p => ({
        local_id: p.id,
        master_id: null,
        title: p.title,
        description_html: p.descriptionHtml || p.description,
        description: p.description,
        tags: p.tags,
        price: p.price,
        compare_at_price: p.compareAtPrice || null,
        collection: p.collection,
        image_url: p.imageUrl,
        shopify_product_id: p.shopifyProductId || null,
        category: p.category || p.collection || '',
        factory_name: p.factoryName || p.factoriesDisplayName || '',
        factory_id: p.factoryId || '',
        material: p.material || '',
        dimension_l_mm: p.dimensionLMm || null,
        dimension_w_mm: p.dimensionWMm || null,
        dimension_h_mm: p.dimensionHMm || null,
        cost_price: p.costPrice || null,
        sale_price: p.salePrice ?? 0,
        shopify_price: p.price || 0,
        shopify_compare_at_price: p.shopifyCompareAtPrice || p.compareAtPrice || null,
        delivery_days: p.deliveryDays || null,
        shopify_id: p.shopifyProductId || null,
        production_lead_time: p.productionLeadTime ?? null,
        total_lead_time: (p.productionLeadTime != null && p.shippingDays != null)
          ? (p.productionLeadTime + p.shippingDays)
          : (p.productionLeadTime ?? p.shippingDays ?? null),
        shipping_days: p.shippingDays ?? null,
        shipping_fee: p.shippingFee ?? null,
        remarks: p.remarks || null,
        color: p.color || null,
        factory_highlight: p.factoryHighlight || [],
        delivery_term_id: p.deliveryTermId || null,
        delivery_term_name: p.deliveryTermName || null,
        lifestyle_image_url: p.lifestyleImageUrl || null,
      }));

      try {
        console.log(`[uploadUnsyncedToMaster] Batch ${Math.floor(i / BATCH_SIZE) + 1}: uploading ${batch.length} products...`);
        const { data, error } = await supabase.functions.invoke('supabase-functions-upload-to-master-db', {
          body: { products: payload },
        });

        if (error) {
          console.error(`[uploadUnsyncedToMaster] Batch error:`, error.message);
          totalErrors += batch.length;
          setProducts(prev => prev.map(p => {
            if (batch.some(b => b.id === p.id)) {
              return { ...p, status: 'error' as ProductStatus, errorMessage: error.message };
            }
            return p;
          }));
        } else if (data?.results) {
          const results = data.results as { local_id: string; success: boolean; master_id?: string; error?: string }[];
          const syncTimestamp = new Date().toISOString();

          for (const result of results) {
            if (result.success) {
              totalSuccess++;
              // Update in-memory state
              setProducts(prev => prev.map(p => {
                if (p.id === result.local_id) {
                  return { ...p, bwfMasterId: result.master_id || null, status: 'success' as ProductStatus, syncedAt: syncTimestamp };
                }
                return p;
              }));
              // Persist to local DB
              if (result.master_id) {
                await supabase.from('products').update({
                  bwf_master_id: result.master_id,
                  synced_at: syncTimestamp,
                  status: 'success',
                  error_message: null,
                }).eq('id', result.local_id);
              }
            } else {
              totalErrors++;
              setProducts(prev => prev.map(p => {
                if (p.id === result.local_id) {
                  return { ...p, status: 'error' as ProductStatus, errorMessage: result.error || 'Upload failed' };
                }
                return p;
              }));
              await supabase.from('products').update({
                status: 'error',
                error_message: result.error || 'Upload to master failed',
              }).eq('id', result.local_id);
            }
          }
        }
      } catch (err) {
        console.error(`[uploadUnsyncedToMaster] Batch exception:`, err);
        totalErrors += batch.length;
        setProducts(prev => prev.map(p => {
          if (batch.some(b => b.id === p.id)) {
            return { ...p, status: 'error' as ProductStatus, errorMessage: err instanceof Error ? err.message : 'Unknown error' };
          }
          return p;
        }));
      }

      // Small delay between batches to avoid overwhelming the edge function
      if (i + BATCH_SIZE < unsyncedProducts.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setIsPublishing(false);
    const summary = { total: unsyncedProducts.length, success: totalSuccess, errors: totalErrors };

    if (totalErrors === 0) {
      toast.success(`全部上傳成功！`, { description: `${totalSuccess} 個產品已同步到 Master DB` });
    } else {
      toast.warning(`批量上傳完成`, { description: `成功: ${totalSuccess}, 失敗: ${totalErrors} / 共 ${unsyncedProducts.length} 個` });
    }

    return summary;
  }, [products]);

  const navigateToProduct = useCallback((productId: string) => {
    setFilterProductId(productId);
    setCurrentView('ready-to-publish');
  }, []);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem('app-settings', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(prev => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  }, []);

  const stats = {
    total: totalProductCount || products.length,
    drafts: products.filter(p => p.status === 'draft').length,
    publishing: products.filter(p => p.status === 'publishing').length,
    success: products.filter(p => p.status === 'success').length,
    errors: products.filter(p => p.status === 'error').length,
  };

  return {
    products,
    readyToPublishList,
    settings,
    currentView,
    selectedProductIds,
    filterProductId,
    factoryDetailCode,
    setFactoryDetailCode,
    isDarkMode,
    stats,
    isLoading,
    isSaving,
    isSyncing,
    isPublishing,
    publishProgress,
    hasUnsavedChanges,
    lastSyncTime,
    addProduct,
    addProducts,
    updateProduct,
    updateReadyToPublishTags,
    deleteProduct,
    toggleProductSelection,
    selectAllProducts,
    selectRangeProducts,
    clearSelection,
    publishSelected,
    retryPublish,
    uploadUnsyncedToMaster,
    syncFromShopify,
    backupFromShopify,
    navigateToProduct,
    setCurrentView,
    setFilterProductId,
    updateSettings,
    toggleDarkMode,
    saveProducts,
    reloadProducts,
    reloadReadyToPublish,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;

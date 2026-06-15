import { useState, useCallback, useEffect, useRef } from 'react';
import { Product, ProductVariant, ProductStatus, ProductSource, AppSettings, ViewType } from '@/types/product';
import { supabase } from '@/lib/supabase';
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
    imageUrl: row.image_url,
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

// Save products to Supabase
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
    image_url: p.imageUrl,
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

  const { error: prodErr } = await supabase
    .from('products')
    .upsert(productRows, { onConflict: 'id' });

  if (prodErr) {
    console.error('[Supabase] Error saving products:', prodErr);
    throw prodErr;
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

  if (allVariants.length > 0) {
    const { error: varErr } = await supabase
      .from('product_variants')
      .insert(allVariants);

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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [totalProductCount, setTotalProductCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [readyToPublishList, setReadyToPublishList] = useState<Product[]>([]);
  const initialLoadDone = useRef(false);

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
        const PAGE_LIMIT = 100;

        // Run count (estimated — uses planner stats, far faster than 'exact'
        // on a large table) and the product page IN PARALLEL so they don't
        // block each other.
        const countPromise = supabase
          .from('products')
          .select('id', { count: 'estimated', head: true });
        const dataPromise = supabase
          .from('products')
          .select('*')
          .order('created_at', { ascending: false })
          .range(0, PAGE_LIMIT - 1);

        const [{ count: totalCount }, { data: productRows, error: prodErr }] =
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
  const reloadReadyToPublish = useCallback(async () => {
    try {
      // ── Step 1: lightweight RTS fetch (no image_url/images) ───────────────
      const PAGE = 200;
      let allRows: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('ready_to_shopify')
          .select('id,product_id,title,body_html,vendor,product_type,variants,tags,price,compare_at_price,shopify_product_id,status')
          .range(from, from + PAGE - 1);
        if (error) { console.warn('[reloadReadyToPublish] query error:', error.message); break; }
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }

      if (allRows.length === 0) { setReadyToPublishList([]); return; }

      const rowToProduct = (row: any, extra?: any): Product => {
        const variants: ProductVariant[] = Array.isArray(row.variants) && row.variants.length > 0
          ? row.variants.map((v: any) => ({
              id: String(v.id ?? Math.random().toString(36).slice(2)),
              sku: v.sku ?? '',
              price: typeof v.price === 'number' ? v.price : parseFloat(v.price) || 0,
              size: v.option1 ?? v.title ?? '',
              color: v.option2 ?? '',
              inventory: v.inventory_quantity ?? 0,
            }))
          : [];
        // tags: prefer products table (has real tags), fallback to RTS
        const rawTags = extra?.tags ?? row.tags;
        const tags: string[] = Array.isArray(rawTags)
          ? rawTags
          : typeof rawTags === 'string' && rawTags
            ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
            : [];
        return {
          id: row.id,
          title: row.title || '',
          description: row.body_html || '',
          descriptionHtml: row.body_html || '',
          tags,
          price: row.price != null ? parseFloat(row.price) : 0,
          compareAtPrice: row.compare_at_price != null ? parseFloat(row.compare_at_price) : undefined,
          collection: row.product_type || '',
          status: 'draft' as ProductStatus,
          imageUrl: '',
          shopifyProductId: row.shopify_product_id || null,
          factoriesDisplayName: row.vendor || '',
          createdAt: new Date().toISOString(),
          source: 'local' as ProductSource,
          variants,
          readyToPublish: true,
          // Fields from products table (populated in step 2)
          sku: extra?.sku ?? undefined,
          costPrice: extra?.cost_price != null ? parseFloat(extra.cost_price) : null,
          salePrice: extra?.sale_price != null ? parseFloat(extra.sale_price) : 0,
          dimensionLMm: extra?.dimension_l_mm ?? null,
          dimensionWMm: extra?.dimension_w_mm ?? null,
          dimensionHMm: extra?.dimension_h_mm ?? null,
          category: extra?.category ?? undefined,
          material: extra?.material ?? '',
          factoryId: extra?.factory_id ?? null,
          bwfMasterId: extra?.bwf_master_id ?? null,
          productionLeadTime: extra?.production_date ?? null,
          shippingDays: extra?.shipping_days ?? null,
          shippingFee: extra?.shipping_fee ?? null,
          remarks: extra?.remarks ?? null,
        } as Product;
      };

      // Render list immediately (no SKU/cost/images yet)
      const loaded = allRows.map(row => rowToProduct(row));
      setReadyToPublishList(loaded);
      console.log(`[reloadReadyToPublish] Loaded ${loaded.length} products (enrichment pending)`);

      // ── Step 2: fetch products rows for SKU/cost/dimensions/tags ──────────
      const productIds = allRows.map((r: any) => r.product_id).filter(Boolean);
      const PROD_BATCH = 100;
      const productMap: Record<string, any> = {};
      for (let i = 0; i < productIds.length; i += PROD_BATCH) {
        const { data: pRows } = await supabase
          .from('products')
          .select('id,sku,cost_price,sale_price,dimension_l_mm,dimension_w_mm,dimension_h_mm,tags,category,material,factory_id,bwf_master_id,production_date,shipping_days,shipping_fee,remarks')
          .in('id', productIds.slice(i, i + PROD_BATCH));
        (pRows || []).forEach((p: any) => { productMap[p.id] = p; });
      }

      // Build rtsId → productId map
      const rtsToProductId: Record<string, string> = {};
      allRows.forEach((r: any) => { if (r.product_id) rtsToProductId[r.id] = r.product_id; });

      setReadyToPublishList(prev =>
        prev.map(p => {
          const prodId = rtsToProductId[p.id];
          const extra = prodId ? productMap[prodId] : null;
          if (!extra) return p;
          const rawTags = extra.tags;
          const tags: string[] = Array.isArray(rawTags) ? rawTags
            : typeof rawTags === 'string' && rawTags
              ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
              : p.tags;
          return {
            ...p,
            tags,
            sku: extra.sku || p.sku,
            costPrice: extra.cost_price != null ? parseFloat(extra.cost_price) : p.costPrice,
            salePrice: extra.sale_price != null ? parseFloat(extra.sale_price) : p.salePrice,
            dimensionLMm: extra.dimension_l_mm ?? p.dimensionLMm,
            dimensionWMm: extra.dimension_w_mm ?? p.dimensionWMm,
            dimensionHMm: extra.dimension_h_mm ?? p.dimensionHMm,
            category: extra.category || p.category,
            material: extra.material || p.material,
            factoryId: extra.factory_id || p.factoryId,
            bwfMasterId: extra.bwf_master_id || p.bwfMasterId,
            productionLeadTime: extra.production_date ?? p.productionLeadTime,
            shippingDays: extra.shipping_days ?? p.shippingDays,
            shippingFee: extra.shipping_fee ?? p.shippingFee,
            remarks: extra.remarks ?? p.remarks,
          };
        })
      );
      console.log(`[reloadReadyToPublish] SKU/cost/dimensions patched`);

      // ── Step 3: patch images in background batches of 20 ──────────────────
      const IMG_BATCH = 20;
      const rtsIds = allRows.map((r: any) => r.id);
      for (let i = 0; i < rtsIds.length; i += IMG_BATCH) {
        const batchIds = rtsIds.slice(i, i + IMG_BATCH);
        const { data: imgRows } = await supabase
          .from('ready_to_shopify')
          .select('id,image_url,images')
          .in('id', batchIds);
        if (!imgRows || imgRows.length === 0) continue;
        const imgMap: Record<string, { image_url: string; images: any[] }> = {};
        imgRows.forEach((r: any) => { imgMap[r.id] = r; });
        setReadyToPublishList(prev =>
          prev.map(p => {
            const img = imgMap[p.id];
            if (!img) return p;
            const primarySrc: string = img.image_url || '';
            const allImages: { src: string; alt: string }[] = [];
            if (primarySrc) allImages.push({ src: primarySrc, alt: p.title });
            if (Array.isArray(img.images)) {
              for (const im of img.images) {
                const src: string = im?.src || im?.url || (typeof im === 'string' ? im : '');
                if (src && src !== primarySrc) allImages.push({ src, alt: im?.alt || '' });
              }
            }
            return { ...p, imageUrl: primarySrc, images: allImages.length > 0 ? allImages : undefined } as any;
          })
        );
      }
      console.log(`[reloadReadyToPublish] Images patched for all ${allRows.length} products`);
    } catch (err) {
      console.warn('[Supabase] Reload ready-to-publish error:', err);
    }
  }, []);

  const reloadProducts = useCallback(async () => {
    try {
      // Refresh total count
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true });
      setTotalProductCount(count || 0);

      const PAGE_LIMIT = 100;
      const { data: productRows, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })
        .range(0, PAGE_LIMIT - 1);

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

    // Immediately persist to local DB so ListedProductsView can see it
    supabase.from('products').upsert({
      id: newProduct.id,
      title: newProduct.title,
      description: newProduct.description,
      description_html: newProduct.descriptionHtml || newProduct.description,
      tags: newProduct.tags,
      price: newProduct.price,
      compare_at_price: newProduct.compareAtPrice || null,
      collection: newProduct.collection,
      status: newProduct.status,
      image_url: newProduct.imageUrl,
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
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) {
        console.error('[addProduct] Failed to persist to DB:', error.message);
      } else {
        console.log(`[addProduct] ✅ Product ${newProduct.id} persisted to local DB immediately`);
      }
    });

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
    const selectedProducts = dedupedAvailable.filter(p => ids.includes(p.id));

    if (selectedProducts.length === 0) {
      console.warn('[uploadToMasterDb] No products selected');
      setIsPublishing(false);
      setSelectedProductIds(new Set());
      return;
    }

    const selectedProductIds_arr = selectedProducts.map(p => p.id);

    // Save products to local DB first to ensure consistency
    try {
      await saveProductsToDb(selectedProducts);
      console.log('[uploadToMasterDb] Pre-upload save successful for', selectedProducts.length, 'products');
    } catch (saveErr) {
      console.error('[uploadToMasterDb] Pre-upload save failed:', saveErr);
      // Try individual upserts as fallback
      for (const p of selectedProducts) {
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
      selectedProductIds_arr.includes(p.id) ? { ...p, status: 'publishing' as ProductStatus } : p
    ));

    const { error: statusErr } = await supabase
      .from('products')
      .update({ status: 'publishing' })
      .in('id', selectedProductIds_arr);

    if (statusErr) {
      console.error('[uploadToMasterDb] Failed to set publishing status in DB:', statusErr.message);
    }

    // Build payload for publish-to-shopify edge function
    // Field mapping (products → shopify_products / Shopify API):
    //   title              → title / title
    //   descriptionHtml    → body_html / body_html
    //   factoriesDisplayName → vendor / vendor
    //   collection         → product_type / product_type
    //   imageUrl           → image_url / images[0]
    //   images             → images / images (additional)
    //   tags               → tags / tags
    //   price / salePrice  → price / variants[].price
    const payload = selectedProducts.map(p => ({
      id: p.id,
      title: p.title,
      description_html: p.descriptionHtml || p.description || '',
      tags: p.tags || [],
      price: p.salePrice ?? p.price ?? 0,
      compare_at_price: p.compareAtPrice ?? null,
      collection: p.collection || '',
      image_url: p.imageUrl || '',
      // Additional product images (beyond the primary image_url)
      images: (p as any).images || [],
      shopify_product_id: p.shopifyProductId || null,
      variants: (p.variants && p.variants.length > 0) ? p.variants : [],
      // Shopify vendor = factory display name
      vendor: p.factoriesDisplayName || p.factoryName || '',
      // Shopify product_type = collection
      product_type: p.collection || '',
      category: p.category || p.collection || '',
      factory_name: p.factoriesDisplayName || p.factoryName || '',
      material: p.material || '',
      dimension_l_mm: p.dimensionLMm ?? null,
      dimension_w_mm: p.dimensionWMm ?? null,
      dimension_h_mm: p.dimensionHMm ?? null,
      cost_price: p.costPrice ?? null,
      sale_price: p.salePrice ?? 0,
      delivery_days: p.deliveryDays ?? null,
    }));

    try {
      console.log(`[publishToShopify] Calling publish-to-shopify edge function with ${payload.length} products`);
      console.log('[publishToShopify] Payload sample:', JSON.stringify(payload[0], null, 2));

      const { data, error } = await supabase.functions.invoke('supabase-functions-publish-to-shopify', {
        body: { products: payload },
      });

      console.log('[uploadToMasterDb] Edge function response — data:', JSON.stringify(data), 'error:', error);

      if (error) {
        console.error('[uploadToMasterDb] Edge function error:', error.name, error.message);
        
        let detailedMsg = error.message || 'Unknown error';
        if (error.name === 'FunctionsHttpError') {
          try {
            const ctx = (error as any).context;
            if (ctx && typeof ctx.json === 'function') {
              const errorBody = await ctx.json();
              console.error('[uploadToMasterDb] Edge function response body:', JSON.stringify(errorBody, null, 2));
              if (errorBody?.error) {
                detailedMsg = errorBody.error + (errorBody.hint ? ` — ${errorBody.hint}` : '');
              }
            } else if (ctx && typeof ctx.text === 'function') {
              const rawText = await ctx.text();
              console.error('[uploadToMasterDb] Edge function raw response:', rawText);
              try {
                const errorBody = JSON.parse(rawText);
                if (errorBody?.error) {
                  detailedMsg = errorBody.error;
                }
              } catch { /* not JSON */ }
            }
          } catch (parseErr) {
            console.error('[uploadToMasterDb] Could not parse error response body:', parseErr);
          }
        } else if (error.name === 'FunctionsRelayError') {
          detailedMsg = 'Edge function failed to start. It may have a deployment issue. Please check Settings and try again.';
        }

        setProducts(prev => prev.map(p => {
          if (!selectedProductIds_arr.includes(p.id)) return p;
          return {
            ...p,
            status: 'error' as ProductStatus,
            errorMessage: detailedMsg,
          };
        }));
        await supabase
          .from('products')
          .update({ status: 'error', error_message: detailedMsg })
          .in('id', selectedProductIds_arr);
      } else if (data?.results) {
        // publish-to-shopify returns results with { id, success, shopify_product_id, error, action }
        const resultsMap = new Map(
          (data.results as { id: string; success: boolean; shopify_product_id?: string; error?: string; action?: string }[])
            .map((r) => [r.id, r])
        );

        const successIds: string[] = [];
        const errorIds: string[] = [];

        setProducts(prev => prev.map(p => {
          const result = resultsMap.get(p.id);
          if (!result) return p;
          if (result.success) {
            successIds.push(p.id);
            return {
              ...p,
              status: 'success' as ProductStatus,
              shopifyProductId: result.shopify_product_id || p.shopifyProductId,
              errorMessage: undefined,
            };
          } else {
            errorIds.push(p.id);
            return {
              ...p,
              status: 'error' as ProductStatus,
              errorMessage: result.error,
            };
          }
        }));

        // Update DB status for successes — persist shopify_product_id + synced_at per product
        const syncTimestamp = new Date().toISOString();
        if (successIds.length > 0) {
          for (const sid of successIds) {
            const result = resultsMap.get(sid);
            await supabase
              .from('products')
              .update({
                status: 'success',
                error_message: null,
                shopify_product_id: result?.shopify_product_id || null,
                synced_at: syncTimestamp,
                ready_to_publish: false,
              })
              .eq('id', sid);
          }
          // Mirror successfully published products into shopify_products so they
          // appear in the 已上載產品 page right away.
          const successProducts = selectedProducts.filter(p => successIds.includes(p.id));
          const shopifyRows = successProducts.map(p => {
            const result = resultsMap.get(p.id);
            const sid = result?.shopify_product_id || p.shopifyProductId || `pending-${p.id}`;
            return {
              shopify_product_id: sid,
              title: p.title,
              body_html: p.descriptionHtml || p.description || null,
              vendor: p.factoryName || p.factoriesDisplayName || null,
              product_type: p.collection || null,
              handle: null,
              status: 'active',
              published_at: syncTimestamp,
              image_url: p.imageUrl || null,
              images: Array.isArray((p as any).images) ? (p as any).images : [],
              variants: [],
              tags: p.tags ?? [],
              price: p.price ?? null,
              compare_at_price: p.compareAtPrice ?? null,
              shopify_created_at: syncTimestamp,
              shopify_updated_at: syncTimestamp,
              imported_at: syncTimestamp,
            };
          });
          if (shopifyRows.length > 0) {
            const { error: spErr } = await supabase
              .from('shopify_products')
              .upsert(shopifyRows, { onConflict: 'shopify_product_id' });
            if (spErr) {
              console.warn('[publishToShopify] shopify_products mirror failed:', spErr.message);
            }
          }
          // Update local state synced_at as well
          setProducts(prev => prev.map(p => {
            if (!successIds.includes(p.id)) return p;
            return { ...p, syncedAt: syncTimestamp };
          }));
        }
        // Update DB status for errors
        if (errorIds.length > 0) {
          for (const eid of errorIds) {
            const result = resultsMap.get(eid);
            await supabase
              .from('products')
              .update({ status: 'error', error_message: result?.error || 'Unknown error' })
              .eq('id', eid);
          }
        }

        console.log('[uploadToMasterDb] Results:', data.summary);

        // Show success toast and navigate to product catalog
        if (data.summary) {
          const { success: sCount, errors: eCount } = data.summary;
          if (sCount > 0 && eCount === 0) {
            toast.success('產品已成功發佈至 Shopify', {
              description: `${sCount} 個產品已上傳 — 正在前往產品目錄`,
              duration: 4000,
            });
            // Auto-navigate to the product catalog view after a short delay
            setTimeout(() => {
              setCurrentView('listed-products');
            }, 1200);
          } else if (sCount > 0 && eCount > 0) {
            toast.warning('部分產品上傳成功', {
              description: `${sCount} 成功, ${eCount} 失敗`,
              action: {
                label: '前往產品目錄',
                onClick: () => setCurrentView('listed-products'),
              },
            });
          } else {
            // Surface the actual first error from the edge function so the
            // root cause (token / scope / Shopify API) is visible to the user.
            const firstErr = (data.results as { success: boolean; error?: string }[])
              .find((r) => !r.success && r.error)?.error;
            toast.error('上傳失敗', {
              description: firstErr
                ? `${eCount} 個產品上傳失敗：${firstErr.slice(0, 300)}`
                : `${eCount} 個產品上傳失敗`,
              duration: 12000,
            });
            console.error('[publishToShopify] First product error:', firstErr);
            console.error('[publishToShopify] All results:', JSON.stringify(data.results, null, 2));
          }
        }
      } else if (data?.error) {
        const errMsg = data.error as string;
        console.error('[uploadToMasterDb] Edge function returned error in body:', errMsg);
        setProducts(prev => prev.map(p => {
          if (!selectedProductIds_arr.includes(p.id)) return p;
          return {
            ...p,
            status: 'error' as ProductStatus,
            errorMessage: errMsg,
          };
        }));
        await supabase
          .from('products')
          .update({ status: 'error', error_message: errMsg })
          .in('id', selectedProductIds_arr);
        toast.error('上傳失敗', { description: errMsg });
      } else {
        console.error('[uploadToMasterDb] Unexpected response format:', JSON.stringify(data));
        setProducts(prev => prev.map(p => {
          if (!selectedProductIds_arr.includes(p.id)) return p;
          return {
            ...p,
            status: 'error' as ProductStatus,
            errorMessage: 'Unexpected response from upload function. Check console for details.',
          };
        }));
        toast.error('上傳失敗', { description: '回應格式異常，請查看控制台' });
      }
    } catch (err) {
      console.error('[uploadToMasterDb] Unexpected error:', err);
      const errMsg = `Upload error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      setProducts(prev => prev.map(p => {
        if (!selectedProductIds_arr.includes(p.id)) return p;
        return {
          ...p,
          status: 'error' as ProductStatus,
          errorMessage: errMsg,
        };
      }));
      toast.error('上傳失敗', { description: errMsg });
    } finally {
      setSelectedProductIds(new Set());
      setIsPublishing(false);
      await reloadProducts();
    }
  }, [selectedProductIds, products, readyToPublishList, reloadProducts]);

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

    const payload = [{
      id: product.id,
      title: product.title,
      description_html: product.descriptionHtml || product.description || '',
      tags: product.tags || [],
      price: product.price ?? 0,
      compare_at_price: product.compareAtPrice ?? null,
      collection: product.collection || '',
      image_url: product.imageUrl || '',
      shopify_product_id: product.shopifyProductId || null,
      variants: [],
      category: product.category || product.collection || '',
      factory_name: product.factoryName || product.factoriesDisplayName || '',
      material: product.material || '',
      dimension_l_mm: product.dimensionLMm ?? null,
      dimension_w_mm: product.dimensionWMm ?? null,
      dimension_h_mm: product.dimensionHMm ?? null,
      cost_price: product.costPrice ?? null,
      sale_price: product.salePrice ?? 0,
      delivery_days: product.deliveryDays ?? null,
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
          setProducts(prev => prev.map(p =>
            p.id === id ? { ...p, syncedAt: syncTimestamp } : p
          ));
          // Mirror into shopify_products so the product shows up in 已上載產品 page
          await supabase
            .from('shopify_products')
            .upsert({
              shopify_product_id: result.shopify_product_id || product.shopifyProductId || `pending-${product.id}`,
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
    hasUnsavedChanges,
    lastSyncTime,
    addProduct,
    addProducts,
    updateProduct,
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

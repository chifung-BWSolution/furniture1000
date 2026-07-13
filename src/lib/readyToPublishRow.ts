import type { Product, ProductSource, ProductStatus, ProductVariant } from '@/types/product';
import { supabase } from '@/lib/supabase';

const RTS_LIST_SELECT = `
  id, product_id, title, image_url, vendor, product_type, variants, tags, price, compare_at_price, shopify_product_id, sku,
  products (
    id, sku, model, factory_id, cost_price, sale_price, image_url,
    dimension_l_mm, dimension_w_mm, dimension_h_mm,
    category, material, factories_display_name,
    level1_category, level2_category, in_stock, customize,
    shipping_days, shipping_fee, remarks, production_date, bwf_master_id, tags
  )
`;

/** Fetch ready_to_shopify rows by RTS UUID (for server-paginated selection resolve). */
export async function fetchReadyToPublishProductsByRtsIds(rtsIds: string[]): Promise<Product[]> {
  if (rtsIds.length === 0) return [];
  const { data, error } = await supabase
    .from('ready_to_shopify')
    .select(RTS_LIST_SELECT)
    .in('id', rtsIds);
  if (error) {
    console.warn('[fetchReadyToPublishProductsByRtsIds]', error.message);
    return [];
  }
  return (data ?? []).map((row) => mapReadyToPublishRow(row as Record<string, unknown>));
}

/** Resolve selected products from in-memory lists, fetching any missing RTS rows from DB. */
export async function resolveSelectedPublishProducts(
  selectedIds: string[],
  inMemory: Product[] = [],
): Promise<Product[]> {
  if (selectedIds.length === 0) return [];
  const seen = new Set<string>();
  const found = inMemory.filter((p) => {
    if (!selectedIds.includes(p.id) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  const missingIds = selectedIds.filter((id) => !found.some((p) => p.id === id));
  const fetched = missingIds.length > 0
    ? await fetchReadyToPublishProductsByRtsIds(missingIds)
    : [];
  const byId = new Map<string, Product>();
  for (const p of [...found, ...fetched]) byId.set(p.id, p);
  return selectedIds.map((id) => byId.get(id)).filter((p): p is Product => !!p);
}

/** Map lightweight ready_to_shopify RPC row → Product for 準備上載 table. */
export function mapReadyToPublishRow(row: Record<string, unknown>): Product {
  const p = (row.products ?? {}) as Record<string, unknown>;
  const variants: ProductVariant[] = Array.isArray(row.variants) && row.variants.length > 0
    ? (row.variants as any[]).map((v) => ({
        id: String(v.id ?? Math.random().toString(36).slice(2)),
        sku: v.sku ?? '',
        price: typeof v.price === 'number' ? v.price : parseFloat(v.price) || 0,
        size: v.option1 ?? v.title ?? '',
        color: v.option2 ?? '',
        inventory: v.inventory_quantity ?? 0,
        option1: v.option1 ?? v.title ?? '',
        imageSrc: v.image_src ?? null,
      }))
    : [];

  const rawTags = row.tags ?? p.tags;
  const tags: string[] = Array.isArray(rawTags)
    ? rawTags as string[]
    : typeof rawTags === 'string' && rawTags
      ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : [];

  // RTS image_url is canonical; fall back to products.image_url when copywriting
  // only populated images[] (extras) but primary lives on the catalog row.
  const rtsImg = typeof row.image_url === 'string' ? row.image_url.trim() : '';
  const prodImg = typeof p.image_url === 'string' ? p.image_url.trim() : '';
  const imageUrl = rtsImg || prodImg;

  return {
    id: String(row.id),
    productId: row.product_id ? String(row.product_id) : undefined,
    title: String(row.title || ''),
    description: '',
    descriptionHtml: '',
    tags,
    price: row.price != null ? parseFloat(String(row.price)) : 0,
    compareAtPrice: row.compare_at_price != null ? parseFloat(String(row.compare_at_price)) : undefined,
    collection: String(row.product_type || ''),
    status: 'draft' as ProductStatus,
    imageUrl,
    shopifyProductId: row.shopify_product_id ? String(row.shopify_product_id) : null,
    factoriesDisplayName: String(row.vendor || p.factories_display_name || ''),
    createdAt: new Date().toISOString(),
    source: 'local' as ProductSource,
    variants,
    readyToPublish: true,
    sku: (p.sku ?? row.sku) ? String(p.sku ?? row.sku) : undefined,
    costPrice: p.cost_price != null ? parseFloat(String(p.cost_price)) : null,
    salePrice: p.sale_price != null ? parseFloat(String(p.sale_price)) : 0,
    dimensionLMm: (p.dimension_l_mm as number | null) ?? null,
    dimensionWMm: (p.dimension_w_mm as number | null) ?? null,
    dimensionHMm: (p.dimension_h_mm as number | null) ?? null,
    category: p.category ? String(p.category) : undefined,
    material: p.material ? String(p.material) : '',
    factoryId: p.factory_id ? String(p.factory_id) : null,
    bwfMasterId: p.bwf_master_id ? String(p.bwf_master_id) : null,
    productionLeadTime: p.production_date != null ? Number(p.production_date) || null : null,
    shippingDays: (p.shipping_days as number | null) ?? null,
    shippingFee: (p.shipping_fee as number | null) ?? null,
    remarks: (p.remarks as string | null) ?? null,
    level1Category: p.level1_category ? String(p.level1_category) : null,
    level2Category: p.level2_category ? String(p.level2_category) : null,
    inStock: p.in_stock != null ? Boolean(p.in_stock) : null,
    customize: (p.customize as string | null) ?? null,
  } as Product;
}

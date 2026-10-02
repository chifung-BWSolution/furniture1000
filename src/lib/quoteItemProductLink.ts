/**
 * Link bwf_quote_item lines to products.id (nanoid FK).
 * A 類 Shopify catalog uses shopify_products.source_product_id, never mirror row UUID.
 */
import { supabase } from '@/lib/supabase';
import type { BwfQuoteItemInput } from '@/lib/bwfQuoteItems';
import type { CatalogProductRow } from '@/lib/productCatalogQuery';
import type { ProductForDetail } from '@/components/dashboard/ProductDetailModal';
import type { FactoryItem } from '@/lib/factorySupabase';
import { materialPlainText } from '@/lib/quotationMaterialHtml';
import { isHttpImageUrl } from '@/lib/imageStorage';

function normSku(s: string | null | undefined): string {
  return (s || '').trim().toUpperCase();
}

function normTitle(s: string | null | undefined): string {
  return (s || '').trim();
}

/** Catalog picker row → products.id for quote line FK. */
export function productIdFromCatalogRow(row: CatalogProductRow): string | null {
  const id = (row.productId || '').trim();
  return id || null;
}

/**
 * Shopify mirror rows sometimes lack source_product_id on the merged catalog row.
 * Parse `shopify:${mirrorUuid}` and read source_product_id from DB.
 */
export async function fetchShopifyMirrorSourceProductId(
  catalogRowId: string,
): Promise<string | null> {
  const prefix = 'shopify:';
  if (!catalogRowId.startsWith(prefix)) return null;
  const mirrorId = catalogRowId.slice(prefix.length).trim();
  if (!mirrorId) return null;

  const { data, error } = await supabase
    .from('shopify_products')
    .select('source_product_id')
    .eq('id', mirrorId)
    .maybeSingle();

  if (error) {
    console.warn('[quoteItemProductLink] mirror source_product_id lookup failed', error.message);
    return null;
  }
  const pid = (data?.source_product_id as string | null)?.trim();
  return pid || null;
}

/** Resolve productId for catalog picks (includes phase-2 mirror fetch when needed). */
export async function resolveProductIdForCatalogPick(
  row: CatalogProductRow,
): Promise<string | null> {
  const direct = productIdFromCatalogRow(row);
  if (direct) return direct;
  if (row.sourceKind === 'shopify') {
    return fetchShopifyMirrorSourceProductId(row.id);
  }
  return null;
}

type SkuTitleMaps = {
  bySku: Map<string, string>;
  byTitle: Map<string, string>;
};

async function loadUniqueSkuAndTitleMaps(): Promise<SkuTitleMaps> {
  const bySku = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const skuCounts = new Map<string, number>();
  const titleCounts = new Map<string, number>();
  const skuWinner = new Map<string, string>();
  const titleWinner = new Map<string, string>();

  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, title')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      const id = String(r.id || '').trim();
      if (!id) continue;
      const sku = normSku(r.sku as string | null);
      if (sku) {
        skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
        skuWinner.set(sku, id);
      }
      const title = normTitle(r.title as string | null);
      if (title) {
        titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
        titleWinner.set(title, id);
      }
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  for (const [sku, count] of skuCounts) {
    if (count === 1) {
      const id = skuWinner.get(sku);
      if (id) bySku.set(sku, id);
    }
  }
  for (const [title, count] of titleCounts) {
    if (count === 1) {
      const id = titleWinner.get(title);
      if (id) byTitle.set(title, id);
    }
  }

  return { bySku, byTitle };
}

let mapsCache: Promise<SkuTitleMaps> | null = null;

function getUniqueSkuTitleMaps(): Promise<SkuTitleMaps> {
  if (!mapsCache) mapsCache = loadUniqueSkuAndTitleMaps();
  return mapsCache;
}

/** Infer products.id from unique sku, then unique name=title (never overwrites productId). */
export async function hydrateProductIdsForQuoteItems<
  T extends BwfQuoteItemInput,
>(items: T[]): Promise<T[]> {
  const needs = items.some(
    (item) =>
      !item.isSectionTitle &&
      !item.isCustomTerm &&
      !(item.productId || '').trim() &&
      (normSku(item.sku) || normTitle(item.name)),
  );
  if (!needs) return items;

  const { bySku, byTitle } = await getUniqueSkuTitleMaps();
  return items.map((item) => {
    if (item.isSectionTitle || item.isCustomTerm) return item;
    if ((item.productId || '').trim()) return item;

    const sku = normSku(item.sku);
    if (sku) {
      const fromSku = bySku.get(sku);
      if (fromSku) return { ...item, productId: fromSku };
    }

    const title = normTitle(item.name);
    if (title) {
      const fromTitle = byTitle.get(title);
      if (fromTitle) return { ...item, productId: fromTitle };
    }

    return item;
  });
}

/** Clear cached product maps (tests / long sessions). */
export function resetQuoteItemProductLinkCache(): void {
  mapsCache = null;
}

/** Normalize legacy draft JSON field names. */
export function normalizeLegacyQuoteItemProductId(
  item: BwfQuoteItemInput,
): BwfQuoteItemInput {
  const raw = item as BwfQuoteItemInput & { product_id?: string | null };
  const productId =
    (item.productId || '').trim() ||
    (raw.product_id || '').trim() ||
    null;
  if (!productId || productId === item.productId) return item;
  return { ...item, productId };
}

/** Lightweight list columns — never select heavy JSONB `images` on list fetch. */
const PRODUCT_LINK_LIST_COLUMNS = [
  'id',
  'title',
  'description',
  'tags',
  'price',
  'compare_at_price',
  'collection',
  'status',
  'image_url',
  'shopify_product_id',
  'source',
  'synced_at',
  'created_at',
  'color',
  'factory_id',
  'factories_display_name',
  'cost_price',
  'sale_price',
  'production_date',
  'shipping_days',
  'total_lead_time',
  'bwf_master_id',
  'remarks',
  'shipping_fee',
  'category',
  'level1_category',
  'level2_category',
  'material',
  'delivery_term_id',
  'delivery_term_name',
  'dimension_l_mm',
  'dimension_w_mm',
  'dimension_h_mm',
  'in_stock',
  'customize',
  'sku',
].join(',');

function newProductId(): string {
  return Math.random().toString(36).substring(2, 12);
}

/** First integer in freeform quote dimension text (e.g. 2200 or 1000+600). */
export function parseQuoteDimensionMm(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const match = String(value).match(/\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

function mapProductRow(row: Record<string, unknown>): ProductForDetail {
  const price = row.price != null ? parseFloat(String(row.price)) : 0;
  return {
    id: String(row.id),
    title: String(row.title || ''),
    description: String(row.description || ''),
    descriptionHtml: row.description_html ? String(row.description_html) : undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    price: Number.isFinite(price) ? price : 0,
    compareAtPrice:
      row.compare_at_price != null ? parseFloat(String(row.compare_at_price)) : undefined,
    collection: String(row.collection || ''),
    status: String(row.status || 'draft'),
    imageUrl: String(row.image_url || ''),
    images: [],
    shopifyProductId: row.shopify_product_id ? String(row.shopify_product_id) : null,
    source: String(row.source || 'local'),
    syncedAt: row.synced_at ? String(row.synced_at) : null,
    createdAt: String(row.created_at || new Date().toISOString()),
    color: row.color ? String(row.color) : null,
    factoryId: row.factory_id ? String(row.factory_id) : null,
    factoriesDisplayName: row.factories_display_name
      ? String(row.factories_display_name)
      : null,
    costPrice: row.cost_price != null ? parseFloat(String(row.cost_price)) : null,
    productionLeadTime:
      row.production_date != null ? parseInt(String(row.production_date), 10) : null,
    shippingDays: row.shipping_days != null ? parseInt(String(row.shipping_days), 10) : null,
    shippingFee: row.shipping_fee != null ? parseFloat(String(row.shipping_fee)) : null,
    totalLeadTime:
      row.total_lead_time != null ? parseInt(String(row.total_lead_time), 10) : null,
    bwfMasterId: row.bwf_master_id ? String(row.bwf_master_id) : null,
    remarks: row.remarks ? String(row.remarks) : null,
    category: row.category ? String(row.category) : null,
    level1Category: row.level1_category ? String(row.level1_category) : null,
    level2Category: row.level2_category ? String(row.level2_category) : null,
    deliveryTermId: row.delivery_term_id ? String(row.delivery_term_id) : null,
    deliveryTermName: row.delivery_term_name ? String(row.delivery_term_name) : null,
    dimensionLMm: parseQuoteDimensionMm(row.dimension_l_mm as string | number | null),
    dimensionWMm: parseQuoteDimensionMm(row.dimension_w_mm as string | number | null),
    dimensionHMm: parseQuoteDimensionMm(row.dimension_h_mm as string | number | null),
    inStock: row.in_stock != null ? Boolean(row.in_stock) : null,
    customize: row.customize ? String(row.customize) : null,
    sku: row.sku ? String(row.sku) : null,
  };
}

export async function fetchProductForQuoteDetail(
  productId: string,
): Promise<ProductForDetail | null> {
  const id = productId.trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_LINK_LIST_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    console.warn('[fetchProductForQuoteDetail]', error?.message || 'not found');
    return null;
  }
  return mapProductRow(data as unknown as Record<string, unknown>);
}

export type QuoteItemProductSeed = {
  name?: string;
  image?: string;
  sku?: string;
  category?: string;
  material?: string;
  color?: string;
  remarks?: string;
  costPrice?: number | null;
  unitPrice?: number;
  dimensionLMm?: string | number | null;
  dimensionWMm?: string | number | null;
  dimensionHMm?: string | number | null;
  deliveryTermName?: string;
  factoryName?: string;
};

/** Draft product row for ProductDetailModal create mode from a quote line. */
export function buildDraftProductFromQuoteItem(
  item: QuoteItemProductSeed,
  opts?: { id?: string; factoriesWithIds?: FactoryItem[] },
): ProductForDetail {
  const id = opts?.id?.trim() || newProductId();
  const materialText = materialPlainText(item.material);
  const descriptionParts = [materialText, item.remarks?.trim()].filter(Boolean);
  const description = descriptionParts.join('\n\n');
  const imageUrl = isHttpImageUrl(item.image || '') ? item.image!.trim() : '';
  const factoryName = item.factoryName?.trim() || '';
  const factoryMatch = opts?.factoriesWithIds?.find((f) => f.display_name === factoryName);

  return {
    id,
    title: item.name?.trim() || '',
    description,
    descriptionHtml: description,
    tags: [],
    price: typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) ? item.unitPrice : 0,
    collection: item.category?.trim() || '',
    status: 'draft',
    imageUrl,
    images: imageUrl ? [{ src: imageUrl, alt: item.name || '' }] : [],
    shopifyProductId: null,
    source: 'local',
    syncedAt: null,
    createdAt: new Date().toISOString(),
    color: item.color?.trim() || null,
    factoryId: factoryMatch?.factory_id || null,
    factoriesDisplayName: factoryName || null,
    costPrice:
      typeof item.costPrice === 'number' && Number.isFinite(item.costPrice)
        ? item.costPrice
        : null,
    productionLeadTime: null,
    shippingDays: null,
    shippingFee: null,
    totalLeadTime: null,
    bwfMasterId: null,
    remarks: item.remarks?.trim() || null,
    category: item.category?.trim() || null,
    level1Category: null,
    level2Category: null,
    deliveryTermId: null,
    deliveryTermName: item.deliveryTermName?.trim() || null,
    dimensionLMm: parseQuoteDimensionMm(item.dimensionLMm),
    dimensionWMm: parseQuoteDimensionMm(item.dimensionWMm),
    dimensionHMm: parseQuoteDimensionMm(item.dimensionHMm),
    inStock: null,
    customize: null,
    sku: item.sku?.trim() || null,
  };
}

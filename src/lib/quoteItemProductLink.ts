/**
 * Link bwf_quote_item lines to products.id (nanoid FK).
 * A 類 Shopify catalog uses shopify_products.source_product_id, never mirror row UUID.
 */
import { supabase } from '@/lib/supabase';
import type { BwfQuoteItemInput } from '@/lib/bwfQuoteItems';
import type { CatalogProductRow } from '@/lib/productCatalogQuery';

const PRODUCT_ID_CHUNK = 150;

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

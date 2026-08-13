import type { SupabaseClient } from '@supabase/supabase-js';
import { isHttpImageUrl } from '@/lib/imageStorage';
import { stripBase64ForDb } from '@/lib/imageStorage';
import { withUpdateAuditFields } from '@/lib/pmsAudit';
import { parseRtsGalleryUrls, buildRtsImagesJson } from '@/lib/rtsImages';

export type MirrorRowForProductSync = {
  title?: string | null;
  body_html?: string | null;
  image_url?: string | null;
  images?: unknown;
  tags?: string[] | string | null;
  sku?: string | null;
  price?: number | null;
  compare_at_price?: number | null;
  vendor?: string | null;
  product_type?: string | null;
  cost?: number | null;
  'my_fields.materials'?: string | null;
  'my_fields.production_time'?: string | null;
};

export type ProductImagesPatch = {
  image_url: string | null;
  image_url_2: string | null;
  image_url_3: string | null;
  images: { src: string; position: number }[] | null;
};

/** Ordered gallery URLs → products image columns (primary + legacy extras + images[] JSON). */
export function buildProductImagesPatchFromGallery(galleryUrls: string[]): ProductImagesPatch {
  const deduped = galleryUrls.filter((u) => typeof u === 'string' && u.trim().startsWith('http'));
  const primary = deduped[0] || null;
  const extras = deduped.slice(1);
  return {
    image_url: primary,
    image_url_2: extras[0] || null,
    image_url_3: extras[1] || null,
    images: buildRtsImagesJson(extras),
  };
}

/** RTS row or { image_url, images } → products image patch. */
export function buildProductImagesPatchFromRtsRow(row: {
  image_url?: string | null;
  images?: unknown;
}): ProductImagesPatch {
  return buildProductImagesPatchFromGallery(parseRtsGalleryUrls(row));
}

/** Map ready_to_shopify or shopify_products row → products content patch. */
export function mirrorRowToRtsContentPatch(row: MirrorRowForProductSync) {
  const gallery = parseRtsGalleryUrls(row);
  const ptParts = String(row.product_type ?? '').split(' / ');
  const tags = Array.isArray(row.tags)
    ? row.tags
    : typeof row.tags === 'string' && row.tags
      ? row.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

  return {
    title: row.title ?? undefined,
    body_html: row.body_html ?? undefined,
    image_url: gallery[0] || row.image_url || null,
    image_url_2: gallery[1] || null,
    image_url_3: gallery[2] || null,
    images: buildRtsImagesJson(gallery.slice(1)),
    tags,
    sku: row.sku ?? undefined,
    price: row.price ?? undefined,
    sale_price: row.price ?? undefined,
    compare_at_price: row.compare_at_price ?? undefined,
    level1_category: ptParts[0]?.trim() || null,
    level2_category: ptParts[1]?.trim() || null,
    vendor: row.vendor ?? undefined,
    'my_fields.materials': row['my_fields.materials'] ?? undefined,
    customize: row['my_fields.production_time'] ?? undefined,
    cost_price: row.cost === undefined ? undefined : row.cost,
  };
}

/**
 * Sync ready_to_shopify gallery → products image columns.
 * Keeps image_url, image_url_2/3, and images[] aligned whenever publish workflow edits images.
 */
export async function syncRtsGalleryToProduct(
  supabase: SupabaseClient,
  productId: string,
  gallery: { image_url?: string | null; images?: unknown } | string[],
): Promise<void> {
  const patch = Array.isArray(gallery)
    ? buildProductImagesPatchFromGallery(gallery)
    : buildProductImagesPatchFromRtsRow(gallery);
  await syncRtsContentToProduct(supabase, productId, patch);
}

/** Push shopify_products mirror edits → products (same product_id / source_product_id). */
export async function syncShopifyProductToProduct(
  supabase: SupabaseClient,
  sourceProductId: string | null | undefined,
  mirror: MirrorRowForProductSync,
): Promise<void> {
  const productId = (sourceProductId || '').trim();
  if (!productId) return;
  await syncRtsContentToProduct(supabase, productId, mirrorRowToRtsContentPatch(mirror));
}

/**
 * Write 成本 to every related `products` row:
 * source_product_id, products.shopify_product_id, or matching SKU.
 * Variant SKUs get that variant's cost; otherwise the product-level cost.
 */
export async function syncShopifyCostsToProducts(
  supabase: SupabaseClient,
  opts: {
    sourceProductId?: string | null;
    shopifyProductId?: string | null;
    productCost: number | null;
    variantCosts: { sku: string; cost: number | null }[];
  },
): Promise<{ updated: number; error?: string }> {
  const ids = new Set<string>();
  const sourceId = (opts.sourceProductId || '').trim();
  if (sourceId) ids.add(sourceId);

  const shopifyId = String(opts.shopifyProductId || '').trim();
  if (shopifyId) {
    const { data, error } = await supabase
      .from('products')
      .select('id')
      .eq('shopify_product_id', shopifyId);
    if (error) return { updated: 0, error: error.message };
    for (const row of data ?? []) {
      if (row.id) ids.add(String(row.id));
    }
  }

  const skuCost = new Map<string, number | null>();
  for (const row of opts.variantCosts) {
    const sku = (row.sku || '').trim();
    if (!sku) continue;
    skuCost.set(sku, row.cost);
  }
  const skus = [...skuCost.keys()];
  if (skus.length > 0) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku')
      .in('sku', skus);
    if (error) return { updated: 0, error: error.message };
    for (const row of data ?? []) {
      if (row.id) ids.add(String(row.id));
    }
  }

  if (ids.size === 0) return { updated: 0 };

  const { data: linked, error: loadErr } = await supabase
    .from('products')
    .select('id, sku')
    .in('id', [...ids]);
  if (loadErr) return { updated: 0, error: loadErr.message };

  let updated = 0;
  let lastError: string | undefined;
  for (const row of linked ?? []) {
    const sku = typeof row.sku === 'string' ? row.sku.trim() : '';
    const cost = sku && skuCost.has(sku) ? skuCost.get(sku)! : opts.productCost;
    const { error } = await supabase
      .from('products')
      .update(await withUpdateAuditFields({ cost_price: cost }))
      .eq('id', row.id);
    if (error) lastError = error.message;
    else updated += 1;
  }
  return { updated, error: lastError };
}

/** Mirror publish-workflow flags to products (待處理 / 目錄 filters still use products). */
export async function syncRtsWorkflowToProduct(
  supabase: SupabaseClient,
  productId: string,
  flags: {
    in_shopify_queue?: boolean;
    copy_done?: boolean;
    copy_done_at?: string | null;
    copy_queued_at?: string | null;
    info_done?: boolean;
    ready_to_publish?: boolean;
    revert_reason?: { labels: string[]; other: string | null } | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update(await withUpdateAuditFields({ ...flags }))
    .eq('id', productId);
  if (error) console.warn('[rtsProductSync] workflow sync failed:', error.message);
}

/** Push editable RTS content → products so 產品目錄 stays in sync. */
export async function syncRtsContentToProduct(
  supabase: SupabaseClient,
  productId: string,
  patch: {
    title?: string | null;
    body_html?: string | null;
    image_url?: string | null;
    image_url_2?: string | null;
    image_url_3?: string | null;
    images?: { src: string; position?: number }[] | null;
    tags?: string[] | null;
    sku?: string | null;
    price?: number | null;
    sale_price?: number | null;
    level1_category?: string | null;
    level2_category?: string | null;
    dimension_l_mm?: number | null;
    dimension_w_mm?: number | null;
    dimension_h_mm?: number | null;
    in_stock?: boolean | null;
    customize?: string | null;
    material?: string | null;
    'my_fields.materials'?: string | null;
    cost_price?: number | null;
    vendor?: string | null;
    compare_at_price?: number | null;
  },
): Promise<void> {
  const productsPatch: Record<string, unknown> = {};
  if (patch.title != null) productsPatch.title = patch.title;
  if (patch.body_html != null) {
    productsPatch.description = patch.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    productsPatch.description_html = patch.body_html;
  }
  if (patch.image_url !== undefined) productsPatch.image_url = stripBase64ForDb(patch.image_url ?? '') || null;
  if (patch.image_url_2 !== undefined) productsPatch.image_url_2 = stripBase64ForDb(patch.image_url_2 ?? '') || null;
  if (patch.image_url_3 !== undefined) productsPatch.image_url_3 = stripBase64ForDb(patch.image_url_3 ?? '') || null;
  if (patch.images !== undefined) {
    productsPatch.images = Array.isArray(patch.images)
      ? patch.images
          .map((im) => ({ ...im, src: stripBase64ForDb(im.src) }))
          .filter((im) => im.src)
      : patch.images;
  }
  if (patch.tags !== undefined) productsPatch.tags = patch.tags;
  if (patch.sku !== undefined) productsPatch.sku = patch.sku;
  if (patch.sale_price != null) productsPatch.sale_price = patch.sale_price;
  else if (patch.price != null) productsPatch.sale_price = patch.price;
  if (patch.compare_at_price != null && !Number.isNaN(Number(patch.compare_at_price))) {
    productsPatch.compare_at_price = Number(patch.compare_at_price);
  }
  if (patch.vendor != null && String(patch.vendor).trim()) {
    productsPatch.factories_display_name = String(patch.vendor).trim();
  }
  if (patch.level1_category !== undefined) productsPatch.level1_category = patch.level1_category;
  if (patch.level2_category !== undefined) productsPatch.level2_category = patch.level2_category;
  if (patch.dimension_l_mm !== undefined) productsPatch.dimension_l_mm = patch.dimension_l_mm;
  if (patch.dimension_w_mm !== undefined) productsPatch.dimension_w_mm = patch.dimension_w_mm;
  if (patch.dimension_h_mm !== undefined) productsPatch.dimension_h_mm = patch.dimension_h_mm;
  if (patch.in_stock !== undefined) productsPatch.in_stock = patch.in_stock;
  if (patch.customize !== undefined) productsPatch.customize = patch.customize;
  if (patch.material !== undefined) productsPatch.material = patch.material;
  if (patch['my_fields.materials'] !== undefined) productsPatch.material = patch['my_fields.materials'];
  if (patch.cost_price !== undefined) productsPatch.cost_price = patch.cost_price;

  if (Object.keys(productsPatch).length === 0) return;
  const { error } = await supabase
    .from('products')
    .update(await withUpdateAuditFields(productsPatch))
    .eq('id', productId);
  if (error) console.warn('[rtsProductSync] content sync failed:', error.message);
}

/** Flatten ready_to_shopify + embedded products row for publish list UIs. */
export function flattenRtsListRow(r: Record<string, unknown>): Record<string, unknown> {
  const p = (r.products ?? {}) as Record<string, unknown>;
  const ptParts = String(r.product_type ?? '').split(' / ');
  const rtsImg = typeof r.image_url === 'string' ? r.image_url : '';
  const prodImg = typeof p.image_url === 'string' ? p.image_url : '';
  const lightImg = isHttpImageUrl(rtsImg) ? rtsImg : isHttpImageUrl(prodImg) ? prodImg : '';
  const preview = String(r.description_preview ?? p.description ?? '').trim();
  return {
    ...r,
    id: r.product_id ?? p.id,
    rts_id: r.id,
    title: r.title ?? p.title,
    description: preview,
    body_html: undefined,
    image_url: lightImg,
    factories_display_name: p.factories_display_name ?? r.vendor,
    vendor: r.vendor ?? p.factories_display_name,
    level1_category: p.level1_category ?? ptParts[0]?.trim() ?? '',
    level2_category: p.level2_category ?? ptParts[1]?.trim() ?? '',
    sale_price: p.sale_price ?? r.price,
    price: p.price ?? r.price,
    model: p.model,
    factory_id: p.factory_id,
    sku: r.sku ?? p.sku,
    tags: r.tags ?? p.tags,
    revert_reason: r.revert_reason ?? p.revert_reason,
    // Product-info page fields — prefer ready_to_shopify, fall back to products mirror.
    dimension_l_mm: r.dimension_l_mm ?? p.dimension_l_mm ?? null,
    dimension_w_mm: r.dimension_w_mm ?? p.dimension_w_mm ?? null,
    dimension_h_mm: r.dimension_h_mm ?? p.dimension_h_mm ?? null,
    in_stock: r.in_stock ?? p.in_stock ?? null,
    customize: r.customize ?? p.customize ?? null,
    cost: r.cost ?? p.cost_price ?? null,
    cost_price: p.cost_price ?? null,
  };
}

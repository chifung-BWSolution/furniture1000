import type { SupabaseClient } from '@supabase/supabase-js';

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
  const { error } = await supabase.from('products').update(flags).eq('id', productId);
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
  },
): Promise<void> {
  const productsPatch: Record<string, unknown> = {};
  if (patch.title != null) productsPatch.title = patch.title;
  if (patch.body_html != null) {
    productsPatch.description = patch.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    productsPatch.description_html = patch.body_html;
  }
  if (patch.image_url !== undefined) productsPatch.image_url = patch.image_url;
  if (patch.image_url_2 !== undefined) productsPatch.image_url_2 = patch.image_url_2;
  if (patch.image_url_3 !== undefined) productsPatch.image_url_3 = patch.image_url_3;
  if (patch.images !== undefined) productsPatch.images = patch.images;
  if (patch.tags !== undefined) productsPatch.tags = patch.tags;
  if (patch.sku !== undefined) productsPatch.sku = patch.sku;
  if (patch.sale_price != null) productsPatch.sale_price = patch.sale_price;
  else if (patch.price != null) productsPatch.sale_price = patch.price;
  if (patch.level1_category !== undefined) productsPatch.level1_category = patch.level1_category;
  if (patch.level2_category !== undefined) productsPatch.level2_category = patch.level2_category;
  if (patch.dimension_l_mm !== undefined) productsPatch.dimension_l_mm = patch.dimension_l_mm;
  if (patch.dimension_w_mm !== undefined) productsPatch.dimension_w_mm = patch.dimension_w_mm;
  if (patch.dimension_h_mm !== undefined) productsPatch.dimension_h_mm = patch.dimension_h_mm;
  if (patch.in_stock !== undefined) productsPatch.in_stock = patch.in_stock;
  if (patch.customize !== undefined) productsPatch.customize = patch.customize;
  if (patch.material !== undefined) productsPatch.material = patch.material;
  if (patch['my_fields.materials'] !== undefined) productsPatch.material = patch['my_fields.materials'];

  if (Object.keys(productsPatch).length === 0) return;
  const { error } = await supabase.from('products').update(productsPatch).eq('id', productId);
  if (error) console.warn('[rtsProductSync] content sync failed:', error.message);
}

/** Flatten ready_to_shopify + embedded products row for publish list UIs. */
export function flattenRtsListRow(r: Record<string, unknown>): Record<string, unknown> {
  const p = (r.products ?? {}) as Record<string, unknown>;
  const ptParts = String(r.product_type ?? '').split(' / ');
  return {
    ...r,
    id: r.product_id ?? p.id,
    rts_id: r.id,
    title: r.title ?? p.title,
    description: p.description ?? r.body_html ?? '',
    body_html: r.body_html ?? p.description_html ?? p.description,
    image_url: r.image_url ?? p.image_url,
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
  };
}

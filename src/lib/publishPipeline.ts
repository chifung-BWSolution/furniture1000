import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * After a product is live on Shopify, remove it from the 網上發佈 pipeline
 * (產品文案 → 產品信息 → 傢俬組檢查 → 準備上載) so it cannot be uploaded again.
 *
 * - Deletes ready_to_shopify row(s) for this product
 * - Clears products.in_shopify_queue / ready_to_publish
 *
 * Revert flows intentionally keep RTS rows — only call this on successful publish.
 */
export async function removeProductFromPublishPipeline(
  supabase: SupabaseClient,
  productId: string,
): Promise<{ rtsError?: string; productsError?: string }> {
  const { error: rtsError } = await supabase
    .from('ready_to_shopify')
    .delete()
    .eq('product_id', productId);

  const { error: productsError } = await supabase
    .from('products')
    .update({ in_shopify_queue: false, ready_to_publish: false })
    .eq('id', productId);

  return {
    rtsError: rtsError?.message,
    productsError: productsError?.message,
  };
}

/** Exclude products that already have a live Shopify ID (defensive list filter). */
export function excludeAlreadyPublished<T extends { is: (col: string, op: string, val: null) => T }>(
  q: T,
): T {
  return q.is('shopify_product_id', null);
}

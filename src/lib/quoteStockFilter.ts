/** 快速報價 — 工期為緊急/加急時，產品目錄僅顯示現貨。 */
export const URGENT_WORK_PERIODS = [
  '即時 3-5天內 - 緊急',
  '7天內 - 加急',
] as const;

export const URGENT_DELIVERY_TAG = '3-7天送貨';

export function isUrgentWorkPeriod(workPeriod: string | undefined | null): boolean {
  const w = (workPeriod || '').trim();
  return (URGENT_WORK_PERIODS as readonly string[]).includes(w);
}

export function normalizeProductTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

/**
 * 現貨篩選：
 * - products.in_stock = true
 * - 有 ready_to_shopify 時：rts.in_stock = true、tags 少於 8、含「3-7天送貨」
 * - 無 ready_to_shopify 時：products.tags 少於 8、含「3-7天送貨」
 */
export function passesUrgentStockFilter(
  product: Record<string, unknown> | null | undefined,
  rts: Record<string, unknown> | null | undefined,
): boolean {
  if (!product || product.in_stock !== true) return false;

  if (rts) {
    if (rts.in_stock !== true) return false;
    const rtsTags = normalizeProductTags(rts.tags);
    if (rtsTags.length >= 8) return false;
    return rtsTags.includes(URGENT_DELIVERY_TAG);
  }

  const productTags = normalizeProductTags(product.tags);
  if (productTags.length >= 8) return false;
  return productTags.includes(URGENT_DELIVERY_TAG);
}

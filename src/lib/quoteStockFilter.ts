/** 快速報價 — 工期為緊急/加急時，產品目錄僅顯示現貨。 */
export const URGENT_WORK_PERIODS = [
  '即時 3-5天內 - 緊急',
  '7天內 - 加急',
] as const;

export const URGENT_DELIVERY_TAG = '3-7天送貨';

/** 貨期選項「3-7天」（與 PublishProductInfoView LEAD_TIME_OPTIONS 一致） */
export const READY_STOCK_LEAD_TIME = '3-7天';

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

export function isReadyStockLeadTime(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return s === READY_STOCK_LEAD_TIME || s === URGENT_DELIVERY_TAG;
}

export function isTruthyStockFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 'TRUE' || value === 1;
}

/**
 * A類現貨：
 * - shopify_products."my_fields.production_time" = 3-7天
 * - ready_to_shopify.in_stock = true 或 customize = 3-7天
 */
export function passesShopifyCatalogReadyStock(
  shopify: Record<string, unknown> | null | undefined,
  rts: Record<string, unknown> | null | undefined,
): boolean {
  if (shopify) {
    if (isReadyStockLeadTime(shopify['my_fields.production_time'])) return true;
    // shopify_products also mirrors customize / in_stock in some sync paths
    if (isReadyStockLeadTime(shopify.customize)) return true;
    if (isTruthyStockFlag(shopify.in_stock)) return true;
  }
  if (rts) {
    if (isTruthyStockFlag(rts.in_stock)) return true;
    if (isReadyStockLeadTime(rts.customize)) return true;
  }
  return false;
}

/**
 * B類現貨：A類條件，再加上
 * - products.in_stock = true 或 products.customize = 3-7天
 */
export function passesSystemCatalogReadyStock(
  product: Record<string, unknown> | null | undefined,
  shopify?: Record<string, unknown> | null,
  rts?: Record<string, unknown> | null,
): boolean {
  if (passesShopifyCatalogReadyStock(shopify, rts)) return true;
  if (product) {
    if (isTruthyStockFlag(product.in_stock)) return true;
    if (isReadyStockLeadTime(product.customize)) return true;
  }
  return false;
}

/**
 * @deprecated Prefer passesSystemCatalogReadyStock / passesShopifyCatalogReadyStock.
 * Kept for callers that still pass product+rts only (urgent quote path).
 */
export function passesUrgentStockFilter(
  product: Record<string, unknown> | null | undefined,
  rts: Record<string, unknown> | null | undefined,
): boolean {
  return passesSystemCatalogReadyStock(product, null, rts);
}

/** Billable totals for quote items (excludes optional / 可選產品 lines). */

export type QuoteLineItem = {
  unitPrice?: number;
  quantity?: number;
  isOptional?: boolean;
  isSectionTitle?: boolean;
};

export type QuoteCostLineItem = {
  hkdCostPrice?: number | null;
  quantity?: number;
  isOptional?: boolean;
  isSectionTitle?: boolean;
};

/** Customer-facing HKD line subtotal — optional / section titles contribute 0. */
export function quoteItemLineSubtotal(item: QuoteLineItem): number {
  if (item.isOptional || item.isSectionTitle) return 0;
  return (item.unitPrice ?? 0) * (item.quantity ?? 0);
}

export function quoteBillableSubtotal(items: QuoteLineItem[]): number {
  return items.reduce((sum, item) => sum + quoteItemLineSubtotal(item), 0);
}

/** Internal HKD cost for one line (ceil unit cost × qty) — optional / titles contribute 0. */
export function quoteItemLineCost(item: QuoteCostLineItem): number {
  if (item.isOptional || item.isSectionTitle) return 0;
  const hkdCost = item.hkdCostPrice != null ? Math.ceil(item.hkdCostPrice) : 0;
  return hkdCost * (item.quantity ?? 0);
}

/** Sum of billable product costs for GP / Cost column. */
export function quoteBillableProductCost(items: QuoteCostLineItem[]): number {
  return items.reduce((sum, item) => sum + quoteItemLineCost(item), 0);
}

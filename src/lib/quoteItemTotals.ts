/** Billable line subtotal for quote items (excludes optional products). */

export type QuoteLineItem = {
  unitPrice?: number;
  quantity?: number;
  isOptional?: boolean;
};

export function quoteItemLineSubtotal(item: QuoteLineItem): number {
  if (item.isOptional) return 0;
  return (item.unitPrice ?? 0) * (item.quantity ?? 0);
}

export function quoteBillableSubtotal(items: QuoteLineItem[]): number {
  return items.reduce((sum, item) => sum + quoteItemLineSubtotal(item), 0);
}

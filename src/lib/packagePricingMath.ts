/** 2026 Quick Pricing sheet: line subtotal = quantity × average price. No surcharge on that sheet. */

export const PACKAGE_PRICE_YEAR = 2026;

export const PACKAGE_PRICE_NOTE =
  '參考報價，不是正式報價單。小計 = 數量 × 2026 工作表的平均價。數量為 0 時小計是 0。標準價錢與高品質價錢只顯示區間，不計入總額。2026 工作表沒有運輸或安裝加成。';

export interface PackageLine {
  id: string;
  templateId?: string;
  sourcePitchingId?: string;
  sourceQuotationId?: string;
  sourceSectionId?: string;
  sourceItem?: string;
  sourceDescription?: string;
  area: string;
  itemName: string;
  grade: string;
  material: string;
  dimension: string;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  standardNote: string;
  premiumNote: string;
}

export interface PackageQuoteSnapshot {
  title: string;
  priceYear: number;
  note: string;
  lines: PackageLine[];
}

export function lineCents(quantity: number, unitPrice: number | null): number {
  if (unitPrice == null || !Number.isFinite(unitPrice)) return 0;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(quantity * unitPrice * 100);
}

export function areaTotals(lines: PackageLine[]): { area: string; cents: number }[] {
  const order: string[] = [];
  const sums = new Map<string, number>();
  for (const line of lines) {
    if (!sums.has(line.area)) {
      order.push(line.area);
      sums.set(line.area, 0);
    }
    sums.set(line.area, (sums.get(line.area) || 0) + lineCents(line.quantity, line.unitPrice));
  }
  return order.map((area) => ({ area, cents: sums.get(area) || 0 }));
}

export function totalCents(lines: PackageLine[]): number {
  return lines.reduce((sum, line) => sum + lineCents(line.quantity, line.unitPrice), 0);
}

export function formatPackageMoney(cents: number): string {
  return `HK$ ${(cents / 100).toLocaleString('en-HK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function packageSharePath(token: string): string {
  return `/package-quote/${token}`;
}

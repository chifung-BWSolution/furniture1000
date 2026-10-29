/** 2026 Quick Pricing sheet: line subtotal = quantity × average price. No surcharge on that sheet. */

export const PACKAGE_PRICE_YEAR = 2026;

/** Largest quantity a reference quote accepts (same ceiling as the QMS customer scheme RPC). */
export const PACKAGE_MAX_QUANTITY = 100_000;

export const PACKAGE_PRICE_NOTE =
  '參考報價，不是正式報價單。小計 = 數量 × 2026 工作表的平均價。數量為 0 時小計是 0。標準價錢與高品質價錢只顯示區間，不計入總額。2026 工作表沒有運輸或安裝加成。';

export interface PackageLine {
  id: string;
  templateId?: string;
  sourcePitchingId?: string;
  /** PMS pitching code, kept for tracing the saved quote back to the project. */
  sourcePitchingCode?: string;
  sourceQuotationId?: string;
  /** QMS quotation no / version text, kept for tracing. */
  sourceQuotationNo?: string;
  sourceSectionId?: string;
  /** QMS section name (傢俬 section) the item came from. */
  sourceSectionName?: string;
  sourceItem?: string;
  sourceDescription?: string;
  area: string;
  itemName: string;
  grade: string;
  material: string;
  dimension: string;
  unit: string;
  quantity: number;
  /** Average price in dollars; null means the workbook has no price for this line. */
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

/** All money moves in cents so display, area subtotals, total, snapshot and PDF agree. */
export function toCents(dollars: number | null | undefined): number | null {
  if (dollars == null || !Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/**
 * Line subtotal in cents. Quantity 0 gives 0, and a negative or unknown value never
 * produces a subtotal — validation blocks saving such a line.
 */
export function lineCents(quantity: number, unitPrice: number | null): number {
  const cents = toCents(unitPrice);
  if (cents == null || cents < 0) return 0;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(quantity * cents);
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

/** Input parsing that never silently turns a bad number into a valid price. */
export type PackageNumberField = 'quantity' | 'unitPrice';

export function parsePackageQuantity(raw: string): number {
  const text = raw.trim();
  if (text === '') return 0;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function parsePackagePrice(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

export interface PackageLineProblem {
  lineId: string;
  field: PackageNumberField | 'price' | 'match';
  message: string;
}

/**
 * Rules from FDS-08: quantity 0 is valid (subtotal 0); negative, non-numeric or
 * oversized values, and missing/negative prices, must not become a quote.
 */
export function packageLineProblems(line: PackageLine): PackageLineProblem[] {
  const problems: PackageLineProblem[] = [];
  if (!Number.isFinite(line.quantity)) {
    problems.push({ lineId: line.id, field: 'quantity', message: '數量不是有效數字' });
  } else if (line.quantity < 0) {
    problems.push({ lineId: line.id, field: 'quantity', message: '數量不可為負數' });
  } else if (line.quantity > PACKAGE_MAX_QUANTITY) {
    problems.push({ lineId: line.id, field: 'quantity', message: `數量不可大於 ${PACKAGE_MAX_QUANTITY}` });
  }
  if (line.unitPrice == null) {
    problems.push({ lineId: line.id, field: 'price', message: '這行沒有 2026 平均價' });
  } else if (!Number.isFinite(line.unitPrice)) {
    problems.push({ lineId: line.id, field: 'price', message: '平均價不是有效數字' });
  } else if (line.unitPrice < 0) {
    problems.push({ lineId: line.id, field: 'price', message: '平均價不可為負數' });
  } else if (line.unitPrice > 100_000_000) {
    problems.push({ lineId: line.id, field: 'price', message: '平均價超出合理範圍' });
  }
  if (!line.templateId && !line.itemName.trim()) {
    problems.push({ lineId: line.id, field: 'match', message: '這行未匹配 2026 價目' });
  }
  return problems;
}

/** Blocks save / share / PDF until every line is valid and at least one line exists. */
export function validatePackageLines(lines: PackageLine[]): PackageLineProblem[] {
  if (lines.length === 0) {
    return [{ lineId: '', field: 'match', message: '這張單還沒有項目' }];
  }
  return lines.flatMap((line) => packageLineProblems(line));
}

/** Fresh copy so a saved quote can never follow later edits to the working lines. */
export function clonePackageLines(lines: PackageLine[]): PackageLine[] {
  return lines.map((line) => ({ ...line }));
}

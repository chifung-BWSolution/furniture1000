/**
 * 成本一致性檢查。
 *
 * HKD 成本正常由「¥成本 × 匯率」算出，但報價明細也允許直接輸入實際 HKD
 * 成本（廠家直接報 HKD、議價後成本、四捨五入等）。兩邊都有值但不一致時
 * **只提示、不自動覆寫**，避免把刻意的成本改掉（見 BWF-OB26-200 / 201）。
 */

export type QuoteCostCheckItem = {
  id?: string;
  name?: string | null;
  category?: string | null;
  costPrice?: number | null;
  exchangeRate?: number | null;
  hkdCostPrice?: number | null;
  isOptional?: boolean | null;
  isSectionTitle?: boolean | null;
};

/** 存檔保留 3 位小數，顯示／合計時再 ceil，允許 1 元以內的差。 */
export const QUOTE_HKD_COST_TOLERANCE = 1;

export type QuoteCostMismatch = {
  id: string;
  label: string;
  costPrice: number;
  exchangeRate: number;
  hkdCostPrice: number;
  derivedHkdCost: number;
};

/** ¥成本 × 匯率（3 dp）；缺一邊或不是正數時回 null。 */
export function quoteDerivedHkdCost(
  costPrice: number | null | undefined,
  exchangeRate: number | null | undefined,
): number | null {
  if (costPrice == null || exchangeRate == null) return null;
  if (!(costPrice > 0) || !(exchangeRate > 0)) return null;
  return Math.round(costPrice * exchangeRate * 1000) / 1000;
}

/** 找出「HKD 成本 ≠ ¥成本 × 匯率」的計價行（與 GP Cost 同口徑：可選／分段標題不計）。 */
export function findQuoteCostMismatches(
  items: readonly QuoteCostCheckItem[],
): QuoteCostMismatch[] {
  const mismatches: QuoteCostMismatch[] = [];
  items.forEach((item, index) => {
    if (item.isOptional || item.isSectionTitle) return;
    const derived = quoteDerivedHkdCost(item.costPrice, item.exchangeRate);
    if (derived == null || item.hkdCostPrice == null) return;
    if (Math.abs(item.hkdCostPrice - derived) <= QUOTE_HKD_COST_TOLERANCE) return;
    const label =
      (item.name || '').trim() ||
      (item.category || '').trim() ||
      `第 ${index + 1} 行`;
    mismatches.push({
      id: (item.id || '').trim() || `row-${index}`,
      label,
      costPrice: Number(item.costPrice),
      exchangeRate: Number(item.exchangeRate),
      hkdCostPrice: Number(item.hkdCostPrice),
      derivedHkdCost: derived,
    });
  });
  return mismatches;
}

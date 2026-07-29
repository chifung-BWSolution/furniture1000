/**
 * Format L×W×H in mm for 設計專案 / 選擇產品 / 報價方案 UI.
 * Matches catalog convention: L→(W), W→(D), H→(H)
 * e.g. `2300(W) x 900(D) x 730(H) (mm)`
 */
export function formatProductDimensionsMm(
  lengthMm?: number | string | null,
  widthMm?: number | string | null,
  heightMm?: number | string | null,
): string {
  const axis = (value: number | string | null | undefined): string | null => {
    if (value == null || value === '') return null;
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return null;
    return String(Math.round(num));
  };
  const l = axis(lengthMm);
  const w = axis(widthMm);
  const h = axis(heightMm);
  if (l == null && w == null && h == null) return '';
  return `${l ?? '—'}(W) x ${w ?? '—'}(D) x ${h ?? '—'}(H) (mm)`;
}

/** Shared L/W/H mm validation for 產品價錢 / 準備上載. */
export function isValidDimensionMm(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

export function hasCompleteProductDimensions(dims: {
  l?: unknown;
  w?: unknown;
  h?: unknown;
}): boolean {
  return (
    isValidDimensionMm(dims.l) &&
    isValidDimensionMm(dims.w) &&
    isValidDimensionMm(dims.h)
  );
}

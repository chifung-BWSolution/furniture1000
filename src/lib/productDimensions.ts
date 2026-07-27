/**
 * Format L×W×H in mm for 設計專案 / 選擇產品 UI.
 * Matches catalog convention: L→(W), W→(D), H→(H)
 * e.g. `2300(W) x 900(D) x 730(H) (mm)`
 */
export function formatProductDimensionsMm(
  lengthMm?: number | null,
  widthMm?: number | null,
  heightMm?: number | null,
): string {
  const axis = (value: number | null | undefined): string | null => {
    if (value == null || !Number.isFinite(value)) return null;
    return String(Math.round(value));
  };
  const l = axis(lengthMm);
  const w = axis(widthMm);
  const h = axis(heightMm);
  if (l == null && w == null && h == null) return '';
  return `${l ?? '—'}(W) x ${w ?? '—'}(D) x ${h ?? '—'}(H) (mm)`;
}

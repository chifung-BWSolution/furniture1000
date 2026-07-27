/** Format L×W×H in mm for 設計專案 / 選擇產品 UI: `100x100x100 (mm)`. */
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
  return `${l ?? '—'}x${w ?? '—'}x${h ?? '—'} (mm)`;
}

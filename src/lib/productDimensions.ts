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

export type ParsedNormalSizeMm = {
  /** 長 — from normal_size (W) */
  lengthMm: number;
  /** 闊 — from normal_size (D) */
  widthMm: number;
  /** 高 — from normal_size (H) */
  heightMm: number;
};

/**
 * Parse shopify_products."my_fields.normal_size" into L/W/H mm.
 * Source of truth for portal product search (values are already mm).
 *
 * Supported examples:
 * - `600(W)x600(D)x720(H)(mm)`
 * - `600(W) x 600(D) x 720(H) (mm)`
 * - `600 x 600 x 720` / `600×600×720mm`
 *
 * Mapping: (W)→長(L), (D)→闊(W), (H)→高(H). Never apply cm→mm scaling.
 */
export function parseNormalSizeMm(
  raw: string | null | undefined,
): ParsedNormalSizeMm | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const labeled = text.match(
    /(\d+(?:\.\d+)?)\s*\(\s*W\s*\)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*\(\s*D\s*\)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*\(\s*H\s*\)/i,
  );
  if (labeled) {
    return toParsedNormalSizeMm(labeled[1], labeled[2], labeled[3]);
  }

  // Plain "W x D x H" / "W×D×H" (optional trailing mm) — same axis order.
  const plain = text.match(
    /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*$/i,
  );
  if (plain) {
    return toParsedNormalSizeMm(plain[1], plain[2], plain[3]);
  }

  return null;
}

function toParsedNormalSizeMm(
  wRaw: string,
  dRaw: string,
  hRaw: string,
): ParsedNormalSizeMm | null {
  const lengthMm = Number(wRaw);
  const widthMm = Number(dRaw);
  const heightMm = Number(hRaw);
  if (
    !Number.isFinite(lengthMm) ||
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    lengthMm <= 0 ||
    widthMm <= 0 ||
    heightMm <= 0
  ) {
    return null;
  }
  return {
    lengthMm: Math.round(lengthMm),
    widthMm: Math.round(widthMm),
    heightMm: Math.round(heightMm),
  };
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

/**
 * Image metafield URL policy (準備上載 → Shopify → 已上載產品):
 *
 * - **Upload source**: Supabase Storage / HTTP URLs — Shopify downloads these on product create.
 * - **Stored everywhere else**: Shopify CDN only (`cdn.shopify.com` / store CDN host).
 *   Applies to `custom.more_image_link_*`, `my_fields.image_link`, and mirror columns.
 *
 * Client payloads must NOT send image-link metafields on publish; edge functions set them
 * from live Shopify product images after CDN upload.
 */

export const IMAGE_METAFIELD_LINK_PREFIXES = [
  'custom.more_image_link_',
  'custom.more_image_alt_',
  'my_fields.image_link',
  'my_fields.image_alt',
] as const;

export function isShopifyCdnUrl(url: string): boolean {
  return /cdn\.shopify\.com/i.test(url) || /\.myshopify\.com\/cdn\//i.test(url);
}

export function isHttpUrl(src: unknown): src is string {
  return typeof src === 'string' && /^https?:\/\//.test(src);
}

/** Remove image URL metafields — server writes Shopify CDN URLs after upload. */
export function stripImageMetafieldColumns(mf: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, val] of Object.entries(mf)) {
    if (IMAGE_METAFIELD_LINK_PREFIXES.some((p) => col.startsWith(p) || col === p)) continue;
    out[col] = val;
  }
  return out;
}

/** Build more_image_link_1..4 + alt from ordered gallery URLs (typically Shopify CDN on mirror). */
export function buildMoreImageMetafieldColumns(
  orderedUrls: string[],
  title?: string | null,
): Record<string, string | null> {
  const cols: Record<string, string | null> = {};
  for (let i = 1; i <= 4; i++) {
    const url = orderedUrls[i - 1];
    const linkKey = `custom.more_image_link_${i}`;
    const altKey = `custom.more_image_alt_${i}`;
    if (url && isHttpUrl(url)) {
      cols[linkKey] = url;
      cols[altKey] = title?.trim() ? title.trim() : null;
    } else {
      cols[linkKey] = null;
      cols[altKey] = null;
    }
  }
  return cols;
}

/** Ordered HTTP src from mirror/Shopify image records (position ascending). */
export function orderedImageSrcs(
  images: { src?: string | null; position?: number | null }[] | null | undefined,
  fallbackPrimary?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (src: string | null | undefined) => {
    if (!isHttpUrl(src)) return;
    if (seen.has(src)) return;
    seen.add(src);
    out.push(src);
  };
  if (Array.isArray(images) && images.length > 0) {
    const sorted = [...images].sort(
      (a, b) => (Number(a.position) || 99) - (Number(b.position) || 99),
    );
    for (const im of sorted) add(im.src);
  }
  if (out.length === 0) add(fallbackPrimary);
  return out;
}

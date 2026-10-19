/**
 * Product image thumbnails via Supabase Storage Image Transformations.
 *
 * Product images live in the public `product-images` bucket as
 * `/storage/v1/object/public/...`. Rewriting that to `/storage/v1/render/image/public/...`
 * with `width`/`quality`/`format=webp` returns a compressed, cached thumbnail
 * (typically ~20x smaller) without touching the DB or re-uploading.
 *
 * `LoadingImage` sends every public object URL through this helper.
 * A URL that is already `/render/image/` is left alone, so an explicit
 * `productThumbUrl(url, 640)` keeps its width. Lightbox-sized boxes use 1600px.
 */

const SUPABASE_OBJECT_MARKER = '/storage/v1/object/public/';
const SUPABASE_RENDER_MARKER = '/storage/v1/render/image/public/';

export const THUMB_WIDTH = 320;
export const THUMB_QUALITY = 65;

/**
 * Kill-switch. Supabase Storage image transformations must be enabled on the
 * project. If an environment ever serves broken thumbnails, set
 * `VITE_SUPABASE_IMAGE_TRANSFORMS=false` and every image falls back to its
 * original URL (no schema/code change needed).
 */
function transformsEnabled(): boolean {
  const flag = import.meta.env.VITE_SUPABASE_IMAGE_TRANSFORMS;
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return true;
}

export type ThumbOptions = {
  /** Target width in px (default 320). */
  width?: number;
  /** Target height in px (only when you need a fixed crop). */
  height?: number;
  /** JPEG/WebP quality 20-100 (default 65). */
  quality?: number;
  /** Output format (default 'webp'). */
  format?: 'webp' | 'origin';
  /** Supabase resize mode (defaults to `contain` when no height is given). */
  resize?: 'cover' | 'contain' | 'fill';
};

/**
 * Rewrite a Supabase Storage public object URL into a transformed thumbnail URL.
 * Non-Supabase URLs (external CDN, data-URLs, relative paths) are returned unchanged.
 */
export function toThumbUrl(
  url: string | null | undefined,
  options: ThumbOptions = {},
): string {
  const src = (url || '').trim();
  if (!src) return src;
  if (!transformsEnabled()) return src;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (!src.startsWith('http://') && !src.startsWith('https://')) return src;

  const hasRender = src.includes(SUPABASE_RENDER_MARKER);
  const hasObject = src.includes(SUPABASE_OBJECT_MARKER);
  if (!hasRender && !hasObject) return src;

  const [base, existingQuery = ''] = src.split('?');
  const renderBase = hasRender
    ? base
    : base.replace(SUPABASE_OBJECT_MARKER, SUPABASE_RENDER_MARKER);

  const params = new URLSearchParams(existingQuery);
  params.set('width', String(Math.round(options.width ?? THUMB_WIDTH)));
  if (options.height) params.set('height', String(Math.round(options.height)));
  params.set('quality', String(Math.round(options.quality ?? THUMB_QUALITY)));
  params.set('format', options.format ?? 'webp');
  // Supabase defaults to `cover` against the original height, so a width-only
  // request returns e.g. 320x1024 for a 1024x1024 source; `contain` keeps the ratio.
  if (options.resize) params.set('resize', options.resize);
  else if (!options.height && !params.has('resize')) params.set('resize', 'contain');

  return `${renderBase}?${params.toString()}`;
}

/** Convenience preset for product list/grid/table thumbnails. */
export function productThumbUrl(
  url: string | null | undefined,
  width: number = THUMB_WIDTH,
): string {
  return toThumbUrl(url, { width });
}

/** Wider compressed rendition for enlarge / preview boxes. */
export const PREVIEW_WIDTH = 1600;

/**
 * Display URL for a Supabase Storage public object.
 * Shopify, data, and blob URLs are unchanged. An existing render URL is kept.
 */
export function compressStorageDisplayUrl(
  url: string | null | undefined,
  className?: string,
): string {
  const src = (url || '').trim();
  if (!src.includes(SUPABASE_OBJECT_MARKER)) return src;
  const preview = /(?:^|\s)max-[hw]-/.test(` ${className || ''} `);
  return toThumbUrl(src, { width: preview ? PREVIEW_WIDTH : THUMB_WIDTH });
}

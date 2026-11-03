/** Permanent 640px WebP variants in the same bucket, with original-image fallback.
 * New uploads and scripts/backfill-permanent-thumbnails.mjs generate these files.
 * Large previews use the original. No paid render/image endpoint is requested.
 */
const SUPABASE_OBJECT_MARKER = '/storage/v1/object/public/';
const SUPABASE_RENDER_MARKER = '/storage/v1/render/image/public/';

export const THUMB_WIDTH = 640;
export const THUMB_QUALITY = 65;

/**
 * Kill-switch. Persisted thumbnail display can be disabled per environment. If an environment ever serves broken thumbnails, set
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
 * Resolve a public object URL to its persisted thumbnail.
 * Non-Supabase URLs (external CDN, data-URLs, relative paths) are returned unchanged.
 */
export function toThumbUrl(
  url: string | null | undefined,
  options: ThumbOptions = {},
): string {
  const src = (url || '').trim();
  if (!src) return src;
  if (!transformsEnabled()) return originalImageUrl(src);
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (!src.startsWith('http://') && !src.startsWith('https://')) return src;

  const original = originalImageUrl(src);
  if (!original.includes(SUPABASE_OBJECT_MARKER)) return original;
  if ((options.width ?? THUMB_WIDTH) > 640 || options.format === 'origin') return original;
  const parsed = new URL(original);
  const offset = parsed.pathname.indexOf(SUPABASE_OBJECT_MARKER) + SUPABASE_OBJECT_MARKER.length;
  const slash = parsed.pathname.indexOf('/', offset);
  const path = parsed.pathname.slice(slash + 1);
  if (path.startsWith('catalog-thumbs/')) return original;
  parsed.pathname = parsed.pathname.slice(0, slash + 1) + '__thumbs/v1/' + path + '.webp';
  return parsed.toString();
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

/** Undo a persisted thumbnail or legacy transform URL for lossless fallback. */
export function originalImageUrl(url: string): string {
  if (!url.includes(SUPABASE_OBJECT_MARKER) && !url.includes(SUPABASE_RENDER_MARKER)) return url;
  const parsed = new URL(url.replace(SUPABASE_RENDER_MARKER, SUPABASE_OBJECT_MARKER));
  const offset = parsed.pathname.indexOf(SUPABASE_OBJECT_MARKER) + SUPABASE_OBJECT_MARKER.length;
  const slash = parsed.pathname.indexOf('/', offset);
  const path = parsed.pathname.slice(slash + 1);
  if (path.startsWith('__thumbs/v1/') && path.endsWith('.webp')) {
    parsed.pathname = parsed.pathname.slice(0, slash + 1) + path.slice('__thumbs/v1/'.length, -5);
  }
  parsed.search = '';
  return parsed.toString();
}

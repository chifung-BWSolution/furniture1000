import { dedupeImageUrlsPreserveOrder } from '@/lib/productMergeImages';

/** Normalize images JSONB — handles array or stringified JSON from legacy rows. */
function normalizeImagesField(images: unknown): unknown[] {
  if (Array.isArray(images)) return images;
  if (typeof images === 'string' && images.trim()) {
    try {
      const parsed = JSON.parse(images);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Collect unique image URLs from image_url / image_url_2 / image_url_3 / images jsonb. */
export function parseRtsImageUrls(row: {
  image_url?: string | null;
  image_url_2?: string | null;
  image_url_3?: string | null;
  images?: unknown;
}): string[] {
  return dedupeImageUrlsPreserveOrder([
    ...(row.image_url ? [row.image_url] : []),
    ...(row.image_url_2 ? [row.image_url_2] : []),
    ...(row.image_url_3 ? [row.image_url_3] : []),
    ...normalizeImagesField(row.images).flatMap((img) => {
      if (typeof img === 'string') return [img];
      if (img && typeof img === 'object') {
        const rec = img as Record<string, unknown>;
        const src =
          typeof rec.src === 'string'
            ? rec.src
            : typeof rec.url === 'string'
              ? rec.url
              : '';
        return src ? [src] : [];
      }
      return [];
    }),
  ]);
}

/**
 * ready_to_shopify gallery: image_url = primary, images[] = other photos.
 * Returns [primary, ...extras] in display order (deduped by filename stem).
 */
export function parseRtsGalleryUrls(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  return dedupeImageUrlsPreserveOrder([
    ...(row.image_url ? [row.image_url] : []),
    ...normalizeImagesField(row.images).flatMap((img) => {
      if (typeof img === 'string') return [img];
      if (img && typeof img === 'object') {
        const rec = img as Record<string, unknown>;
        const src =
          typeof rec.src === 'string'
            ? rec.src
            : typeof rec.url === 'string'
              ? rec.url
              : '';
        return src ? [src] : [];
      }
      return [];
    }),
  ]);
}

/**
 * Build publish gallery: primary first (RTS image_url, else products.image_url), then images[].
 * When RTS only has images[] extras, prepends catalog primary so Shopify gets the main shot.
 */
export function buildPublishGalleryUrls(
  rts: { image_url?: string | null; images?: unknown } | null | undefined,
  productPrimary?: string | null,
): string[] {
  const rtsPrimary = (rts?.image_url || '').trim();
  const catalogPrimary = (productPrimary || '').trim();
  const effectivePrimary = rtsPrimary.startsWith('http')
    ? rtsPrimary
    : catalogPrimary.startsWith('http')
      ? catalogPrimary
      : '';

  let urls = rts ? parseRtsGalleryUrls(rts) : [];
  if (!effectivePrimary.startsWith('http')) return urls;

  return dedupeImageUrlsPreserveOrder([effectivePrimary, ...urls]);
}

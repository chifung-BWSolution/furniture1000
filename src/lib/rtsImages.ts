import { collectProductGalleryUrls } from '@/lib/productGallery';
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

export type PublishCatalogImages = {
  image_url?: string | null;
  image_url_2?: string | null;
  image_url_3?: string | null;
  lifestyle_image_url?: string | null;
};

/**
 * Build publish gallery: primary first (RTS image_url, else products.image_url), then extras.
 * Merges RTS images[] with catalog image_url_2/3 and lifestyle_image_url so the 4th lifestyle
 * shot is not dropped when upserting to ready_to_shopify omitted it historically.
 */
export function buildPublishGalleryUrls(
  rts: {
    image_url?: string | null;
    image_url_2?: string | null;
    image_url_3?: string | null;
    images?: unknown;
  } | null | undefined,
  productPrimary?: string | null,
  catalogExtras?: PublishCatalogImages | null,
): string[] {
  const rtsPrimary = (rts?.image_url || '').trim();
  const catalogPrimary = (productPrimary || catalogExtras?.image_url || '').trim();
  const effectivePrimary = rtsPrimary.startsWith('http')
    ? rtsPrimary
    : catalogPrimary.startsWith('http')
      ? catalogPrimary
      : '';

  const rtsUrls = rts ? parseRtsImageUrls(rts) : [];
  const catalogUrls = catalogExtras
    ? collectProductGalleryUrls({
        image_url: catalogPrimary || catalogExtras.image_url,
        image_url_2: catalogExtras.image_url_2,
        image_url_3: catalogExtras.image_url_3,
        lifestyle_image_url: catalogExtras.lifestyle_image_url,
      })
    : catalogPrimary.startsWith('http')
      ? [catalogPrimary]
      : [];

  if (!effectivePrimary.startsWith('http')) {
    return dedupeImageUrlsPreserveOrder([...rtsUrls, ...catalogUrls]);
  }

  return dedupeImageUrlsPreserveOrder([effectivePrimary, ...rtsUrls, ...catalogUrls]);
}

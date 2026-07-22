import { dedupeImageUrlsPreserveOrder, imageDedupeKey } from '@/lib/productMergeImages';
import { collectProductGalleryUrls } from '@/lib/productGallery';

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

function srcFromImageEntry(img: unknown): string {
  if (typeof img === 'string') return img.trim();
  if (img && typeof img === 'object') {
    const rec = img as Record<string, unknown>;
    if (typeof rec.src === 'string') return rec.src.trim();
    if (typeof rec.url === 'string') return rec.url.trim();
  }
  return '';
}

/** Extra image URLs from images[] only (excludes primary). */
export function rtsExtraImageUrls(images: unknown): string[] {
  return dedupeImageUrlsPreserveOrder(
    normalizeImagesField(images)
      .map(srcFromImageEntry)
      .filter((src) => src.startsWith('http')),
  );
}

/**
 * ready_to_shopify gallery: image_url = primary, images[] = other photos.
 * Returns [primary, ...extras] in display order (deduped by filename stem).
 */
export function parseRtsGalleryUrls(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  const primary = (row.image_url || '').trim();
  const extras = rtsExtraImageUrls(row.images);
  if (!primary.startsWith('http')) return extras;
  return dedupeImageUrlsPreserveOrder([primary, ...extras]);
}

/** @deprecated ready_to_shopify uses image_url + images[] only — alias of parseRtsGalleryUrls. */
export function parseRtsImageUrls(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  return parseRtsGalleryUrls(row);
}

/** Build ready_to_shopify images[] JSON from ordered extra URLs (position 1-based). */
export function buildRtsImagesJson(
  extraUrls: string[],
): { src: string; position: number }[] | null {
  const deduped = dedupeImageUrlsPreserveOrder(extraUrls.filter((u) => u.startsWith('http')));
  if (deduped.length === 0) return null;
  return deduped.map((src, i) => ({ src, position: i + 1 }));
}

export type ProductGallerySource = {
  image_url?: string | null;
  image_url_2?: string | null;
  image_url_3?: string | null;
  lifestyle_image_url?: string | null;
  images?: unknown;
};

/**
 * Merge RTS gallery (user order on 準備上載) with products catalog URLs.
 * RTS order wins; catalog fills any images missing from RTS (e.g. _primary_ white-bg
 * when scenario was set as RTS primary but white-bg stayed on products.image_url only).
 */
export function mergePublishGalleryUrls(
  rts: { image_url?: string | null; images?: unknown } | null | undefined,
  product?: ProductGallerySource | null | undefined,
): string[] {
  const rtsUrls = rts ? parseRtsGalleryUrls(rts) : [];
  if (!product) return rtsUrls;

  const catalogUrls = collectProductGalleryUrls(product);
  if (catalogUrls.length === 0) return rtsUrls;

  const seen = new Set<string>();
  const out: string[] = [];
  const add = (url: string) => {
    if (!url.startsWith('http')) return;
    const key = imageDedupeKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(url);
  };

  for (const url of rtsUrls) add(url);
  for (const url of catalogUrls) add(url);
  return out;
}

/**
 * Build publish gallery for 準備上載 → Shopify.
 * Uses RTS order first, then backfills missing catalog images.
 */
export function buildPublishGalleryUrls(
  rts: { image_url?: string | null; images?: unknown } | null | undefined,
  product?: ProductGallerySource | null | undefined,
): string[] {
  return mergePublishGalleryUrls(rts, product);
}

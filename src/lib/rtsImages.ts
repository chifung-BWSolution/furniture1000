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

/**
 * Build publish gallery from ready_to_shopify only (準備上載 → Shopify).
 * Primary = image_url; extras = images[].
 */
export function buildPublishGalleryUrls(
  rts: { image_url?: string | null; images?: unknown } | null | undefined,
): string[] {
  if (!rts) return [];
  return parseRtsGalleryUrls(rts);
}

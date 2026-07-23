/** Shopify mirror image helpers — single source of truth for gallery order. */

import {
  dedupeImageUrlsPreserveOrder,
  imageIdentityKey,
} from './productMergeImages';

export type ShopifyMirrorImage = {
  id?: string | number;
  src?: string;
  url?: string;
  alt?: string;
  width?: number;
  height?: number;
  position?: number;
  variant_ids?: number[];
};

function normalizeImagesField(images: unknown): ShopifyMirrorImage[] {
  if (Array.isArray(images)) return images as ShopifyMirrorImage[];
  if (typeof images === 'string' && images.trim()) {
    try {
      const parsed = JSON.parse(images);
      return Array.isArray(parsed) ? (parsed as ShopifyMirrorImage[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function imageSrc(im: ShopifyMirrorImage): string {
  return (im.src || im.url || '').trim();
}

/** Sort mirror/Shopify images by position ascending (1 = primary). */
export function sortShopifyImages(images: unknown): ShopifyMirrorImage[] {
  return normalizeImagesField(images)
    .filter((im) => imageSrc(im).startsWith('http'))
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

/**
 * Primary thumbnail for 已上載產品 — saved image_url first, else first images[] by position.
 */
export function resolveMirrorPrimaryImageUrl(row: {
  image_url?: string | null;
  images?: unknown;
}): string {
  return resolveMirrorGalleryUrlsInSavedOrder(row)[0] ?? '';
}

/** Ordered unique gallery URLs [primary, ...extras] — DB/saved order only. */
export function resolveMirrorGalleryUrls(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  return resolveMirrorGalleryUrlsInSavedOrder(row);
}

/**
 * Gallery URLs in DB-saved order (image_url + images[] by position).
 * Use in list/detail views after user drag-reorder save.
 */
export function resolveMirrorGalleryUrlsInSavedOrder(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  const fromImages = sortShopifyImages(row.images)
    .map((im) => imageSrc(im))
    .filter((u) => u.startsWith('http'));

  const direct = (row.image_url || '').trim();
  if (direct.startsWith('http')) {
    const dk = imageIdentityKey(direct);
    const rest = fromImages.filter((u) => imageIdentityKey(u) !== dk);
    return dedupeImageUrlsPreserveOrder([direct, ...rest]);
  }
  return dedupeImageUrlsPreserveOrder(fromImages);
}

/** Normalize images JSON for DB storage with sequential positions (stem-deduped). */
export function normalizeMirrorImagesJson(images: unknown): ShopifyMirrorImage[] | null {
  const sorted = sortShopifyImages(images);
  if (sorted.length === 0) return null;
  const seen = new Set<string>();
  const deduped: ShopifyMirrorImage[] = [];
  for (const im of sorted) {
    const src = imageSrc(im);
    if (!src.startsWith('http')) continue;
    const key = imageIdentityKey(src);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(im);
  }
  if (deduped.length === 0) return null;
  return deduped.map((im, i) => ({
    id: im.id,
    src: im.src || im.url,
    alt: im.alt || '',
    width: im.width,
    height: im.height,
    position: i + 1,
    variant_ids: im.variant_ids,
  }));
}

/** @deprecated Use resolveMirrorPrimaryImageUrl — kept for compatibility. */
export function resolveMirrorPrimaryImageUrlSmart(row: {
  image_url?: string | null;
  images?: unknown;
}): string {
  return resolveMirrorPrimaryImageUrl(row);
}

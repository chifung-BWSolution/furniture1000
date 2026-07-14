/** Shopify mirror image helpers — single source of truth for gallery order. */

import {
  dedupeImageUrls,
  imageIdentityKey,
  pickBestPrimaryImageUrl,
  sortUrlsPrimaryFirst,
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
 * Primary thumbnail for 已上載產品 — prefer *_primary_* white-bg shot over dialog/lifestyle.
 */
export function resolveMirrorPrimaryImageUrl(row: {
  image_url?: string | null;
  images?: unknown;
}): string {
  const candidates: string[] = [];
  for (const im of sortShopifyImages(row.images)) {
    const src = imageSrc(im);
    if (src.startsWith('http')) candidates.push(src);
  }
  const direct = (row.image_url || '').trim();
  if (direct.startsWith('http')) {
    const dk = imageIdentityKey(direct);
    if (!candidates.some((u) => imageIdentityKey(u) === dk)) {
      candidates.unshift(direct);
    }
  }
  return pickBestPrimaryImageUrl(candidates);
}

/** Ordered unique gallery URLs [primary, ...extras] for display and metafields. */
export function resolveMirrorGalleryUrls(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  const candidates: string[] = [];
  for (const im of sortShopifyImages(row.images)) {
    candidates.push(imageSrc(im));
  }
  if ((row.image_url || '').trim().startsWith('http')) {
    candidates.unshift(row.image_url!.trim());
  }
  return sortUrlsPrimaryFirst(dedupeImageUrls(candidates.filter((u) => u.startsWith('http'))));
}

/** Normalize images JSON for DB storage with sequential positions. */
export function normalizeMirrorImagesJson(images: unknown): ShopifyMirrorImage[] | null {
  const sorted = sortShopifyImages(images);
  if (sorted.length === 0) return null;
  return sorted.map((im, i) => ({
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

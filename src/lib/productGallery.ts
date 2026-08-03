/** Collect product gallery URLs from all image columns (catalog + detail views). */

import {
  dedupeImageUrlsPreserveOrder,
  imageIdentityKey,
  isHttpUrl,
} from '@/lib/productMergeImages';

function normalizeImagesField(images: unknown): Array<{ src?: string; url?: string } | string> {
  if (Array.isArray(images)) return images as Array<{ src?: string; url?: string } | string>;
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

/**
 * Collect products gallery in column order:
 * image_url → images[] → image_url_2 → image_url_3 → lifestyle_image_url.
 * Stem-deduped; first occurrence kept (no filename-role sort).
 */
export function collectProductGalleryUrls(row: {
  image_url?: string | null;
  image_url_2?: string | null;
  image_url_3?: string | null;
  lifestyle_image_url?: string | null;
  images?: unknown;
}): string[] {
  const raw: string[] = [];

  const push = (src?: string | null) => {
    const s = (src || '').trim();
    if (isHttpUrl(s)) raw.push(s);
  };

  push(row.image_url);
  for (const img of normalizeImagesField(row.images)) {
    if (typeof img === 'string') push(img);
    else if (img && typeof img === 'object') {
      push(typeof img.src === 'string' ? img.src : typeof img.url === 'string' ? img.url : null);
    }
  }
  push(row.image_url_2);
  push(row.image_url_3);
  push(row.lifestyle_image_url);

  return dedupeImageUrlsPreserveOrder(raw);
}

/**
 * Lightweight gallery columns for list/card UIs — skips heavy `images` JSONB.
 * Order: image_url → image_url_2 → image_url_3 → lifestyle_image_url.
 */
export function collectProductGalleryUrlsLight(row: {
  image_url?: string | null;
  image_url_2?: string | null;
  image_url_3?: string | null;
  lifestyle_image_url?: string | null;
}): string[] {
  return collectProductGalleryUrls({ ...row, images: undefined });
}

/** Extra images under the main product image (non-clickable thumbs), max 4. */
export function productGalleryExtras(
  mainUrl: string | null | undefined,
  galleryUrls: string[] | null | undefined,
  maxExtras = 4,
): string[] {
  const main = (mainUrl || '').trim();
  const mainKey = main && isHttpUrl(main) ? imageIdentityKey(main) : '';
  const extras: string[] = [];
  for (const url of galleryUrls || []) {
    if (!isHttpUrl(url)) continue;
    if (mainKey && imageIdentityKey(url) === mainKey) continue;
    if (extras.some((existing) => imageIdentityKey(existing) === imageIdentityKey(url))) {
      continue;
    }
    extras.push(url);
    if (extras.length >= maxExtras) break;
  }
  return extras;
}

/** Full ordered list for lightbox (main first, then other gallery URLs). */
export function productGalleryLightboxUrls(
  mainUrl: string | null | undefined,
  galleryUrls: string[] | null | undefined,
): string[] {
  const main = (mainUrl || '').trim();
  return dedupeImageUrlsPreserveOrder([
    ...(isHttpUrl(main) ? [main] : []),
    ...(galleryUrls || []),
  ]);
}

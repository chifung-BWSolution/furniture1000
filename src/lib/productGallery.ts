/** Collect product gallery URLs from all image columns (catalog + detail views). */

import { dedupeImageUrlsPreserveOrder, isHttpUrl } from '@/lib/productMergeImages';

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

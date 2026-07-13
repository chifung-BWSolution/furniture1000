/** Shopify mirror image helpers — single source of truth for gallery order. */

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

/** Sort mirror/Shopify images by position ascending (1 = primary). */
export function sortShopifyImages(images: unknown): ShopifyMirrorImage[] {
  return normalizeImagesField(images)
    .filter((im) => {
      const src = (im.src || im.url || '').trim();
      return src.startsWith('http');
    })
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

function imageStem(url: string): string {
  return url.split('?')[0].split('/').pop()?.toLowerCase() || '';
}

/**
 * Primary thumbnail for 已上載產品: always the lowest-position Shopify image.
 * Falls back to image_url when images[] is empty.
 */
export function resolveMirrorPrimaryImageUrl(row: {
  image_url?: string | null;
  images?: unknown;
}): string {
  const sorted = sortShopifyImages(row.images);
  const fromGallery = (sorted[0]?.src || sorted[0]?.url || '').trim();
  if (fromGallery.startsWith('http')) return fromGallery;
  const direct = (row.image_url || '').trim();
  return direct.startsWith('http') ? direct : '';
}

/** Ordered unique gallery URLs [primary, ...extras] for display and metafields. */
export function resolveMirrorGalleryUrls(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (src?: string | null) => {
    const s = (src || '').trim();
    if (!s.startsWith('http')) return;
    const key = s.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(s);
  };

  for (const im of sortShopifyImages(row.images)) {
    add(im.src || im.url);
  }
  if (urls.length === 0) add(row.image_url);
  return urls;
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

/**
 * When Shopify position 1 is an _extra_ shot but a _primary_ / lifestyle image exists
 * later in the gallery, prefer the lifestyle/primary file for mirror thumbnail only.
 * (Shopify API order can lag behind admin drag-reorder for some products.)
 */
export function resolveMirrorPrimaryImageUrlSmart(row: {
  image_url?: string | null;
  images?: unknown;
}): string {
  const sorted = sortShopifyImages(row.images);
  if (sorted.length === 0) return resolveMirrorPrimaryImageUrl(row);

  const pos1Src = (sorted[0]?.src || sorted[0]?.url || '').trim();
  const pos1Stem = imageStem(pos1Src);
  const isExtraFirst = pos1Stem.includes('_extra');

  if (isExtraFirst) {
    const preferred = sorted.find((im) => {
      const stem = imageStem(im.src || im.url || '');
      return stem.includes('_primary_')
        || stem.includes('whatsapp')
        || stem.includes('dialog_file');
    });
    if (preferred) {
      const src = (preferred.src || preferred.url || '').trim();
      if (src.startsWith('http')) return src;
    }
  }

  return resolveMirrorPrimaryImageUrl(row);
}

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

function imageStem(url: string): string {
  return url.split('?')[0].split('/').pop()?.toLowerCase() || '';
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
 * Pick lifestyle scene as thumbnail when pos 1 is a white-bg _primary_ catalog shot
 * but WhatsApp / dialog_file office render / _img_ scene exists later.
 */
export function pickLifestylePrimaryImage(sorted: ShopifyMirrorImage[]): ShopifyMirrorImage | null {
  if (sorted.length === 0) return null;

  const whatsapp = sorted.find((im) => /whatsapp/i.test(imageSrc(im)));
  if (whatsapp) return whatsapp;

  const first = sorted[0];
  const firstStem = imageStem(imageSrc(first));
  if (!firstStem.includes('_primary_')) return first;

  const dialog = sorted.find((im) => imageStem(imageSrc(im)).includes('dialog_file'));
  if (dialog) return dialog;

  const imgScene = sorted.find((im) => /_img_/i.test(imageStem(imageSrc(im))));
  if (imgScene) return imgScene;

  return first;
}

/**
 * Primary thumbnail for 已上載產品 — lifestyle scene first when detectable.
 */
export function resolveMirrorPrimaryImageUrl(row: {
  image_url?: string | null;
  images?: unknown;
}): string {
  const sorted = sortShopifyImages(row.images);
  const preferred = pickLifestylePrimaryImage(sorted);
  const fromPreferred = imageSrc(preferred || {});
  if (fromPreferred.startsWith('http')) return fromPreferred;
  const direct = (row.image_url || '').trim();
  return direct.startsWith('http') ? direct : '';
}

/** Ordered gallery URLs [lifestyle primary, ...rest] for display. */
export function resolveMirrorGalleryUrls(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  const sorted = sortShopifyImages(row.images);
  const preferred = pickLifestylePrimaryImage(sorted);
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

  if (preferred) add(imageSrc(preferred));
  for (const im of sorted) add(imageSrc(im));
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

/** @deprecated Use resolveMirrorPrimaryImageUrl — kept for compatibility. */
export function resolveMirrorPrimaryImageUrlSmart(row: {
  image_url?: string | null;
  images?: unknown;
}): string {
  return resolveMirrorPrimaryImageUrl(row);
}

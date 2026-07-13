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
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (src?: string | null) => {
    const s = (src || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    urls.push(s);
  };

  add(row.image_url);
  add(row.image_url_2);
  add(row.image_url_3);
  for (const img of normalizeImagesField(row.images)) {
    if (typeof img === 'string') add(img);
    else if (img && typeof img === 'object') {
      const rec = img as Record<string, unknown>;
      add(typeof rec.src === 'string' ? rec.src : typeof rec.url === 'string' ? rec.url : null);
    }
  }
  return urls;
}

/**
 * ready_to_shopify gallery: image_url = primary, images[] = other photos.
 * Returns [primary, ...extras] in display order (deduped).
 */
export function parseRtsGalleryUrls(row: {
  image_url?: string | null;
  images?: unknown;
}): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (src?: string | null) => {
    const s = (src || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    urls.push(s);
  };

  add(row.image_url);
  for (const img of normalizeImagesField(row.images)) {
    if (typeof img === 'string') add(img);
    else if (img && typeof img === 'object') {
      const rec = img as Record<string, unknown>;
      add(typeof rec.src === 'string' ? rec.src : typeof rec.url === 'string' ? rec.url : null);
    }
  }
  return urls;
}

function httpImageKey(url: string): string {
  return url.split('?')[0];
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

  const pk = httpImageKey(effectivePrimary);
  const withoutPrimary = urls.filter((u) => httpImageKey(u) !== pk);
  return [effectivePrimary, ...withoutPrimary];
}

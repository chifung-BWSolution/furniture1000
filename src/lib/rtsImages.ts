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

/**
 * Build publish gallery: RTS image_url first, then images[].
 * Prepends products.image_url only when it is missing from the RTS gallery.
 */
export function buildPublishGalleryUrls(
  rts: { image_url?: string | null; images?: unknown } | null | undefined,
  productPrimary?: string | null,
): string[] {
  const urls = rts ? parseRtsGalleryUrls(rts) : [];
  const prodPrimary = (productPrimary || '').trim();
  if (!prodPrimary.startsWith('http')) return urls;

  const key = (u: string) => u.split('?')[0];
  const prodKey = key(prodPrimary);
  if (urls.some((u) => key(u) === prodKey)) return urls;
  if (urls.length === 0) return [prodPrimary];
  return [prodPrimary, ...urls];
}

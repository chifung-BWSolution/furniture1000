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

type GalleryRow = {
  image_url?: string | null;
  image_url_2?: string | null;
  image_url_3?: string | null;
  images?: unknown;
};

/** Merge gallery URLs from ready_to_shopify and products (deduped, RTS order first). */
export function mergeProductGalleryUrls(
  rts?: GalleryRow | null,
  prod?: GalleryRow | null,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const u of [...parseRtsImageUrls(rts ?? {}), ...parseRtsImageUrls(prod ?? {})]) {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }
  return urls;
}

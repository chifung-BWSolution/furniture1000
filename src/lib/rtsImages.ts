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

function urlStem(url: string): string {
  return url.split('?')[0].split('/').pop()?.toLowerCase() || '';
}

function isWhiteBgSlot(url: string): boolean {
  const s = urlStem(url);
  return s.includes('_primary_') || s.includes('_extra');
}

function isLifestyleSlot(url: string): boolean {
  const s = urlStem(url);
  return /whatsapp/i.test(s) || s.includes('dialog_file') || /_img_/i.test(s);
}

/** Pick lifestyle scene when pos 1 is a white-bg _primary_ catalog shot. */
function pickLifestyleFromUrls(urls: string[]): string | null {
  if (urls.length === 0) return null;

  const whatsapp = urls.find((u) => /whatsapp/i.test(u));
  if (whatsapp) return whatsapp;

  const first = urls[0];
  if (!urlStem(first).includes('_primary_')) return first;

  const dialog = urls.find((u) => urlStem(u).includes('dialog_file'));
  if (dialog) return dialog;

  const imgScene = urls.find((u) => /_img_/i.test(urlStem(u)));
  if (imgScene) return imgScene;

  return first;
}

function dedupeUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const s = (url || '').trim();
    if (!s.startsWith('http')) continue;
    const key = s.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Build publish gallery: RTS image_url + images[], with products.image_url fallback
 * when RTS lost the lifestyle primary but only has white-bg _primary_ / _extra shots.
 */
export function buildPublishGalleryUrls(
  rts: { image_url?: string | null; images?: unknown } | null | undefined,
  productPrimary?: string | null,
): string[] {
  let urls = rts ? parseRtsGalleryUrls(rts) : [];
  const prodPrimary = (productPrimary || '').trim();

  if (prodPrimary.startsWith('http')) {
    const key = (u: string) => u.split('?')[0];
    const prodKey = key(prodPrimary);
    const hasProd = urls.some((u) => key(u) === prodKey);
    const hasLifestyle = urls.some(isLifestyleSlot);
    const firstIsWhite = urls.length > 0 && isWhiteBgSlot(urls[0]);
    const prodIsLifestyle = isLifestyleSlot(prodPrimary);

    if (!hasProd) {
      if (urls.length === 0) {
        urls = [prodPrimary];
      } else if (prodIsLifestyle && (!hasLifestyle || firstIsWhite)) {
        urls = [prodPrimary, ...urls];
      }
    }
  }

  const preferred = pickLifestyleFromUrls(urls);
  if (preferred && urls[0] !== preferred) {
    const key = (u: string) => u.split('?')[0];
    const preferredKey = key(preferred);
    urls = [preferred, ...urls.filter((u) => key(u) !== preferredKey)];
  }

  return dedupeUrls(urls);
}

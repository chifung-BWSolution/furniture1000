/** Collect unique image URLs from ready_to_shopify image_url + images jsonb. */
export function parseRtsImageUrls(row: {
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
  const imgs = Array.isArray(row.images) ? row.images : [];
  for (const img of imgs) {
    if (typeof img === 'string') add(img);
    else if (img && typeof img === 'object') {
      const rec = img as Record<string, unknown>;
      add(typeof rec.src === 'string' ? rec.src : typeof rec.url === 'string' ? rec.url : null);
    }
  }
  return urls;
}

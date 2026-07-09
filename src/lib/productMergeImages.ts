/** Shared image helpers for product merge / variant UIs (已上載 + 準備上載). */

export function isHttpUrl(src: unknown): src is string {
  return typeof src === 'string' && /^https?:\/\//.test(src);
}

export function normalizeImageUrl(src: string): string {
  try {
    const u = new URL(src);
    return `${u.origin}${u.pathname}`;
  } catch {
    return src.split('?')[0] ?? src;
  }
}

export function imageDedupeKey(src: string): string {
  return normalizeImageUrl(src).replace(
    /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[a-z0-9]+$)/i,
    '',
  );
}

export function dedupeImageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!isHttpUrl(url)) continue;
    const key = imageDedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export function dedupeGalleryUrls(urls: string[], primarySrc: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (src: string | null | undefined) => {
    if (!isHttpUrl(src)) return;
    const key = imageDedupeKey(src);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(src);
  };
  if (primarySrc) add(primarySrc);
  for (const url of urls) add(url);
  return out;
}

export interface MergeVariantRowBase {
  key: string;
  sku: string;
  price: number;
  size: string;
  option1: string;
  inventory: number;
  imageSrc: string | null;
}

/**
 * When multiple merge rows share the same SKU, keep the lowest-price row on the base SKU;
 * others become `{base}-1`, `{base}-2`, … (ties broken by size label).
 */
export function assignDuplicateMergeSkus<T extends MergeVariantRowBase>(rows: T[]): T[] {
  if (rows.length === 0) return rows;
  const next = rows.map((r) => ({ ...r }));
  const groups = new Map<string, number[]>();
  next.forEach((row, idx) => {
    const sku = row.sku.trim();
    if (!sku) return;
    const list = groups.get(sku) ?? [];
    list.push(idx);
    groups.set(sku, list);
  });
  for (const [baseSku, indices] of groups) {
    if (indices.length <= 1) continue;
    const sorted = [...indices].sort((a, b) => {
      const priceDiff = next[a].price - next[b].price;
      if (priceDiff !== 0) return priceDiff;
      return next[a].size.localeCompare(next[b].size, 'zh-Hant');
    });
    sorted.forEach((idx, rank) => {
      next[idx] = {
        ...next[idx],
        sku: rank === 0 ? baseSku : `${baseSku}-${rank}`,
      };
    });
  }
  return next;
}

export function buildMoreImageMetafields(
  orderedUrls: string[],
  title?: string | null,
): Record<string, string> {
  const mf: Record<string, string> = {};
  const deduped = dedupeImageUrls(orderedUrls);
  for (let i = 0; i < Math.min(deduped.length, 4); i++) {
    mf[`custom.more_image_link_${i + 1}`] = deduped[i];
    if (title?.trim()) mf[`custom.more_image_alt_${i + 1}`] = title.trim();
  }
  return mf;
}

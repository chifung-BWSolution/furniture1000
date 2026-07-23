/** Shared image helpers for product merge / variant UIs (已上載 + 準備上載). */

import { buildMoreImageMetafieldColumns } from '@/lib/shopifyMetafieldImages';

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

/**
 * Filename stem — matches Storage vs Shopify CDN for the same asset.
 * Also collapses Shopify re-upload suffixes ONLY:
 * - short numeric (`foo.jpg` → `foo_1.jpg` / `foo_12.jpg`)
 * - UUID (`foo.jpg` → `foo_<uuid>.jpg`)
 *
 * Do NOT strip long digit tails (timestamps like `_1781790000001`) or
 * meaningful sequences (`_img_0010` vs `_img_0011`) — that falsely merges
 * different gallery images into one identity.
 */
export function imageIdentityKey(src: string): string {
  const noQuery = src.split('?')[0];
  const base = noQuery.substring(noQuery.lastIndexOf('/') + 1);
  let stem = base
    .replace(/\.[a-zA-Z0-9]+$/, '')
    .replace(
      /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      '',
    )
    .trim()
    .toLowerCase();
  // Only collapse Shopify CDN re-upload suffixes (_1 / _12), not Storage timestamps.
  if (/cdn\.shopify\.com/i.test(src)) {
    stem = stem.replace(/_\d{1,2}$/, '');
  }
  return stem;
}

/**
 * @deprecated Filename role sorting removed — gallery order is user/DB order only.
 * Kept as a no-op classifier for any legacy callers.
 */
export function imageRolePriority(_url: string): number {
  return 1;
}

/** @deprecated No role sort — returns URLs unchanged (caller should use dedupe helpers). */
export function sortUrlsPrimaryFirst(urls: string[]): string[] {
  return [...urls];
}

export function imageDedupeKey(src: string): string {
  const stem = imageIdentityKey(src);
  if (stem) return stem;
  return normalizeImageUrl(src).replace(
    /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[a-z0-9]+$)/i,
    '',
  );
}

/** Dedupe by filename stem; keep first occurrence order (merge / UI / publish). */
export function dedupeImageUrlsPreserveOrder(urls: string[]): string[] {
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

/**
 * Dedupe by filename stem; keep first occurrence order.
 * Primary is whatever the caller put first (RTS image_url / user drag slot) — no filename role sort.
 */
export function dedupeImageUrls(urls: string[]): string[] {
  return dedupeImageUrlsPreserveOrder(urls);
}

export function dedupeGalleryUrls(urls: string[], primarySrc: string | null): string[] {
  const merged = primarySrc ? [primarySrc, ...urls] : urls;
  return dedupeImageUrlsPreserveOrder(merged);
}

/** Collect HTTP image URLs from a mirror row — image_url first, then images[] order. */
export function collectMergeProductImageUrls(product: {
  image_url?: string | null;
  images?: Array<{ src?: string | null }> | null;
}): string[] {
  const raw: string[] = [];
  if (isHttpUrl(product.image_url)) raw.push(product.image_url);
  for (const im of product.images ?? []) {
    if (isHttpUrl(im?.src)) raw.push(im.src);
  }
  return dedupeImageUrlsPreserveOrder(raw);
}

export function buildMergeGalleryFromProducts(
  productOrder: string[],
  productByShopifyId: Map<string, { image_url?: string | null; images?: Array<{ src?: string | null }> | null }>,
): string[] {
  const raw: string[] = [];
  for (const shopifyId of productOrder) {
    const product = productByShopifyId.get(shopifyId);
    if (!product) continue;
    raw.push(...collectMergeProductImageUrls(product));
  }
  return dedupeImageUrlsPreserveOrder(raw);
}

/** First URL in the given order (after stem-dedupe). */
export function pickBestPrimaryImageUrl(urls: string[]): string {
  return dedupeImageUrlsPreserveOrder(urls)[0] ?? '';
}

/**
 * @deprecated Use the first gallery URL / ready_to_shopify.image_url instead.
 * Kept as alias of first-in-order for any legacy callers.
 */
export function pickScenarioPrimaryImageUrl(urls: string[]): string {
  return pickBestPrimaryImageUrl(urls);
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
  const cols = buildMoreImageMetafieldColumns(dedupeImageUrlsPreserveOrder(orderedUrls), title);
  const mf: Record<string, string> = {};
  for (const [col, val] of Object.entries(cols)) {
    if (val != null && String(val).trim()) mf[col] = String(val).trim();
  }
  return mf;
}

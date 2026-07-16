import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { containsSimplifiedChinese, simplifiedToTraditional } from "../_shared/chineseConverter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

/** Shopify REST/GraphQL — stay under ~2 req/s and retry 429. */
const SHOPIFY_MIN_INTERVAL_MS = 550;
let lastShopifyCallAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyFetch(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= 5; attempt++) {
    const now = Date.now();
    const gap = SHOPIFY_MIN_INTERVAL_MS - (now - lastShopifyCallAt);
    if (gap > 0) await sleep(gap);
    lastShopifyCallAt = Date.now();

    const resp = await fetch(url, init);
    if (resp.status !== 429 || attempt === 5) return resp;

    const retryAfterSec = Number(resp.headers.get("Retry-After") || 0);
    const backoffMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 1200 * (attempt + 1);
    await sleep(backoffMs);
    lastShopifyCallAt = Date.now();
  }
  return fetch(url, init);
}

// "namespace.key" → Shopify metafield type. Mirrors the columns on shopify_products.
const METAFIELD_DEFS: Record<string, string> = {
  "my_fields.recommend_size": "multi_line_text_field",
  "my_fields.normal_size": "multi_line_text_field",
  "my_fields.materials": "multi_line_text_field",
  "my_fields.production_time": "multi_line_text_field",
  "my_fields.more_recommend_size": "multi_line_text_field",
  "my_fields.image_alt": "multi_line_text_field",
  "my_fields.image_link": "url",
  "my_fields.video_link": "url",
  "custom.more_image_link_1": "url",
  "custom.more_image_alt_1": "multi_line_text_field",
  "custom.more_image_link_2": "url",
  "custom.more_image_alt_2": "multi_line_text_field",
  "custom.more_image_link_3": "url",
  "custom.more_image_alt_3": "multi_line_text_field",
  "custom.more_image_link_4": "url",
  "custom.more_image_alt_4": "multi_line_text_field",
};

type PushPayload = {
  source_product_id?: string | null;
  title?: string;
  body_html?: string;
  price?: number | null;
  compare_at_price?: number | null;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  images?: string[];
  image_url?: string | null;
  /** Full mirror images (id + src) for resolving variant thumbnails on sync. */
  product_images?: { id?: string | number; src?: string }[];
  variants?: {
    id?: string | number;
    index?: number;
    sku?: string | null;
    option1?: string | null;
    price?: number | string | null;
    image_id?: string | number | null;
  }[];
  sku?: string | null;
  metafields?: Record<string, string>;
  handle?: string;
  seo_title?: string;
  seo_description?: string;
};

/** RTS / mirror shopify_url may be "products/slug" — Shopify handle wants "slug". */
function normalizeShopifyHandle(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  let h = raw.trim().replace(/^\/+/, "");
  if (h.startsWith("products/")) h = h.slice("products/".length);
  return h || null;
}

/** Update handle + SEO via GraphQL (REST product PUT does not expose seo fields). */
async function updateSeoAndHandle(
  shopDomain: string,
  token: string,
  shopifyId: string,
  opts: { handle?: string; seoTitle?: string; seoDescription?: string },
): Promise<{ ok: boolean; error?: string }> {
  const input: Record<string, unknown> = { id: `gid://shopify/Product/${shopifyId}` };
  const hasHandle = typeof opts.handle === "string" && opts.handle.trim();
  if (hasHandle) input.handle = opts.handle!.trim();
  if (opts.seoTitle !== undefined || opts.seoDescription !== undefined) {
    input.seo = {
      title: opts.seoTitle ?? "",
      description: opts.seoDescription ?? "",
    };
  }
  if (!hasHandle && input.seo === undefined) return { ok: true };

  const resp = await shopifyFetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id handle seo { title description } }
          userErrors { field message }
        }
      }`,
      variables: { input },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return { ok: false, error: `GraphQL SEO update failed (${resp.status}): ${t.slice(0, 200)}` };
  }
  const j = await resp.json();
  const errors = j?.data?.productUpdate?.userErrors;
  if (Array.isArray(errors) && errors.length > 0) {
    return { ok: false, error: errors.map((e: { message: string }) => e.message).join("; ") };
  }
  if (j?.errors?.length) {
    return { ok: false, error: j.errors.map((e: { message: string }) => e.message).join("; ") };
  }
  return { ok: true };
}

/** Build Shopify-format metafields from a {"namespace.key": value} map. */
function buildMetafields(mf: Record<string, string> | undefined) {
  if (!mf) return [];
  const out: { namespace: string; key: string; type: string; value: string }[] = [];
  for (const [col, raw] of Object.entries(mf)) {
    const val = raw != null ? String(raw).trim() : "";
    if (!val) continue;
    const dot = col.indexOf(".");
    if (dot < 0) continue;
    const namespace = col.slice(0, dot);
    const key = col.slice(dot + 1);
    if (namespace === "shopify") continue;
    out.push({ namespace, key, type: METAFIELD_DEFS[col] || "single_line_text_field", value: val });
  }
  return out;
}

const MORE_IMAGE_LINK_COLS = [1, 2, 3, 4].map((i) => `custom.more_image_link_${i}`);
const MORE_IMAGE_ALT_COLS = [1, 2, 3, 4].map((i) => `custom.more_image_alt_${i}`);

/** more_image_link_1..4 ← first four mirror media URLs (position 1 = Shopify 主圖). */
function applyMoreImageLinkMetafields(
  metafields: Record<string, string>,
  orderedUrls: string[],
  title?: string | null,
): void {
  for (let i = 1; i <= 4; i++) {
    const linkKey = `custom.more_image_link_${i}`;
    const altKey = `custom.more_image_alt_${i}`;
    const url = orderedUrls[i - 1];
    if (url && /^https?:\/\//.test(url)) {
      metafields[linkKey] = url;
      const alt = title?.trim();
      if (alt) metafields[altKey] = alt;
      else delete metafields[altKey];
    } else {
      delete metafields[linkKey];
      delete metafields[altKey];
    }
  }
}

function moreImageLinkColumnsFromUrls(
  orderedUrls: string[],
  title?: string | null,
): Record<string, string | null> {
  const cols: Record<string, string | null> = {};
  for (let i = 1; i <= 4; i++) {
    const url = orderedUrls[i - 1];
    const linkKey = `custom.more_image_link_${i}`;
    const altKey = `custom.more_image_alt_${i}`;
    if (url && /^https?:\/\//.test(url)) {
      cols[linkKey] = url;
      cols[altKey] = title?.trim() ? title.trim() : null;
    } else {
      cols[linkKey] = null;
      cols[altKey] = null;
    }
  }
  return cols;
}

async function upsertProductMetafield(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  col: string,
  value: string,
): Promise<boolean> {
  const dot = col.indexOf(".");
  if (dot < 0) return false;
  const namespace = col.slice(0, dot);
  const key = col.slice(dot + 1);
  const type = METAFIELD_DEFS[col] || "single_line_text_field";
  const trimmed = value.trim();

  const existingResp = await shopifyFetch(
    `${apiBase}/products/${shopifyId}/metafields.json?namespace=${namespace}&key=${key}`,
    { headers },
  );
  const existing = existingResp.ok
    ? ((await existingResp.json()).metafields?.[0] as { id?: number; value?: string } | undefined)
    : undefined;

  if (!trimmed) {
    if (existing?.id) {
      const del = await shopifyFetch(`${apiBase}/metafields/${existing.id}.json`, { method: "DELETE", headers });
      return del.ok;
    }
    return true;
  }

  if (existing?.value === trimmed) return true;

  if (existing?.id) {
    const pr = await shopifyFetch(`${apiBase}/metafields/${existing.id}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ metafield: { id: existing.id, type, value: trimmed } }),
    });
    return pr.ok;
  }

  const r = await shopifyFetch(`${apiBase}/products/${shopifyId}/metafields.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ metafield: { namespace, key, type, value: trimmed } }),
  });
  return r.ok;
}

async function syncProductMetafieldsToShopify(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  metafields: Record<string, string> | undefined,
  liveMap?: Map<string, string>,
): Promise<{ ok: number; fail: number; skipped: number }> {
  let ok = 0;
  let fail = 0;
  let skipped = 0;
  const mf = metafields || {};
  const cols = expectedMetafieldCols(mf);
  const resolvedLiveMap = liveMap ?? await fetchLiveMetafieldMap(apiBase, headers, shopifyId);

  for (const col of cols) {
    const isMoreImage = MORE_IMAGE_LINK_COLS.includes(col) || MORE_IMAGE_ALT_COLS.includes(col);
    if (!isMoreImage && !(col in mf)) continue;
    const want = (mf[col] ?? "").trim();
    const live = (resolvedLiveMap.get(col) ?? "").trim();
    if (want === live) {
      skipped++;
      continue;
    }
    try {
      const success = await upsertProductMetafield(apiBase, headers, shopifyId, col, mf[col] ?? "");
      if (success) ok++;
      else fail++;
    } catch {
      fail++;
    }
  }
  return { ok, fail, skipped };
}

function firstSkuFromVariants(variants: Record<string, unknown>[]): string | null {
  for (const variant of variants) {
    const sku = typeof variant.sku === "string" ? variant.sku.trim() : "";
    if (sku) return sku;
  }
  return null;
}

/** Another mirror row already claims this URL handle — Shopify handles must be unique. */
async function mirrorHandleUsedByOther(
  supabase: ReturnType<typeof createClient>,
  handle: string,
  shopifyId: string,
): Promise<boolean> {
  const { data: byUrl } = await supabase
    .from("shopify_products")
    .select("shopify_product_id")
    .eq("shopify_url", handle)
    .neq("shopify_product_id", shopifyId)
    .limit(1);
  if (byUrl && byUrl.length > 0) return true;
  const { data: byHandle } = await supabase
    .from("shopify_products")
    .select("shopify_product_id")
    .eq("handle", handle)
    .neq("shopify_product_id", shopifyId)
    .limit(1);
  return !!(byHandle && byHandle.length > 0);
}

function normalizeImageUrl(src: string): string {
  try {
    const u = new URL(src);
    return `${u.origin}${u.pathname}`;
  } catch {
    return src.split("?")[0] ?? src;
  }
}

const SHOPIFY_IMAGE_UUID_SUFFIX =
  /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[a-z0-9]+$)/i;

/** Filename stem — matches Storage vs Shopify CDN; collapses `foo_1` / `foo_<uuid>`. */
function imageIdentityKey(src: string): string {
  const noQuery = src.split("?")[0];
  const base = noQuery.substring(noQuery.lastIndexOf("/") + 1);
  return base
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(
      /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "",
    )
    .replace(/_\d{1,2}$/, "")
    .trim()
    .toLowerCase();
}

/** Prefer stem so Storage URL ≡ CDN URL; fall back to path without UUID suffix. */
function imageDedupeKey(src: string): string {
  const stem = imageIdentityKey(src);
  if (stem) return stem;
  return normalizeImageUrl(src).replace(SHOPIFY_IMAGE_UUID_SUFFIX, "");
}

function hasShopifyImageUuidSuffix(src: string): boolean {
  return SHOPIFY_IMAGE_UUID_SUFFIX.test(normalizeImageUrl(src));
}

function pickPreferredImage(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  primarySrc: string | null,
): Record<string, unknown> {
  const srcA = String(a.src ?? "");
  const srcB = String(b.src ?? "");
  if (primarySrc) {
    const pk = imageDedupeKey(primarySrc);
    const keyA = imageDedupeKey(srcA);
    const keyB = imageDedupeKey(srcB);
    if (keyA === pk && keyB === pk) {
      const normPrimary = normalizeImageUrl(primarySrc);
      const aExact = srcA === primarySrc || normalizeImageUrl(srcA) === normPrimary;
      const bExact = srcB === primarySrc || normalizeImageUrl(srcB) === normPrimary;
      if (aExact && !bExact) return a;
      if (bExact && !aExact) return b;
      const aNoUuid = !hasShopifyImageUuidSuffix(srcA);
      const bNoUuid = !hasShopifyImageUuidSuffix(srcB);
      if (aNoUuid && !bNoUuid) return a;
      if (bNoUuid && !aNoUuid) return b;
    }
  }
  return srcA.length <= srcB.length ? a : b;
}

function indexLiveImagesByDedupe(
  images: Record<string, unknown>[],
  primarySrc: string | null = null,
): Map<string, Record<string, unknown>> {
  const byDedupe = new Map<string, Record<string, unknown>>();
  for (const im of images) {
    const src = im.src;
    if (typeof src !== "string" || !/^https?:\/\//.test(src)) continue;
    const key = imageDedupeKey(src);
    const prev = byDedupe.get(key);
    byDedupe.set(key, prev ? pickPreferredImage(prev, im, primarySrc) : im);
  }
  return byDedupe;
}

function pickCanonicalForKey(
  liveImages: Record<string, unknown>[],
  key: string,
  primarySrc: string | null,
  byDedupe: Map<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const candidates = liveImages.filter(
    (im) => typeof im.src === "string" && imageDedupeKey(im.src) === key,
  );
  if (candidates.length === 0) return byDedupe.get(key);
  if (candidates.length === 1) return candidates[0];
  return candidates.reduce(
    (best, cur) => pickPreferredImage(best, cur, primarySrc),
  );
}

function resolveAttachImageSrc(src: string, primarySrc: string | null): string {
  if (primarySrc && imageDedupeKey(src) === imageDedupeKey(primarySrc)) {
    return primarySrc;
  }
  return src;
}

type MirrorImageRef = {
  id?: string | number;
  src?: string;
  position?: number;
  alt?: string;
  width?: number;
  height?: number;
  variant_ids?: (string | number)[];
};

/** Keep one image per dedupe key, primary first. */
function dedupeMirrorImages(
  productImages: MirrorImageRef[],
  primarySrc: string | null,
): MirrorImageRef[] {
  const sorted = [...productImages].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const seen = new Set<string>();
  const out: MirrorImageRef[] = [];
  const add = (im: MirrorImageRef) => {
    if (!im.src || !/^https?:\/\//.test(im.src)) return;
    const key = imageDedupeKey(im.src);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...im });
  };
  if (primarySrc && /^https?:\/\//.test(primarySrc)) {
    const match = sorted.find(
      (im) => im.src && imageDedupeKey(im.src) === imageDedupeKey(primarySrc),
    );
    add(match ?? { src: primarySrc });
  }
  for (const im of sorted) add(im);
  return out.map((im, i) => ({ ...im, position: i + 1 }));
}

function orderedLiveGalleryDedupeKeys(
  liveImages: Record<string, unknown>[],
  primarySrc: string | null,
): string[] {
  const sorted = [...liveImages]
    .filter((im) => typeof im.src === "string" && /^https?:\/\//.test(im.src))
    .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99));
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const im of sorted) {
    const key = imageDedupeKey(resolveAttachImageSrc(im.src as string, primarySrc));
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function mirrorGalleryDedupeKeys(
  dedupedMirror: MirrorImageRef[],
  primarySrc: string | null,
): string[] {
  return dedupedMirror
    .map((im) => imageDedupeKey(resolveAttachImageSrc(String(im.src ?? ""), primarySrc)))
    .filter(Boolean);
}

function liveGalleryMatchesMirror(
  liveImages: Record<string, unknown>[],
  dedupedMirror: MirrorImageRef[],
  primarySrc: string | null,
): boolean {
  if (dedupedMirror.length === 0) return true;
  const liveKeys = orderedLiveGalleryDedupeKeys(liveImages, primarySrc);
  const mirrorKeys = mirrorGalleryDedupeKeys(dedupedMirror, primarySrc);
  if (liveKeys.length !== mirrorKeys.length) return false;
  return liveKeys.every((k, i) => k === mirrorKeys[i]);
}

function variantImageIdsMatchMirror(
  liveVariants: Record<string, unknown>[],
  mirrorVariants: NonNullable<PushPayload["variants"]>,
  productImages: { id?: string | number; src?: string }[],
  liveImages: Record<string, unknown>[],
  primarySrc: string | null,
): boolean {
  const byDedupe = indexLiveImagesByDedupe(liveImages, primarySrc);
  for (const mv of mirrorVariants) {
    if (mv.id == null || mv.image_id == null) continue;
    const rawSrc = mirrorImageSrcById(mv.image_id, productImages);
    if (!rawSrc) continue;
    const src = resolveAttachImageSrc(rawSrc, primarySrc);
    const target = byDedupe.get(imageDedupeKey(src));
    const expectedId = target?.id != null ? Number(target.id) : null;
    const live = liveVariants.find((v) => String(v.id) === String(mv.id));
    const currentId = live?.image_id != null ? Number(live.image_id) : null;
    if (expectedId !== currentId) return false;
  }
  return true;
}

function normalizeTagsForCompare(tags: unknown): string {
  if (Array.isArray(tags)) return tags.filter(Boolean).join(", ");
  return String(tags || "");
}

function productCoreFieldsMatch(
  existing: Record<string, unknown>,
  existingVariants: Record<string, unknown>[],
  payload: {
    title?: string;
    bodyHtml?: string;
    vendor?: string;
    productType?: string;
    tags?: string[] | string;
    variants?: PushPayload["variants"];
    price?: number | null;
    compareAtPrice?: number | null;
    sku?: string | null;
  },
): boolean {
  if (typeof payload.title === "string" && payload.title.trim()) {
    if (String(existing.title ?? "").trim() !== payload.title.trim()) return false;
  }
  if (typeof payload.bodyHtml === "string") {
    if (String(existing.body_html ?? "") !== payload.bodyHtml) return false;
  }
  if (typeof payload.vendor === "string") {
    if (String(existing.vendor ?? "") !== payload.vendor) return false;
  }
  if (typeof payload.productType === "string") {
    if (String(existing.product_type ?? "") !== payload.productType) return false;
  }
  if (payload.tags !== undefined) {
    if (normalizeTagsForCompare(existing.tags) !== normalizeTagsForCompare(payload.tags)) return false;
  }

  const requestedVariantSkus = new Map<string, string | null>();
  const requestedVariantOptions = new Map<string, string | null>();
  const requestedVariantPrices = new Map<string, string | null>();
  if (Array.isArray(payload.variants)) {
    for (const [index, variant] of payload.variants.entries()) {
      const key = variant.id != null ? String(variant.id) : `index-${variant.index ?? index}`;
      requestedVariantSkus.set(key, variant.sku == null ? null : String(variant.sku).trim());
      if (variant.option1 != null) requestedVariantOptions.set(key, String(variant.option1).trim());
      if (variant.price != null && !isNaN(Number(variant.price))) {
        requestedVariantPrices.set(key, Number(variant.price).toFixed(2));
      }
    }
  }
  const fallbackSku = payload.sku == null ? undefined : String(payload.sku).trim();
  const shouldCheckVariants =
    (payload.price != null && !isNaN(Number(payload.price))) ||
    requestedVariantSkus.size > 0 ||
    requestedVariantOptions.size > 0 ||
    requestedVariantPrices.size > 0 ||
    fallbackSku !== undefined;

  if (!shouldCheckVariants) return true;

  for (const [index, v] of existingVariants.entries()) {
    const idKey = v.id != null ? String(v.id) : "";
    const indexKey = `index-${index}`;
    const variantPrice = requestedVariantPrices.get(idKey) ?? requestedVariantPrices.get(indexKey);
    if (variantPrice != null && String(v.price ?? "") !== variantPrice) return false;
    if (
      payload.price != null &&
      !isNaN(Number(payload.price)) &&
      variantPrice == null &&
      String(v.price ?? "") !== Number(payload.price).toFixed(2)
    ) return false;
    if (requestedVariantSkus.has(idKey)) {
      if (String(v.sku ?? "").trim() !== (requestedVariantSkus.get(idKey) || "")) return false;
    } else if (requestedVariantSkus.has(indexKey)) {
      if (String(v.sku ?? "").trim() !== (requestedVariantSkus.get(indexKey) || "")) return false;
    } else if (fallbackSku !== undefined && existingVariants.length === 1) {
      if (String(v.sku ?? "").trim() !== fallbackSku) return false;
    }
    if (requestedVariantOptions.has(idKey)) {
      if (String(v.option1 ?? "").trim() !== (requestedVariantOptions.get(idKey) || "")) return false;
    } else     if (requestedVariantOptions.has(indexKey)) {
      if (String(v.option1 ?? "").trim() !== (requestedVariantOptions.get(indexKey) || "")) return false;
    }
    if (
      payload.compareAtPrice != null &&
      !isNaN(Number(payload.compareAtPrice)) &&
      payload.price != null &&
      !isNaN(Number(payload.price)) &&
      Number(payload.compareAtPrice) > Number(payload.price)
    ) {
      const liveCompare = v.compare_at_price != null ? Number(v.compare_at_price) : null;
      if (liveCompare !== Number(payload.compareAtPrice)) return false;
    }
  }
  return true;
}

type LiveSeoState = {
  handle: string;
  seoTitle: string;
  seoDescription: string;
};

async function fetchLiveProductSeo(
  shopDomain: string,
  token: string,
  shopifyId: string,
): Promise<LiveSeoState | null> {
  const resp = await shopifyFetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `query ProductSeo($id: ID!) {
        product(id: $id) {
          handle
          seo { title description }
        }
      }`,
      variables: { id: `gid://shopify/Product/${shopifyId}` },
    }),
  });
  if (!resp.ok) return null;
  const j = await resp.json();
  const product = j?.data?.product;
  if (!product) return null;
  return {
    handle: typeof product.handle === "string" ? product.handle.trim() : "",
    seoTitle: typeof product.seo?.title === "string" ? product.seo.title.trim() : "",
    seoDescription: typeof product.seo?.description === "string" ? product.seo.description.trim() : "",
  };
}

function liveMetafieldMapFromResponse(metafields: { namespace?: string; key?: string; value?: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const mf of metafields) {
    if (!mf.namespace || !mf.key) continue;
    map.set(`${mf.namespace}.${mf.key}`, String(mf.value ?? "").trim());
  }
  return map;
}

async function fetchLiveMetafieldMap(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
): Promise<Map<string, string>> {
  const resp = await shopifyFetch(`${apiBase}/products/${shopifyId}/metafields.json?limit=250`, { headers });
  if (!resp.ok) return new Map();
  const j = await resp.json();
  return liveMetafieldMapFromResponse(Array.isArray(j.metafields) ? j.metafields : []);
}

function expectedMetafieldCols(metafields: Record<string, string>): Set<string> {
  const cols = new Set<string>([
    ...Object.keys(metafields),
    ...MORE_IMAGE_LINK_COLS,
    ...MORE_IMAGE_ALT_COLS,
  ]);
  return new Set([...cols].filter((col) => METAFIELD_DEFS[col]));
}

function metafieldsMatchMirror(
  liveMap: Map<string, string>,
  expected: Record<string, string>,
): boolean {
  for (const col of expectedMetafieldCols(expected)) {
    const want = (expected[col] ?? "").trim();
    const live = (liveMap.get(col) ?? "").trim();
    if (want !== live) return false;
  }
  return true;
}

function seoMatchesMirror(
  liveSeo: LiveSeoState | null,
  existingHandle: string,
  handle: string | undefined,
  seoTitle: string | undefined,
  seoDescription: string | undefined,
): boolean {
  const normalizedHandle = normalizeShopifyHandle(handle) || undefined;
  const wantHandle = normalizedHandle || existingHandle;
  const wantSeoTitle = typeof seoTitle === "string" ? seoTitle.trim() : "";
  const wantSeoDesc = typeof seoDescription === "string" ? seoDescription.trim() : "";

  if (!liveSeo) {
    return !normalizedHandle || normalizedHandle === existingHandle;
  }
  if (wantHandle && liveSeo.handle !== wantHandle) return false;
  if (wantSeoTitle !== liveSeo.seoTitle) return false;
  if (wantSeoDesc !== liveSeo.seoDescription) return false;
  return true;
}

type MirrorLiveDiff = {
  core: boolean;
  gallery: boolean;
  variantImages: boolean;
  metafields: boolean;
  seo: boolean;
};

function hasSyncWork(diff: MirrorLiveDiff): boolean {
  return diff.core || diff.gallery || diff.variantImages || diff.metafields || diff.seo;
}

/** Granular labels for partial core sync (title-only, price-only, etc.). */
function coreChangeLabels(
  existing: Record<string, unknown>,
  existingVariants: Record<string, unknown>[],
  payload: {
    title?: string;
    bodyHtml?: string;
    vendor?: string;
    productType?: string;
    tags?: string[] | string;
    variants?: PushPayload["variants"];
    price?: number | null;
    compareAtPrice?: number | null;
    sku?: string | null;
  },
): string[] {
  const labels: string[] = [];
  if (typeof payload.title === "string" && payload.title.trim()
    && String(existing.title ?? "").trim() !== payload.title.trim()) {
    labels.push("title");
  }
  if (typeof payload.bodyHtml === "string"
    && String(existing.body_html ?? "") !== payload.bodyHtml) {
    labels.push("description");
  }
  if (typeof payload.vendor === "string"
    && String(existing.vendor ?? "") !== payload.vendor) {
    labels.push("vendor");
  }
  if (typeof payload.productType === "string"
    && String(existing.product_type ?? "") !== payload.productType) {
    labels.push("product_type");
  }
  if (payload.tags !== undefined
    && normalizeTagsForCompare(existing.tags) !== normalizeTagsForCompare(payload.tags)) {
    labels.push("tags");
  }

  const requestedVariantSkus = new Map<string, string | null>();
  const requestedVariantOptions = new Map<string, string | null>();
  const requestedVariantPrices = new Map<string, string | null>();
  if (Array.isArray(payload.variants)) {
    for (const [index, variant] of payload.variants.entries()) {
      const key = variant.id != null ? String(variant.id) : `index-${variant.index ?? index}`;
      requestedVariantSkus.set(key, variant.sku == null ? null : String(variant.sku).trim());
      if (variant.option1 != null) requestedVariantOptions.set(key, String(variant.option1).trim());
      if (variant.price != null && !isNaN(Number(variant.price))) {
        requestedVariantPrices.set(key, Number(variant.price).toFixed(2));
      }
    }
  }
  const fallbackSku = payload.sku == null ? undefined : String(payload.sku).trim();

  for (const [index, v] of existingVariants.entries()) {
    const idKey = v.id != null ? String(v.id) : "";
    const indexKey = `index-${index}`;
    const variantPrice = requestedVariantPrices.get(idKey) ?? requestedVariantPrices.get(indexKey);
    if (variantPrice != null && String(v.price ?? "") !== variantPrice && !labels.includes("price")) {
      labels.push("price");
    }
    if (payload.price != null && !isNaN(Number(payload.price)) && variantPrice == null
      && String(v.price ?? "") !== Number(payload.price).toFixed(2) && !labels.includes("price")) {
      labels.push("price");
    }
    if (requestedVariantSkus.has(idKey)) {
      if (String(v.sku ?? "").trim() !== (requestedVariantSkus.get(idKey) || "") && !labels.includes("sku")) {
        labels.push("sku");
      }
    } else if (requestedVariantSkus.has(indexKey)) {
      if (String(v.sku ?? "").trim() !== (requestedVariantSkus.get(indexKey) || "") && !labels.includes("sku")) {
        labels.push("sku");
      }
    } else if (fallbackSku !== undefined && existingVariants.length === 1
      && String(v.sku ?? "").trim() !== fallbackSku && !labels.includes("sku")) {
      labels.push("sku");
    }
    if (requestedVariantOptions.has(idKey)) {
      if (String(v.option1 ?? "").trim() !== (requestedVariantOptions.get(idKey) || "")
        && !labels.includes("variants")) {
        labels.push("variants");
      }
    } else if (requestedVariantOptions.has(indexKey)) {
      if (String(v.option1 ?? "").trim() !== (requestedVariantOptions.get(indexKey) || "")
        && !labels.includes("variants")) {
        labels.push("variants");
      }
    }
    if (
      payload.compareAtPrice != null && !isNaN(Number(payload.compareAtPrice))
      && payload.price != null && !isNaN(Number(payload.price))
      && Number(payload.compareAtPrice) > Number(payload.price)
    ) {
      const liveCompare = v.compare_at_price != null ? Number(v.compare_at_price) : null;
      if (liveCompare !== Number(payload.compareAtPrice) && !labels.includes("compare_at_price")) {
        labels.push("compare_at_price");
      }
    }
  }
  return labels;
}

function diffToChangeLabels(diff: MirrorLiveDiff, coreLabels: string[]): string[] {
  const out: string[] = [];
  if (diff.core) out.push(...coreLabels);
  if (diff.gallery) out.push("images");
  if (diff.variantImages) out.push("variant_images");
  if (diff.metafields) out.push("metafields");
  if (diff.seo) out.push("seo");
  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

function mapLiveImagesForMirror(images: Record<string, unknown>[]) {
  return images.map((im, i) => ({
    id: im.id,
    src: im.src,
    alt: im.alt ?? "",
    width: im.width,
    height: im.height,
    position: i + 1,
    variant_ids: im.variant_ids,
  }));
}

/** PUT explicit positions so Shopify featured image matches mirror gallery order. */
async function reorderShopifyProductImages(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  kept: Record<string, unknown>[],
): Promise<boolean> {
  const images = kept
    .filter((im) => im.id != null)
    .map((im, i) => ({ id: Number(im.id), position: i + 1 }));
  if (images.length === 0) return false;

  const resp = await shopifyFetch(`${apiBase}/products/${shopifyId}.json`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ product: { id: Number(shopifyId), images } }),
  });
  if (!resp.ok) {
    console.warn(
      `[update-shopify-product] gallery reorder failed (${resp.status}):`,
      (await resp.text()).slice(0, 200),
    );
    return false;
  }
  return true;
}

/** Remove duplicate Shopify product images; keep mirror gallery order (deduped). */
async function syncProductGalleryCleanup(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  dedupedMirror: MirrorImageRef[],
  primarySrc: string | null,
): Promise<{ kept: Record<string, unknown>[]; deleted: number }> {
  const keepKeys = new Set(
    dedupedMirror.map((im) => imageDedupeKey(resolveAttachImageSrc(String(im.src), primarySrc))),
  );

  let product = (await shopifyFetch(`${apiBase}/products/${shopifyId}.json`, { headers })
    .then((r) => r.json())).product as Record<string, unknown>;
  let liveImages = [...((product.images as Record<string, unknown>[]) || [])];
  let canonicalByKey = indexLiveImagesByDedupe(liveImages, primarySrc);

  for (const im of dedupedMirror) {
    const src = resolveAttachImageSrc(String(im.src), primarySrc);
    const key = imageDedupeKey(src);
    if (canonicalByKey.has(key)) continue;
    const postResp = await shopifyFetch(`${apiBase}/products/${shopifyId}/images.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ image: { src } }),
    });
    if (!postResp.ok) continue;
    const newImg = (await postResp.json()).image as Record<string, unknown>;
    const newKey = typeof newImg.src === "string" ? imageDedupeKey(newImg.src) : key;
    const prev = canonicalByKey.get(newKey);
    canonicalByKey.set(
      newKey,
      prev ? pickPreferredImage(prev, newImg, primarySrc) : newImg,
    );
  }

  product = (await shopifyFetch(`${apiBase}/products/${shopifyId}.json`, { headers })
    .then((r) => r.json())).product as Record<string, unknown>;
  liveImages = [...((product.images as Record<string, unknown>[]) || [])];
  canonicalByKey = indexLiveImagesByDedupe(liveImages, primarySrc);

  let deleted = 0;
  for (const im of liveImages) {
    const id = im.id;
    const src = im.src;
    if (id == null || typeof src !== "string") continue;
    const key = imageDedupeKey(src);
    const canonical = pickCanonicalForKey(liveImages, key, primarySrc, canonicalByKey);
    if (!keepKeys.has(key) || (canonical?.id != null && Number(id) !== Number(canonical.id))) {
      const delResp = await shopifyFetch(
        `${apiBase}/products/${shopifyId}/images/${id}.json`,
        { method: "DELETE", headers },
      );
      if (delResp.ok) deleted++;
    }
  }

  product = (await shopifyFetch(`${apiBase}/products/${shopifyId}.json`, { headers })
    .then((r) => r.json())).product as Record<string, unknown>;
  liveImages = [...((product.images as Record<string, unknown>[]) || [])];
  canonicalByKey = indexLiveImagesByDedupe(liveImages, primarySrc);

  const kept: Record<string, unknown>[] = [];
  for (const im of dedupedMirror) {
    const key = imageDedupeKey(resolveAttachImageSrc(String(im.src), primarySrc));
    const canonical = pickCanonicalForKey(liveImages, key, primarySrc, canonicalByKey);
    if (canonical) kept.push({ ...canonical, position: kept.length + 1 });
  }

  if (kept.length > 0) {
    await reorderShopifyProductImages(apiBase, headers, shopifyId, kept);
  }

  return { kept, deleted };
}

async function refreshMirrorAfterShopifyPush(
  supabase: ReturnType<typeof createClient>,
  shopifyId: string,
  payload: PushPayload,
  liveProduct: Record<string, unknown>,
  keptImages: Record<string, unknown>[],
  primarySrc: string | null,
): Promise<void> {
  const resolvedPrimary = keptImages.length > 0 && typeof keptImages[0].src === "string"
    ? String(keptImages[0].src)
    : primarySrc;
  const mediaUrlsForMetafields = keptImages
    .map((im) => im.src)
    .filter((src): src is string => typeof src === "string" && /^https?:\/\//.test(src))
    .slice(0, 4);
  const spUpdate: Record<string, unknown> = {
    shopify_updated_at: String(liveProduct.updated_at || new Date().toISOString()),
    variants: liveProduct.variants ?? null,
    images: keptImages.length > 0 ? mapLiveImagesForMirror(keptImages) : null,
    image_url: resolvedPrimary,
    ...moreImageLinkColumnsFromUrls(
      mediaUrlsForMetafields,
      typeof payload.title === "string" ? payload.title : null,
    ),
  };
  if (typeof payload.title === "string" && payload.title.trim()) spUpdate.title = payload.title;
  if (typeof payload.body_html === "string") spUpdate.body_html = payload.body_html;
  if (typeof payload.vendor === "string") spUpdate.vendor = payload.vendor;
  if (typeof payload.product_type === "string") spUpdate.product_type = payload.product_type;
  if (payload.tags !== undefined) {
    spUpdate.tags = Array.isArray(payload.tags)
      ? payload.tags.filter(Boolean)
      : String(payload.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (payload.price != null && !isNaN(Number(payload.price))) spUpdate.price = Number(payload.price);
  if (payload.compare_at_price != null && !isNaN(Number(payload.compare_at_price))) {
    spUpdate.compare_at_price = Number(payload.compare_at_price);
  }
  if (typeof payload.sku === "string") spUpdate.sku = payload.sku;
  await supabase.from("shopify_products").update(spUpdate).eq("shopify_product_id", shopifyId);
}

function mirrorRowToPayload(row: Record<string, unknown>): PushPayload {
  const metafields: Record<string, string> = {};
  for (const col of Object.keys(METAFIELD_DEFS)) {
    const v = row[col];
    if (v != null && String(v).trim()) metafields[col] = String(v).trim();
  }
  const images: string[] = [];
  const productImages: { id?: string | number; src?: string }[] = [];
  if (Array.isArray(row.images)) {
    for (const im of row.images) {
      if (typeof im === "string") {
        if (/^https?:\/\//.test(im)) {
          images.push(im);
          productImages.push({ src: im });
        }
        continue;
      }
      const rec = im as { id?: string | number; src?: string };
      const src = rec?.src;
      if (src && /^https?:\/\//.test(src)) {
        images.push(src);
        productImages.push({ id: rec.id, src });
      }
    }
  } else if (row.image_url && /^https?:\/\//.test(String(row.image_url))) {
    images.push(String(row.image_url));
    productImages.push({ src: String(row.image_url) });
  }
  const handle = normalizeShopifyHandle(String(row.shopify_url || row.handle || "")) || undefined;
  const variants = Array.isArray(row.variants)
    ? (row.variants as Record<string, unknown>[]).map((v, index) => ({
      id: v.id as string | number | undefined,
      index,
      sku: typeof v.sku === "string" ? v.sku : null,
      option1: typeof v.option1 === "string" ? v.option1 : null,
      price: v.price != null ? v.price as number | string : null,
      image_id: v.image_id != null ? v.image_id as string | number : null,
    }))
    : undefined;
  const orderedForMetafields = dedupeMirrorImages(
    productImages.map((im, i) => ({ ...im, position: i + 1 })),
    row.image_url && /^https?:\/\//.test(String(row.image_url)) ? String(row.image_url) : null,
  )
    .map((im) => im.src)
    .filter((src): src is string => typeof src === "string" && /^https?:\/\//.test(src))
    .slice(0, 4);
  // Metafield image links must be Shopify CDN on storefront — prefer gallery CDN src over stale columns.
  const cdnFirst = orderedForMetafields.filter((src) => /cdn\.shopify\.com/i.test(src));
  const urlsForImageMetafields = cdnFirst.length > 0 ? cdnFirst : orderedForMetafields;
  applyMoreImageLinkMetafields(
    metafields,
    urlsForImageMetafields,
    typeof row.title === "string" ? row.title : null,
  );
  return {
    source_product_id: (row.source_product_id as string | null) ?? null,
    title: typeof row.title === "string" ? row.title : undefined,
    body_html: typeof row.body_html === "string" ? row.body_html : undefined,
    price: row.price != null ? Number(row.price) : undefined,
    compare_at_price: row.compare_at_price != null ? Number(row.compare_at_price) : undefined,
    vendor: typeof row.vendor === "string" ? row.vendor : undefined,
    product_type: typeof row.product_type === "string" ? row.product_type : undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : undefined,
    images: images.length > 0 ? images : undefined,
    product_images: productImages.length > 0 ? productImages : undefined,
    image_url: row.image_url && /^https?:\/\//.test(String(row.image_url))
      ? String(row.image_url)
      : undefined,
    variants,
    sku: typeof row.sku === "string" ? row.sku : undefined,
    metafields: Object.keys(metafields).length > 0 ? metafields : undefined,
    handle,
    seo_title: typeof row.shopify_page_title === "string" ? row.shopify_page_title : undefined,
    seo_description: typeof row.shopify_page_description === "string" ? row.shopify_page_description : undefined,
  };
}

/** Resolve mirror image_id → CDN src URL. */
function mirrorImageSrcById(
  imageId: string | number,
  productImages: { id?: string | number; src?: string }[],
): string | null {
  const found = productImages.find((im) => im.id != null && String(im.id) === String(imageId));
  return found?.src && /^https?:\/\//.test(found.src) ? found.src : null;
}

/**
 * Push per-variant thumbnails to Shopify by matching mirror image src to live product images.
 * Mirror image_id alone may be stale after a flat images PUT — always resolve via src URL.
 */
async function syncVariantImagesFromMirror(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  mirrorVariants: NonNullable<PushPayload["variants"]>,
  productImages: { id?: string | number; src?: string }[],
  liveProduct: Record<string, unknown>,
  primarySrc: string | null,
): Promise<number> {
  let images = [...((liveProduct.images as Record<string, unknown>[]) || [])];
  const legacy = liveProduct.image as Record<string, unknown> | undefined;
  if (legacy?.src && typeof legacy.src === "string" && /^https?:\/\//.test(legacy.src)) {
    const legacyKey = imageDedupeKey(legacy.src);
    if (!images.some(
      (im) => typeof im.src === "string" && imageDedupeKey(im.src) === legacyKey,
    )) {
      images.unshift(legacy);
    }
  }
  const liveVariants = (liveProduct.variants as Record<string, unknown>[]) || [];
  let synced = 0;

  for (const mv of mirrorVariants) {
    if (mv.id == null || mv.image_id == null) continue;

    const rawSrc = mirrorImageSrcById(mv.image_id, productImages);
    if (!rawSrc) {
      console.warn(
        `[update-shopify-product] no src for mirror image_id ${mv.image_id} (variant ${mv.id})`,
      );
      continue;
    }
    const src = resolveAttachImageSrc(rawSrc, primarySrc);

    const variantId = Number(mv.id);
    let target = indexLiveImagesByDedupe(images, primarySrc).get(imageDedupeKey(src));

    if (!target?.id) {
      const postResp = await shopifyFetch(`${apiBase}/products/${shopifyId}/images.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ image: { src } }),
      });
      if (!postResp.ok) {
        console.warn(
          `[update-shopify-product] image POST failed for variant ${mv.id}:`,
          (await postResp.text()).slice(0, 120),
        );
        continue;
      }
      target = (await postResp.json()).image as Record<string, unknown>;
      images.push(target);
    }

    const imageId = Number(target.id);
    const live = liveVariants.find((v) => String(v.id) === String(mv.id));
    const currentImageId = live?.image_id != null ? Number(live.image_id) : null;
    if (currentImageId === imageId) {
      synced++;
      continue;
    }

    const resp = await shopifyFetch(`${apiBase}/products/${shopifyId}/variants/${variantId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ variant: { id: variantId, image_id: imageId } }),
    });
    if (resp.ok) synced++;
    else {
      console.warn(
        `[update-shopify-product] variant image_id sync failed ${mv.id}:`,
        (await resp.text()).slice(0, 120),
      );
    }
  }
  return synced;
}

/** Push one product from payload → Shopify (+ optional mirror timestamp refresh). */
async function pushProductToShopify(
  supabase: ReturnType<typeof createClient>,
  shopDomain: string,
  shopifyToken: string,
  shopifyId: string,
  payload: PushPayload,
  opts?: { skipMirrorWrite?: boolean },
): Promise<{
  success: boolean;
  skipped?: boolean;
  error?: string;
  changes?: string[];
  metafields_updated?: number;
  metafields_failed?: number;
}> {
  const {
    source_product_id: sourceProductId,
    title, body_html: bodyHtml,
    price, compare_at_price: compareAtPrice,
    vendor, product_type: productType, tags,
    images, product_images: productImages, image_url: mirrorImageUrl, variants, sku, metafields,
    handle, seo_title: seoTitle, seo_description: seoDescription,
  } = payload;

  const apiBase = `https://${shopDomain}/admin/api/2024-10`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken };

  const getResp = await shopifyFetch(`${apiBase}/products/${shopifyId}.json`, { headers });
  if (!getResp.ok) {
    const t = await getResp.text();
    return { success: false, error: `Shopify GET failed (${getResp.status}): ${t.slice(0, 200)}` };
  }
  const existing = (await getResp.json()).product as Record<string, unknown>;
  const existingVariants = (existing.variants as Record<string, unknown>[]) || [];
  const liveImages = [...((existing.images as Record<string, unknown>[]) || [])];

  const imgsForSync: MirrorImageRef[] = (productImages?.length
    ? productImages.map((im, i) => ({ ...im, position: i + 1 }))
    : (images || []).map((src, i) => ({ src, position: i + 1 })));
  const primarySrc = typeof mirrorImageUrl === "string" && /^https?:\/\//.test(mirrorImageUrl)
    ? mirrorImageUrl
    : (imgsForSync[0]?.src && /^https?:\/\//.test(String(imgsForSync[0].src))
      ? String(imgsForSync[0].src)
      : null);
  const dedupedMirror = dedupeMirrorImages(imgsForSync, primarySrc);
  const galleryMatches = liveGalleryMatchesMirror(liveImages, dedupedMirror, primarySrc);
  const mirrorHasVariantImages = Array.isArray(variants) && variants.some((v) => v.image_id != null);
  const variantImagesMatch = !mirrorHasVariantImages || variantImageIdsMatchMirror(
    existingVariants,
    variants!,
    dedupedMirror.map((im) => ({ id: im.id, src: im.src })),
    liveImages,
    primarySrc,
  );
  const coreMatches = productCoreFieldsMatch(existing, existingVariants, {
    title, bodyHtml, vendor, productType: productType, tags, variants, price, compareAtPrice, sku,
  });
  const existingHandle = typeof existing.handle === "string" ? existing.handle.trim() : "";

  const mirrorCdnUrls = dedupedMirror
    .map((im) => im.src)
    .filter((src): src is string => typeof src === "string" && /^https?:\/\//.test(src))
    .slice(0, 4);
  const liveCdnUrls = [...liveImages]
    .filter((im) => typeof im.src === "string" && /^https?:\/\//.test(im.src))
    .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99))
    .map((im) => String(im.src))
    .slice(0, 4);
  // Prefer live Shopify CDN URLs for more_image metafields (storefront reads these).
  const mediaUrlsForMetafields = liveCdnUrls.length > 0 ? liveCdnUrls : mirrorCdnUrls;
  const mergedMetafields = { ...(metafields || {}) };
  applyMoreImageLinkMetafields(
    mergedMetafields,
    mediaUrlsForMetafields,
    typeof title === "string" ? title : null,
  );

  let liveMetafieldMap: Map<string, string> | undefined;
  let liveSeo: LiveSeoState | null | undefined;

  const diff: MirrorLiveDiff = {
    core: !coreMatches,
    gallery: !galleryMatches,
    variantImages: !variantImagesMatch,
    metafields: false,
    seo: false,
  };

  const obviousChange = diff.core || diff.gallery || diff.variantImages;
  const normalizedMirrorHandle = normalizeShopifyHandle(handle);
  const mirrorHasSeoPayload = (typeof seoTitle === "string" && seoTitle.trim() !== "")
    || (typeof seoDescription === "string" && seoDescription.trim() !== "")
    || !!(normalizedMirrorHandle && normalizedMirrorHandle !== existingHandle);
  const coreLabels = coreChangeLabels(existing, existingVariants, {
    title, bodyHtml, vendor, productType: productType, tags, variants, price, compareAtPrice, sku,
  });

  if (!obviousChange) {
    // Parallel fetch — common skip path for bulk sync (metafields + SEO check together).
    [liveMetafieldMap, liveSeo] = await Promise.all([
      fetchLiveMetafieldMap(apiBase, headers, shopifyId),
      mirrorHasSeoPayload
        ? fetchLiveProductSeo(shopDomain, shopifyToken, shopifyId)
        : Promise.resolve(null),
    ]);
    diff.metafields = !metafieldsMatchMirror(liveMetafieldMap, mergedMetafields);
    if (!diff.metafields && mirrorHasSeoPayload) {
      diff.seo = !seoMatchesMirror(liveSeo, existingHandle, handle, seoTitle, seoDescription);
    }
    if (!hasSyncWork(diff)) {
      return { success: true, skipped: true, changes: [], metafields_updated: 0, metafields_failed: 0 };
    }
  }

  if (obviousChange || diff.metafields) {
    if (!liveMetafieldMap) {
      liveMetafieldMap = await fetchLiveMetafieldMap(apiBase, headers, shopifyId);
    }
    if (obviousChange) {
      diff.metafields = !metafieldsMatchMirror(liveMetafieldMap, mergedMetafields);
    }
  }

  if (mirrorHasSeoPayload || (!obviousChange && diff.metafields)) {
    if (liveSeo === undefined) {
      liveSeo = await fetchLiveProductSeo(shopDomain, shopifyToken, shopifyId);
      diff.seo = !seoMatchesMirror(liveSeo, existingHandle, handle, seoTitle, seoDescription);
    }
  }

  if (!hasSyncWork(diff)) {
    return { success: true, skipped: true, changes: [], metafields_updated: 0, metafields_failed: 0 };
  }

  const changeLabels = diffToChangeLabels(diff, coreLabels);

  const productUpdate: Record<string, unknown> = { id: Number(shopifyId) };
  if (diff.core) {
    if (typeof title === "string" && title.trim() && String(existing.title ?? "").trim() !== title.trim()) {
      productUpdate.title = title;
    }
    if (typeof bodyHtml === "string" && String(existing.body_html ?? "") !== bodyHtml) {
      productUpdate.body_html = bodyHtml;
    }
    if (typeof vendor === "string" && String(existing.vendor ?? "") !== vendor) {
      productUpdate.vendor = vendor;
    }
    if (typeof productType === "string" && String(existing.product_type ?? "") !== productType) {
      productUpdate.product_type = productType;
    }
    if (tags !== undefined) {
      const nextTags = Array.isArray(tags)
        ? tags.filter(Boolean).join(", ")
        : String(tags || "");
      if (normalizeTagsForCompare(existing.tags) !== nextTags) {
        productUpdate.tags = nextTags;
      }
    }
  }

  const requestedVariantSkus = new Map<string, string | null>();
  const requestedVariantOptions = new Map<string, string | null>();
  const requestedVariantPrices = new Map<string, string | null>();
  if (Array.isArray(variants)) {
    for (const [index, variant] of variants.entries()) {
      const key = variant.id != null ? String(variant.id) : `index-${variant.index ?? index}`;
      requestedVariantSkus.set(key, variant.sku == null ? null : String(variant.sku).trim());
      if (variant.option1 != null) {
        requestedVariantOptions.set(key, String(variant.option1).trim());
      }
      if (variant.price != null && !isNaN(Number(variant.price))) {
        requestedVariantPrices.set(key, Number(variant.price).toFixed(2));
      }
    }
  }
  const fallbackSku = sku == null ? undefined : String(sku).trim();
  const shouldUpdateVariants =
    diff.core && (
      (price != null && !isNaN(Number(price))) ||
      requestedVariantSkus.size > 0 ||
      requestedVariantOptions.size > 0 ||
      requestedVariantPrices.size > 0 ||
      fallbackSku !== undefined ||
      (compareAtPrice != null && !isNaN(Number(compareAtPrice)))
    );

  if (shouldUpdateVariants) {
    productUpdate.variants = existingVariants.map((v, index) => {
      const nv: Record<string, unknown> = { id: v.id };
      const idKey = v.id != null ? String(v.id) : "";
      const indexKey = `index-${index}`;
      const variantPrice = requestedVariantPrices.get(idKey) ?? requestedVariantPrices.get(indexKey);
      if (variantPrice != null && String(v.price ?? "") !== variantPrice) {
        nv.price = variantPrice;
      } else if (price != null && !isNaN(Number(price)) && variantPrice == null
        && String(v.price ?? "") !== Number(price).toFixed(2)) {
        nv.price = Number(price).toFixed(2);
      }
      if (
        price != null &&
        compareAtPrice != null &&
        !isNaN(Number(compareAtPrice)) &&
        Number(compareAtPrice) > Number(price)
      ) {
        const liveCompare = v.compare_at_price != null ? Number(v.compare_at_price) : null;
        if (liveCompare !== Number(compareAtPrice)) {
          nv.compare_at_price = Number(compareAtPrice).toFixed(2);
        }
      }
      if (requestedVariantSkus.has(idKey)) {
        const nextSku = requestedVariantSkus.get(idKey) || "";
        if (String(v.sku ?? "").trim() !== nextSku) nv.sku = nextSku;
      } else if (requestedVariantSkus.has(indexKey)) {
        const nextSku = requestedVariantSkus.get(indexKey) || "";
        if (String(v.sku ?? "").trim() !== nextSku) nv.sku = nextSku;
      } else if (fallbackSku !== undefined && existingVariants.length === 1
        && String(v.sku ?? "").trim() !== fallbackSku) {
        nv.sku = fallbackSku;
      }
      if (requestedVariantOptions.has(idKey)) {
        const nextOpt = requestedVariantOptions.get(idKey) || "";
        if (String(v.option1 ?? "").trim() !== nextOpt) nv.option1 = nextOpt;
      } else if (requestedVariantOptions.has(indexKey)) {
        const nextOpt = requestedVariantOptions.get(indexKey) || "";
        if (String(v.option1 ?? "").trim() !== nextOpt) nv.option1 = nextOpt;
      }
      return Object.keys(nv).length > 1 ? nv : null;
    }).filter((nv): nv is Record<string, unknown> => nv != null);
    if (Array.isArray(productUpdate.variants) && productUpdate.variants.length === 0) {
      delete productUpdate.variants;
    }
  }

  if (diff.gallery && Array.isArray(images)) {
    const valid = images.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
    const liveHasVariantImages = existingVariants.length > 1
      && existingVariants.some((v) => v.image_id != null);
    // Never replace the whole images[] when variants have per-size thumbnails — that
    // invalidates mirror image_ids and breaks variant.image_id PUT on Shopify.
    // Also skip when live gallery already matches mirror (avoids Shopify re-downloading images).
    if (!galleryMatches && !mirrorHasVariantImages && !liveHasVariantImages) {
      productUpdate.images = valid.map((src, i) => ({ src, position: i + 1 }));
    }
  }

  const hasProductFieldChanges = Object.keys(productUpdate).length > 1;
  let updated = existing;
  if (hasProductFieldChanges) {
    const putResp = await shopifyFetch(`${apiBase}/products/${shopifyId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ product: productUpdate }),
    });
    if (!putResp.ok) {
      const t = await putResp.text();
      return { success: false, error: `Shopify PUT failed (${putResp.status}): ${t.slice(0, 200)}` };
    }
    updated = (await putResp.json()).product as Record<string, unknown>;
  }

  let variantImagesSynced = 0;
  let galleryImagesDeleted = 0;
  let keptGalleryImages: Record<string, unknown>[] = [];

  const needsGallerySync = diff.gallery && dedupedMirror.length > 0;
  const needsVariantImageSync = diff.variantImages && mirrorHasVariantImages;

  if (Array.isArray(variants) && dedupedMirror.length > 0 && (needsGallerySync || needsVariantImageSync)) {
    if (needsGallerySync) {
      const galleryResult = await syncProductGalleryCleanup(
        apiBase, headers, shopifyId, dedupedMirror, primarySrc,
      );
      keptGalleryImages = galleryResult.kept;
      galleryImagesDeleted = galleryResult.deleted;
      let refreshResp = await shopifyFetch(`${apiBase}/products/${shopifyId}.json`, { headers });
      if (refreshResp.ok) {
        updated = (await refreshResp.json()).product as Record<string, unknown>;
      }
    }
    if (needsVariantImageSync) {
      variantImagesSynced = await syncVariantImagesFromMirror(
        apiBase, headers, shopifyId, variants, dedupedMirror, updated, primarySrc,
      );
    }
    if (keptGalleryImages.length > 0) {
      await reorderShopifyProductImages(apiBase, headers, shopifyId, keptGalleryImages);
    }
    const refreshResp = await shopifyFetch(`${apiBase}/products/${shopifyId}.json`, { headers });
    if (refreshResp.ok) {
      updated = (await refreshResp.json()).product as Record<string, unknown>;
    }
  } else if (needsGallerySync) {
    const galleryResult = await syncProductGalleryCleanup(
      apiBase, headers, shopifyId, dedupedMirror, primarySrc,
    );
    keptGalleryImages = galleryResult.kept;
    galleryImagesDeleted = galleryResult.deleted;
  }

  const normalizedHandle = normalizeShopifyHandle(handle) || undefined;
  let handleForSeo: string | undefined;
  let seoTitleForUpdate: string | undefined;
  let seoDescriptionForUpdate: string | undefined;

  if (diff.seo) {
    if (normalizedHandle && normalizedHandle !== existingHandle) {
      const usedByOther = await mirrorHandleUsedByOther(supabase, normalizedHandle, shopifyId);
      if (!usedByOther) handleForSeo = normalizedHandle;
      else {
        console.warn(
          `[update-shopify-product] Skip duplicate handle "${normalizedHandle}" for product ${shopifyId} — keeping Shopify handle "${existingHandle}"`,
        );
      }
    }
    const liveSeoTitle = liveSeo?.seoTitle ?? "";
    const liveSeoDesc = liveSeo?.seoDescription ?? "";
    if (typeof seoTitle === "string" && seoTitle.trim() !== liveSeoTitle) {
      seoTitleForUpdate = seoTitle;
    }
    if (typeof seoDescription === "string" && seoDescription.trim() !== liveSeoDesc) {
      seoDescriptionForUpdate = seoDescription;
    }
  }

  const seoResult = diff.seo
    ? await updateSeoAndHandle(shopDomain, shopifyToken, shopifyId, {
      handle: handleForSeo,
      seoTitle: seoTitleForUpdate,
      seoDescription: seoDescriptionForUpdate,
    })
    : { ok: true };
  if (!seoResult.ok) {
    return { success: false, error: seoResult.error || "SEO/handle update failed" };
  }

  if (opts?.skipMirrorWrite && dedupedMirror.length > 0) {
    await refreshMirrorAfterShopifyPush(
      supabase, shopifyId, payload, updated,
      keptGalleryImages.length > 0 ? keptGalleryImages : dedupedMirror as Record<string, unknown>[],
      primarySrc,
    );
  }

  const mfs = buildMetafields(mergedMetafields);
  const mfStats = diff.metafields && mfs.length > 0
    ? await syncProductMetafieldsToShopify(apiBase, headers, shopifyId, mergedMetafields, liveMetafieldMap)
    : { ok: 0, fail: 0, skipped: 0 };
  const mfOk = mfStats.ok;
  const mfFail = mfStats.fail;

  if (!opts?.skipMirrorWrite) {
    const mfColumns: Record<string, string | null> = {
      ...moreImageLinkColumnsFromUrls(
        mediaUrlsForMetafields,
        typeof title === "string" ? title : null,
      ),
    };
    for (const mf of mfs) mfColumns[`${mf.namespace}.${mf.key}`] = mf.value;
    const spUpdate: Record<string, unknown> = {
      shopify_updated_at: String(updated.updated_at || new Date().toISOString()),
      ...mfColumns,
    };
    const updatedVariants = Array.isArray(updated.variants) ? updated.variants as Record<string, unknown>[] : [];
    if (shouldUpdateVariants) {
      spUpdate.variants = updatedVariants;
      spUpdate.sku = firstSkuFromVariants(updatedVariants) ?? fallbackSku ?? null;
    }
    if (typeof title === "string" && title.trim()) spUpdate.title = title;
    if (typeof bodyHtml === "string") spUpdate.body_html = bodyHtml;
    if (typeof vendor === "string") spUpdate.vendor = vendor;
    if (typeof productType === "string") spUpdate.product_type = productType;
    if (tags !== undefined) {
      spUpdate.tags = Array.isArray(tags)
        ? tags.filter(Boolean)
        : String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    }
    if (price != null && !isNaN(Number(price))) spUpdate.price = Number(price);
    if (compareAtPrice != null && !isNaN(Number(compareAtPrice))) spUpdate.compare_at_price = Number(compareAtPrice);
    if (Array.isArray(images)) {
      const valid = images.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
      const mirrorHasVariantImages = Array.isArray(variants)
        && variants.some((v) => v.image_id != null);
      const hasVariantImages = updatedVariants.length > 1
        && (updatedVariants.some((v) => v.image_id != null) || mirrorHasVariantImages);
      if (!hasVariantImages) {
        spUpdate.image_url = valid[0] || null;
        spUpdate.images = valid.map((src, i) => ({ src, position: i + 1 }));
      }
      if (mfs.length > 0) spUpdate.metafields = mfs;
    } else if (mfs.length > 0) {
      spUpdate.metafields = mfs;
    }
    if (normalizedHandle) {
      const resolvedHandle = (handleForSeo ?? existingHandle) || normalizedHandle;
      spUpdate.handle = resolvedHandle;
      spUpdate.shopify_url = resolvedHandle;
    }
    if (typeof seoTitle === "string") spUpdate.shopify_page_title = seoTitle.trim() || null;
    if (typeof seoDescription === "string") spUpdate.shopify_page_description = seoDescription.trim() || null;
    await supabase.from("shopify_products").update(spUpdate).eq("shopify_product_id", shopifyId);
  }

  const liveHandle = (
    typeof updated.handle === "string" ? updated.handle.trim() : existingHandle
  ) || undefined;

  return {
    success: true,
    changes: changeLabels,
    live_handle: liveHandle,
    metafields_updated: mfOk,
    metafields_failed: mfFail,
    variant_images_synced: variantImagesSynced,
    gallery_images_deleted: galleryImagesDeleted,
    ...(sourceProductId ? {} : {}),
  };
}

type MirrorPushItemResult = {
  shopify_product_id: string;
  action: "skipped" | "pushed" | "failed";
  changes?: string[];
  error?: string;
};

const CORE_METAFIELD_COLS = [
  "my_fields.normal_size",
  "my_fields.materials",
  "my_fields.production_time",
] as const;

const IMAGE_METAFIELD_COLS = [
  ...MORE_IMAGE_LINK_COLS,
  ...MORE_IMAGE_ALT_COLS,
] as const;

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Rebuild core text metafields from ready_to_shopify + products source rows. */
function buildCoreMetafieldsFromSources(
  rts: Record<string, unknown> | null | undefined,
  product: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const mf: Record<string, string> = {};
  const L = rts?.dimension_l_mm ?? product?.dimension_l_mm;
  const W = rts?.dimension_w_mm ?? product?.dimension_w_mm;
  const H = rts?.dimension_h_mm ?? product?.dimension_h_mm;
  if (L != null && W != null && H != null) {
    mf["my_fields.normal_size"] = `${L}(W)x${W}(D)x${H}(H)(mm)`;
  }
  const materialsVal = (
    rts?.["my_fields.materials"] ?? rts?.material ?? product?.material ?? ""
  ) as string;
  if (materialsVal && String(materialsVal).trim()) {
    mf["my_fields.materials"] = String(materialsVal).trim();
  }
  const customizeVal = (rts?.customize ?? product?.customize ?? "") as string;
  if (customizeVal && String(customizeVal).trim()) {
    mf["my_fields.production_time"] = String(customizeVal).trim();
  }
  return mf;
}

/** Prefer live Shopify CDN image URLs; fall back to mirror images / image_url. */
function collectImageUrlsForMetafields(
  liveImages: { src?: string; position?: number }[] | undefined,
  mirrorRow: Record<string, unknown>,
): string[] {
  const live = [...(liveImages || [])]
    .filter((im) => typeof im.src === "string" && /^https?:\/\//.test(im.src))
    .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99))
    .map((im) => String(im.src));
  if (live.length > 0) return live.slice(0, 4);

  const fromMirror: string[] = [];
  if (Array.isArray(mirrorRow.images)) {
    for (const im of mirrorRow.images) {
      if (typeof im === "string" && /^https?:\/\//.test(im)) {
        fromMirror.push(im);
        continue;
      }
      const src = (im as { src?: string })?.src;
      if (src && /^https?:\/\//.test(src)) fromMirror.push(src);
    }
  }
  if (fromMirror.length === 0 && mirrorRow.image_url && /^https?:\/\//.test(String(mirrorRow.image_url))) {
    fromMirror.push(String(mirrorRow.image_url));
  }
  return fromMirror.slice(0, 4);
}

async function fetchShopifyProductImages(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
): Promise<{ src?: string; position?: number }[]> {
  const resp = await shopifyFetch(`${apiBase}/products/${shopifyId}.json?fields=id,title,images`, { headers });
  if (!resp.ok) return [];
  const j = await resp.json();
  return Array.isArray(j?.product?.images) ? j.product.images : [];
}

/** One GraphQL read: product images + metafield map. */
async function fetchShopifyProductRepairState(
  shopDomain: string,
  shopifyToken: string,
  shopifyId: string,
): Promise<{
  images: { src?: string; position?: number }[];
  liveMap: Map<string, string>;
  metafieldGids: Map<string, string>;
}> {
  const query = `
    query ProductRepairState($id: ID!) {
      product(id: $id) {
        images(first: 10) { edges { node { url } } }
        metafields(first: 50) {
          edges { node { id namespace key value } }
        }
      }
    }
  `;
  const resp = await shopifyFetch(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shopifyToken,
    },
    body: JSON.stringify({
      query,
      variables: { id: `gid://shopify/Product/${shopifyId}` },
    }),
  });
  if (!resp.ok) {
    return { images: [], liveMap: new Map(), metafieldGids: new Map() };
  }
  const j = await resp.json();
  const product = j?.data?.product;
  const images = (product?.images?.edges || [])
    .map((e: { node?: { url?: string } }, idx: number) => ({
      src: e?.node?.url,
      position: idx + 1,
    }))
    .filter((im: { src?: string }) => typeof im.src === "string" && /^https?:\/\//.test(im.src));
  const liveMap = new Map<string, string>();
  const metafieldGids = new Map<string, string>();
  for (const edge of product?.metafields?.edges || []) {
    const node = edge?.node;
    if (!node?.namespace || !node?.key) continue;
    const col = `${node.namespace}.${node.key}`;
    liveMap.set(col, String(node.value ?? "").trim());
    if (node.id) metafieldGids.set(col, String(node.id));
  }
  return { images, liveMap, metafieldGids };
}

/** Batch-write metafields via GraphQL metafieldsSet (much fewer API calls). */
async function batchSetProductMetafields(
  shopDomain: string,
  shopifyToken: string,
  shopifyId: string,
  metafields: Record<string, string>,
): Promise<{ ok: number; fail: number }> {
  const inputs = Object.entries(metafields)
    .map(([col, value]) => {
      const trimmed = String(value ?? "").trim();
      if (!trimmed) return null;
      const dot = col.indexOf(".");
      if (dot < 0) return null;
      return {
        ownerId: `gid://shopify/Product/${shopifyId}`,
        namespace: col.slice(0, dot),
        key: col.slice(dot + 1),
        type: METAFIELD_DEFS[col] || "single_line_text_field",
        value: trimmed,
      };
    })
    .filter(Boolean) as {
      ownerId: string;
      namespace: string;
      key: string;
      type: string;
      value: string;
    }[];

  if (inputs.length === 0) return { ok: 0, fail: 0 };

  let ok = 0;
  let fail = 0;
  // metafieldsSet accepts up to 25 inputs per call
  for (let i = 0; i < inputs.length; i += 25) {
    const chunk = inputs.slice(i, i + 25);
    const resp = await shopifyFetch(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken,
      },
      body: JSON.stringify({
        query: `
          mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id }
              userErrors { field message }
            }
          }
        `,
        variables: { metafields: chunk },
      }),
    });
    if (!resp.ok) {
      fail += chunk.length;
      continue;
    }
    const j = await resp.json();
    const errors = j?.data?.metafieldsSet?.userErrors || [];
    const written = (j?.data?.metafieldsSet?.metafields || []).length;
    if (errors.length > 0 && written === 0) fail += chunk.length;
    else ok += written || chunk.length;
  }
  return { ok, fail };
}

async function batchDeleteMetafieldsByGid(
  shopDomain: string,
  shopifyToken: string,
  gids: string[],
): Promise<void> {
  for (const gid of gids) {
    await shopifyFetch(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken,
      },
      body: JSON.stringify({
        query: `
          mutation MetafieldDelete($input: MetafieldDeleteInput!) {
            metafieldDelete(input: $input) { deletedId userErrors { message } }
          }
        `,
        variables: { input: { id: gid } },
      }),
    });
  }
}

/**
 * Backfill metafields: rebuild core fields from products/RTS, rebuild more_image_*
 * from live Shopify CDN images, update mirror, push to Shopify.
 */
async function repairMetafieldsForProducts(
  supabase: ReturnType<typeof createClient>,
  shopDomain: string,
  shopifyToken: string,
  shopifyProductIds?: string[],
): Promise<{
  repaired: number;
  failed: number;
  skipped: number;
  errors: { shopify_product_id: string; error: string }[];
  results: { shopify_product_id: string; action: "repaired" | "skipped" | "failed"; metafields?: string[]; error?: string }[];
}> {
  const apiBase = `https://${shopDomain}/admin/api/2024-01`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": shopifyToken,
  };

  let query = supabase.from("shopify_products").select("*").is("configurable", null);
  if (shopifyProductIds?.length) {
    const ids = shopifyProductIds.map(String).filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) {
      return { repaired: 0, failed: 0, skipped: 0, errors: [], results: [] };
    }
    query = query.in("shopify_product_id", ids);
  }

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) throw new Error(fetchErr.message);
  const mirrorRows = (rows || []) as Record<string, unknown>[];

  const sourceIds = [
    ...new Set(
      mirrorRows
        .map((r) => String(r.source_product_id || "").trim())
        .filter((id) => isUuid(id)),
    ),
  ];

  const skuLookup = [
    ...new Set(
      mirrorRows
        .map((r) => String(r.sku || "").trim())
        .filter((sku) => sku.length > 0),
    ),
  ];

  const productMap = new Map<string, Record<string, unknown>>();
  const productBySku = new Map<string, Record<string, unknown>>();
  const rtsMap = new Map<string, Record<string, unknown>>();

  // PostgREST `.in()` has URL length limits — chunk source lookups.
  for (let i = 0; i < sourceIds.length; i += 100) {
    const chunk = sourceIds.slice(i, i + 100);
    const { data: products } = await supabase
      .from("products")
      .select("id,dimension_l_mm,dimension_w_mm,dimension_h_mm,material,customize")
      .in("id", chunk);
    for (const p of (products || []) as Record<string, unknown>[]) {
      productMap.set(String(p.id), p);
    }

    const { data: rtsRows } = await supabase
      .from("ready_to_shopify")
      .select('product_id,dimension_l_mm,dimension_w_mm,dimension_h_mm,material,"my_fields.materials",customize')
      .in("product_id", chunk);
    for (const r of (rtsRows || []) as Record<string, unknown>[]) {
      rtsMap.set(String(r.product_id), r);
    }
  }

  for (let i = 0; i < skuLookup.length; i += 100) {
    const chunk = skuLookup.slice(i, i + 100);
    const { data: products } = await supabase
      .from("products")
      .select("sku,dimension_l_mm,dimension_w_mm,dimension_h_mm,material,customize")
      .in("sku", chunk);
    for (const p of (products || []) as Record<string, unknown>[]) {
      const sku = String(p.sku || "").trim();
      if (sku) productBySku.set(sku, p);
    }
  }

  let repaired = 0;
  let failed = 0;
  let skipped = 0;
  const errors: { shopify_product_id: string; error: string }[] = [];
  const results: {
    shopify_product_id: string;
    action: "repaired" | "skipped" | "failed";
    metafields?: string[];
    error?: string;
  }[] = [];

  const REPAIR_CONCURRENCY = 1;
  const itemResults = await mapWithConcurrency(mirrorRows, REPAIR_CONCURRENCY, async (row) => {
    const sid = String(row.shopify_product_id || "");
    if (!/^\d+$/.test(sid)) {
      return { shopify_product_id: sid, action: "skipped" as const };
    }

    const sourceId = String(row.source_product_id || "").trim();
    const sku = String(row.sku || "").trim();
    const rts = sourceId && isUuid(sourceId) ? rtsMap.get(sourceId) : null;
    let product = sourceId && isUuid(sourceId) ? productMap.get(sourceId) : null;
    if (!product && sku) product = productBySku.get(sku) ?? null;
    const built = buildCoreMetafieldsFromSources(rts, product);

    const merged: Record<string, string> = {};
    for (const col of CORE_METAFIELD_COLS) {
      const builtVal = built[col]?.trim() || "";
      const mirrorVal = row[col] != null ? String(row[col]).trim() : "";
      if (builtVal || mirrorVal) merged[col] = builtVal || mirrorVal;
    }

    // Rebuild more_image_* from live Shopify CDN images (storefront depends on these).
    let liveImages: { src?: string; position?: number }[] = [];
    let liveMap = new Map<string, string>();
    let metafieldGids = new Map<string, string>();
    try {
      const state = await fetchShopifyProductRepairState(shopDomain, shopifyToken, sid);
      liveImages = state.images;
      liveMap = state.liveMap;
      metafieldGids = state.metafieldGids;
    } catch {
      try {
        liveImages = await fetchShopifyProductImages(apiBase, headers, sid);
      } catch {
        liveImages = [];
      }
    }

    // Fill gaps from live Shopify (imported products / mirror drift).
    for (const col of [...CORE_METAFIELD_COLS, ...IMAGE_METAFIELD_COLS]) {
      if (!String(merged[col] ?? "").trim()) {
        const liveVal = liveMap.get(col)?.trim();
        if (liveVal) merged[col] = liveVal;
      }
    }

    const imageUrls = collectImageUrlsForMetafields(liveImages, row);
    const title = String(row.title || "").trim();
    if (imageUrls.length > 0) {
      const imageCols = moreImageLinkColumnsFromUrls(imageUrls, title || null);
      for (const col of IMAGE_METAFIELD_COLS) {
        const val = imageCols[col];
        if (val != null && String(val).trim()) merged[col] = String(val).trim();
        else merged[col] = ""; // clear slots beyond actual image count (e.g. 3 images → slot 4 empty)
      }
    }

    const hasAny = Object.keys(merged).some((col) => String(merged[col] ?? "").trim());
    if (!hasAny) {
      return { shopify_product_id: sid, action: "skipped" as const };
    }

    const spUpdate: Record<string, string | null> = {};
    for (const col of Object.keys(merged)) {
      const trimmed = String(merged[col] ?? "").trim();
      spUpdate[col] = trimmed || null;
    }
    await supabase.from("shopify_products").update(spUpdate).eq("shopify_product_id", sid);

    try {
      const toSet: Record<string, string> = {};
      const toDeleteGids: string[] = [];
      for (const [col, raw] of Object.entries(merged)) {
        const want = String(raw ?? "").trim();
        const live = (liveMap.get(col) ?? "").trim();
        if (want === live) continue;
        if (!want) {
          const gid = metafieldGids.get(col);
          if (gid) toDeleteGids.push(gid);
          continue;
        }
        toSet[col] = want;
      }

      if (Object.keys(toSet).length === 0 && toDeleteGids.length === 0) {
        return {
          shopify_product_id: sid,
          action: "repaired" as const,
          metafields: Object.keys(merged).filter((col) => String(merged[col] ?? "").trim()),
        };
      }

      const setResult = await batchSetProductMetafields(shopDomain, shopifyToken, sid, toSet);
      if (toDeleteGids.length > 0) {
        await batchDeleteMetafieldsByGid(shopDomain, shopifyToken, toDeleteGids);
      }
      if (setResult.fail > 0 && setResult.ok === 0 && Object.keys(toSet).length > 0) {
        return {
          shopify_product_id: sid,
          action: "failed" as const,
          error: `${setResult.fail} metafield(s) failed to sync`,
        };
      }
      return {
        shopify_product_id: sid,
        action: "repaired" as const,
        metafields: Object.keys(merged).filter((col) => String(merged[col] ?? "").trim()),
      };
    } catch (err) {
      return {
        shopify_product_id: sid,
        action: "failed" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  for (const item of itemResults) {
    results.push(item);
    if (item.action === "skipped") skipped++;
    else if (item.action === "repaired") repaired++;
    else {
      failed++;
      if (errors.length < 20 && item.error) {
        errors.push({ shopify_product_id: item.shopify_product_id, error: item.error });
      }
    }
  }

  return { repaired, failed, skipped, errors, results };
}

const TRADITIONAL_TEXT_MIRROR_COLS = [
  "shopify_page_description",
  "shopify_page_title",
  "body_html",
  "my_fields.materials",
] as const;

function convertMirrorTextField(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  if (!text.trim() || !containsSimplifiedChinese(text)) return null;
  const converted = simplifiedToTraditional(text);
  return converted !== text ? converted : null;
}

function buildTraditionalChinesePatch(row: Record<string, unknown>): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const col of TRADITIONAL_TEXT_MIRROR_COLS) {
    const converted = convertMirrorTextField(row[col]);
    if (converted != null) patch[col] = converted;
  }
  return patch;
}

/** Scan mirror text fields for simplified Chinese, update DB, optionally push to Shopify. */
async function convertSimplifiedChineseInMirror(
  supabase: ReturnType<typeof createClient>,
  shopDomain: string,
  shopifyToken: string,
  shopifyProductIds?: string[],
  options?: { push_to_shopify?: boolean },
) {
  let query = supabase.from("shopify_products").select("*").is("configurable", null);
  if (shopifyProductIds?.length) {
    const ids = shopifyProductIds.map(String).filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) {
      return {
        converted: 0,
        skipped: 0,
        failed: 0,
        pushed: 0,
        push_failed: 0,
        errors: [] as { shopify_product_id: string; error: string }[],
        results: [] as {
          shopify_product_id: string;
          action: "converted" | "skipped" | "failed";
          fields?: string[];
          error?: string;
        }[],
      };
    }
    query = query.in("shopify_product_id", ids);
  }

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) throw new Error(fetchErr.message);
  const mirrorRows = (rows || []) as Record<string, unknown>[];

  let converted = 0;
  let skipped = 0;
  let failed = 0;
  const errors: { shopify_product_id: string; error: string }[] = [];
  const results: {
    shopify_product_id: string;
    action: "converted" | "skipped" | "failed";
    fields?: string[];
    error?: string;
  }[] = [];
  const changedRows: Record<string, unknown>[] = [];

  for (const row of mirrorRows) {
    const sid = String(row.shopify_product_id || "");
    const patch = buildTraditionalChinesePatch(row);
    if (Object.keys(patch).length === 0) {
      skipped++;
      results.push({ shopify_product_id: sid, action: "skipped" });
      continue;
    }

    const { error: updErr } = await supabase
      .from("shopify_products")
      .update(patch)
      .eq("shopify_product_id", sid);
    if (updErr) {
      failed++;
      if (errors.length < 20) errors.push({ shopify_product_id: sid, error: updErr.message });
      results.push({ shopify_product_id: sid, action: "failed", error: updErr.message });
      continue;
    }

    converted++;
    changedRows.push({ ...row, ...patch });
    results.push({
      shopify_product_id: sid,
      action: "converted",
      fields: Object.keys(patch),
    });
  }

  let pushed = 0;
  let push_failed = 0;
  if (options?.push_to_shopify !== false && changedRows.length > 0) {
    const pushStats = await pushMirrorRows(supabase, shopDomain, shopifyToken, changedRows);
    pushed = pushStats.pushed;
    push_failed = pushStats.failed;
    for (const e of pushStats.errors) {
      if (errors.length < 20) errors.push(e);
    }
  }

  return { converted, skipped, failed, pushed, push_failed, errors, results };
}

const MIRROR_PUSH_CONCURRENCY = 5;

/** Push mirror rows to Shopify (existing products only — never creates). */
async function pushMirrorRows(
  supabase: ReturnType<typeof createClient>,
  shopDomain: string,
  shopifyToken: string,
  rows: Record<string, unknown>[],
) {
  let pushed = 0;
  let failed = 0;
  let skipped = 0;
  const errors: { shopify_product_id: string; error: string }[] = [];
  const results: MirrorPushItemResult[] = [];

  const itemResults = await mapWithConcurrency(rows, MIRROR_PUSH_CONCURRENCY, async (row) => {
    const sid = String(row.shopify_product_id || "");
    if (!/^\d+$/.test(sid)) {
      return { shopify_product_id: sid, action: "skipped" as const, changes: [] as string[] };
    }
    const payload = mirrorRowToPayload(row);
    const result = await pushProductToShopify(
      supabase, shopDomain, shopifyToken, sid, payload, { skipMirrorWrite: true },
    );
    if (result.skipped) {
      return { shopify_product_id: sid, action: "skipped" as const, changes: [] as string[] };
    }
    if (result.success) {
      return {
        shopify_product_id: sid,
        action: "pushed" as const,
        changes: result.changes ?? [],
      };
    }
    return {
      shopify_product_id: sid,
      action: "failed" as const,
      error: result.error || "unknown",
    };
  });

  for (const item of itemResults) {
    results.push(item);
    if (item.action === "skipped") skipped++;
    else if (item.action === "pushed") pushed++;
    else {
      failed++;
      if (errors.length < 20 && item.error) {
        errors.push({ shopify_product_id: item.shopify_product_id, error: item.error });
      }
    }
  }

  return { pushed, failed, skipped, errors, results };
}

/**
 * update-shopify-product
 *
 * Single product push: POST { shopify_product_id, title?, body_html?, ... }
 * Push one mirror row: POST { push_from_mirror: true, shopify_product_id }
 * Push selected mirror rows: POST { shopify_product_ids: string[] }
 * Batch push all mirror rows: POST { push_all_from_mirror: true }
 * Repair core metafields from source data: POST { repair_metafields: true, shopify_product_ids?: string[] }
 * Convert simplified Chinese → HK traditional in mirror text fields:
 *   POST { convert_simplified_to_traditional: true, shopify_product_ids?: string[], push_to_shopify?: boolean }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseKey) return json({ error: "Missing env vars" }, 400);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: conn } = await supabase
      .from("shopify_connections")
      .select("shop_domain, access_token")
      .eq("is_active", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const shopifyToken = conn?.access_token || Deno.env.get("SHOPIFY_ACCESS_TOKEN") || "";
    const shopDomain = (conn?.shop_domain || Deno.env.get("SHOPIFY_STORE_URL") || "")
      .replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!shopifyToken || !shopDomain) return json({ error: "Shopify credentials not configured." }, 400);

    const body = await req.json().catch(() => ({})) as {
      push_all_from_mirror?: boolean;
      push_from_mirror?: boolean;
      repair_metafields?: boolean;
      convert_simplified_to_traditional?: boolean;
      push_to_shopify?: boolean;
      shopify_product_ids?: string[];
      shopify_product_id?: string;
      source_product_id?: string;
      title?: string;
      body_html?: string;
      price?: number | null;
      compare_at_price?: number | null;
      vendor?: string;
      product_type?: string;
      tags?: string[] | string;
      images?: string[];
      variants?: { id?: string | number; index?: number; sku?: string | null; option1?: string | null; price?: number | string | null }[];
      sku?: string | null;
      metafields?: Record<string, string>;
      handle?: string;
      seo_title?: string;
      seo_description?: string;
    };

    if (body.convert_simplified_to_traditional) {
      const ids = Array.isArray(body.shopify_product_ids)
        ? body.shopify_product_ids.map(String).filter((id) => /^\d+$/.test(id))
        : undefined;
      const stats = await convertSimplifiedChineseInMirror(
        supabase,
        shopDomain,
        shopifyToken,
        ids,
        { push_to_shopify: body.push_to_shopify !== false },
      );
      return json({
        success: stats.failed === 0 && stats.push_failed === 0,
        mode: "convert_simplified_to_traditional",
        ...stats,
        ...(ids ? { requested: ids.length } : { scope: "all_mirror_rows" }),
      });
    }

    if (body.repair_metafields) {
      const ids = Array.isArray(body.shopify_product_ids)
        ? body.shopify_product_ids.map(String).filter((id) => /^\d+$/.test(id))
        : undefined;
      const stats = await repairMetafieldsForProducts(supabase, shopDomain, shopifyToken, ids);
      return json({
        success: stats.failed === 0,
        mode: "repair_metafields",
        ...stats,
        ...(ids ? { requested: ids.length } : { scope: "all_mirror_rows" }),
      });
    }

    if (body.push_all_from_mirror) {
      const { data: rows, error: fetchErr } = await supabase.from("shopify_products").select("*");
      if (fetchErr) return json({ error: fetchErr.message }, 500);
      const stats = await pushMirrorRows(supabase, shopDomain, shopifyToken, (rows || []) as Record<string, unknown>[]);
      return json({ success: true, mode: "push_all_from_mirror", ...stats });
    }

    if (Array.isArray(body.shopify_product_ids) && body.shopify_product_ids.length > 0) {
      const ids = body.shopify_product_ids.map(String).filter((id) => /^\d+$/.test(id));
      if (ids.length === 0) return json({ error: "No valid numeric shopify_product_ids" }, 400);
      const MAX_PER_REQUEST = 20;
      const batchIds = ids.slice(0, MAX_PER_REQUEST);
      const truncated = ids.length > MAX_PER_REQUEST;
      const { data: rows, error: fetchErr } = await supabase
        .from("shopify_products")
        .select("*")
        .in("shopify_product_id", batchIds);
      if (fetchErr) return json({ error: fetchErr.message }, 500);
      const stats = await pushMirrorRows(supabase, shopDomain, shopifyToken, (rows || []) as Record<string, unknown>[]);
      return json({
        success: true,
        mode: "push_selected_from_mirror",
        ...stats,
        requested: ids.length,
        processed: batchIds.length,
        truncated,
        remaining: truncated ? ids.length - MAX_PER_REQUEST : 0,
      });
    }

    if (body.push_from_mirror && body.shopify_product_id) {
      const sid = String(body.shopify_product_id);
      if (!/^\d+$/.test(sid)) return json({ error: "Invalid shopify_product_id" }, 400);
      const { data: row, error: fetchErr } = await supabase
        .from("shopify_products")
        .select("*")
        .eq("shopify_product_id", sid)
        .maybeSingle();
      if (fetchErr) return json({ error: fetchErr.message }, 500);
      if (!row) return json({ error: `No shopify_products row for ${sid}` }, 404);
      const stats = await pushMirrorRows(supabase, shopDomain, shopifyToken, [row as Record<string, unknown>]);
      // Always return 200 with per-item stats so client can distinguish 略過 vs 失敗.
      return json({
        success: stats.failed === 0,
        mode: "push_from_mirror",
        ...stats,
        ...(stats.failed > 0 ? { error: stats.errors[0]?.error || "Push failed" } : {}),
      });
    }

    const shopifyId = body.shopify_product_id;
    if (!shopifyId) return json({ error: "shopify_product_id is required" }, 400);

    const result = await pushProductToShopify(supabase, shopDomain, shopifyToken, shopifyId, body);
    if (!result.success) return json({ error: result.error || "Push failed" }, 502);

    return json({
      success: true,
      shopify_product_id: shopifyId,
      source_product_id: body.source_product_id || null,
      metafields_updated: result.metafields_updated,
      metafields_failed: result.metafields_failed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[update-shopify-product] Error:", msg);
    return json({ error: msg }, 500);
  }
});

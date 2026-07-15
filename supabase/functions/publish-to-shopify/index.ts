import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * publish-to-shopify — 準備上載 → Shopify → 已上載產品
 *
 * Image metafield policy: Supabase/HTTP URLs are upload sources only.
 * `custom.more_image_link_*` on Shopify + shopify_products mirror always use
 * live Shopify CDN URLs after images are attached to the product.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_STALENESS_THRESHOLD_MS = 60 * 60 * 1000;
const STORAGE_BUCKET = "product-images";

interface ProductPayload {
  id: string;
  title: string;
  description_html: string;
  tags: string[];
  price: number;
  compare_at_price?: number | null;
  image_url: string;
  images?: { src?: string; url?: string }[];
  /** Ordered gallery from merge UI — primary first */
  gallery_urls?: string[];
  primary_image_src?: string;
  shopify_product_id?: string | null;
  variants: {
    id: string;
    size: string;
    sku: string;
    price: number;
    compare_at_price?: number | null;
    inventory: number;
    option1?: string;
    title?: string;
    image_src?: string;
  }[];
  vendor?: string;
  product_type?: string;
  factory_name?: string;
  cost_price?: number | null;
  sale_price?: number | null;
  // Product-level SKU (ready_to_shopify.sku). Shopify stores SKU on the variant,
  // so this seeds the default/blank variant's sku.
  sku?: string;
  // ready_to_shopify row uuid → stored as shopify_products.id for 1:1 trace.
  rts_id?: string;
  // URL handle (ready_to_shopify.shopify_url).
  handle?: string;
  shopify_page_title?: string;
  shopify_page_description?: string;
  // Metafields as a map of "namespace.key" → value (matches DB columns),
  // OR a ready-made array of {namespace,key,type,value}.
  metafields?: Record<string, string> | { namespace: string; key: string; type?: string; value: string }[];
}

// ─── Shopify Product Metafield Definitions ───────────────────────────────────
// "namespace.key" → metafield type. Matches the columns added to shopify_products.
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
  "shopify.color-pattern": "list.metaobject_reference",
};

/** Repair mojibake in lead-time / production-time style values.
 * Some legacy `customize` values had the trailing 「天」 corrupted into one or
 * more U+FFFD replacement chars (hex efbfbd), e.g. "26-40" + . If a value
 * looks like a day-range whose CJK suffix was mangled, restore 「天」; otherwise
 * just strip stray replacement chars so no  reaches Shopify. */
// Shopify rejects any single_line / multi_line_text_field metafield value longer
// than 2048 characters (HTTP 422 "can't exceed 2048 characters."). Cap here so a
// long value (e.g. a verbose product spec mapped into a metafield) can't fail the
// whole publish. URLs are well under the limit; this guards the text fields.
const METAFIELD_MAX = 2048;

function cleanMetafieldValue(raw: string): string {
  let v = raw;
  // Day-range or number followed by mangled CJK → normalise to "<n>天"
  const m = v.match(/^(\d+\s*(?:-\s*\d+)?)\s*[�\s]*$/);
  if (m && /�/.test(v)) {
    return `${m[1].replace(/\s+/g, "")}天`;
  }
  // Otherwise drop any stray replacement chars
  v = v.replace(/�+/g, "").trim();
  // Enforce Shopify's 2048-char metafield ceiling (count by code points so we
  // never split a multi-byte CJK character mid-sequence).
  const chars = Array.from(v);
  if (chars.length > METAFIELD_MAX) v = chars.slice(0, METAFIELD_MAX).join("");
  return v;
}

/** Build Shopify-format metafields array from a payload.
 * Accepts either a {namespace.key: value} map or a ready-made array.
 * Empty/blank values are skipped. The `shopify.*` namespace is reserved
 * by Shopify and cannot be set via the products API, so it is excluded. */
function buildShopifyMetafields(
  mf: ProductPayload["metafields"]
): { namespace: string; key: string; type: string; value: string }[] {
  if (!mf) return [];
  const out: { namespace: string; key: string; type: string; value: string }[] = [];
  if (Array.isArray(mf)) {
    for (const m of mf) {
      if (!m || !m.namespace || !m.key) continue;
      if (m.namespace === "shopify") continue;
      const val = m.value != null ? cleanMetafieldValue(String(m.value).trim()) : "";
      if (!val) continue;
      const type = m.type || METAFIELD_DEFS[`${m.namespace}.${m.key}`] || "single_line_text_field";
      out.push({ namespace: m.namespace, key: m.key, type, value: val });
    }
    return out;
  }
  for (const [col, rawVal] of Object.entries(mf)) {
    const val = rawVal != null ? cleanMetafieldValue(String(rawVal).trim()) : "";
    if (!val) continue;
    const dot = col.indexOf(".");
    if (dot < 0) continue;
    const namespace = col.slice(0, dot);
    const key = col.slice(dot + 1);
    if (namespace === "shopify") continue; // reserved namespace
    const type = METAFIELD_DEFS[col] || "single_line_text_field";
    out.push({ namespace, key, type, value: val });
  }
  return out;
}

/** Remove product from 網上發佈 pipeline after successful Shopify publish. */
async function exitPublishPipeline(
  supabase: ReturnType<typeof createClient>,
  productId: string,
) {
  await supabase.from("ready_to_shopify").delete().eq("product_id", productId);
  await supabase.from("products").update({
    in_shopify_queue: false,
    ready_to_publish: false,
  }).eq("id", productId);
}

/** Mirror merged child RTS rows into shopify_products (configurable = parent SKU). */
async function mirrorMergedRtsChildren(
  supabase: ReturnType<typeof createClient>,
  parentShopifyId: string,
  parentSku: string,
  storeHost: string,
  childRtsIds: string[],
): Promise<void> {
  const sku = parentSku.trim();
  if (!sku || childRtsIds.length === 0) return;

  const { data: children, error } = await supabase
    .from("ready_to_shopify")
    .select("id, product_id, title, sku, vendor, image_url, price, product_type, tags, body_html")
    .in("id", childRtsIds)
    .eq("configurable", sku);

  if (error || !children?.length) return;

  const now = new Date().toISOString();
  for (const child of children) {
    const childRtsId = String(child.id);
    const childProductId = String(child.product_id);
    const syntheticShopifyId = `${parentShopifyId}-merged-${childRtsId}`;

    await supabase.from("shopify_products").upsert({
      id: childRtsId,
      shopify_product_id: syntheticShopifyId,
      source_product_id: childProductId,
      title: child.title || null,
      body_html: child.body_html || null,
      vendor: child.vendor || null,
      product_type: child.product_type || null,
      image_url: child.image_url || null,
      sku: child.sku || null,
      price: child.price != null ? Number(child.price) : null,
      tags: Array.isArray(child.tags) ? child.tags : [],
      status: "archived",
      configurable: sku,
      shop_domain: storeHost,
      imported_at: now,
      shopify_created_at: now,
      shopify_updated_at: now,
    }, { onConflict: "shopify_product_id" });

    await supabase.from("ready_to_shopify").delete().eq("id", childRtsId);
    await supabase.from("products").update({
      shopify_product_id: parentShopifyId,
      status: "success",
      in_shopify_queue: false,
      ready_to_publish: false,
      error_message: null,
    }).eq("id", childProductId);
  }

  console.log(
    `[publish-to-shopify] ✅ Mirrored ${children.length} merged child RTS row(s) to shopify_products (configurable=${sku})`,
  );
}

/** RTS shopify_url may be stored as "products/slug" — Shopify handle API wants "slug". */
function normalizeShopifyHandle(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  let h = raw.trim().replace(/^\/+/, "");
  if (h.startsWith("products/")) h = h.slice("products/".length);
  return h || null;
}

/** Map ready_to_shopify SEO columns → mirror + Shopify Search engine listing fields. */
function rtsSeoFields(product: ProductPayload): {
  shopify_page_title: string | null;
  shopify_page_description: string | null;
  shopify_url: string | null;
  handleForShopify: string | null;
} {
  const shopify_page_title = product.shopify_page_title?.trim() || null;
  const shopify_page_description = product.shopify_page_description?.trim() || null;
  const shopify_url = normalizeShopifyHandle(product.handle);
  return { shopify_page_title, shopify_page_description, shopify_url, handleForShopify: shopify_url };
}

/** Update handle + SEO via GraphQL (REST product create does not set seo fields). */
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

  const resp = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
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

/** Push RTS SEO fields to Shopify GraphQL and return mirror columns for shopify_products. */
async function applyProductSeoMirror(
  storeHost: string,
  token: string,
  shopifyId: string,
  product: ProductPayload,
): Promise<Record<string, unknown>> {
  const seo = rtsSeoFields(product);
  const out: Record<string, unknown> = {
    shopify_page_title: seo.shopify_page_title,
    shopify_page_description: seo.shopify_page_description,
    shopify_url: seo.shopify_url,
  };

  if (seo.handleForShopify || seo.shopify_page_title || seo.shopify_page_description) {
    const result = await updateSeoAndHandle(storeHost, token, shopifyId, {
      handle: seo.handleForShopify || undefined,
      seoTitle: seo.shopify_page_title ?? "",
      seoDescription: seo.shopify_page_description ?? "",
    });
    if (!result.ok) {
      console.warn(`[publish-to-shopify] SEO/handle update failed for ${shopifyId}: ${result.error}`);
    }
  }
  return out;
}

// ─── Image Validation & Upload Helpers ──────────────────────────────────────

/** Identity key for de-duplicating images across different host URLs.
 * The same image often appears as both a Storage URL (image_url) and a
 * Shopify CDN URL (after a prior publish), e.g.
 *   .../products/abc_primary_123.jpg            (Storage)
 *   cdn.shopify.com/.../abc_primary_123.jpg?v=… (Shopify, re-published)
 * Comparing full URLs misses these, sending the primary twice. We key on the
 * filename stem (basename without query string / extension) instead. */
/**
 * Filename stem — matches Supabase Storage vs Shopify CDN for the same asset.
 * Also collapses Shopify re-upload suffixes (`foo_1` / `foo_<uuid>`).
 */
function imageIdentityKey(url: string): string {
  if (!url || typeof url !== "string") return "";
  const noQuery = url.split("?")[0];
  const base = noQuery.substring(noQuery.lastIndexOf("/") + 1);
  return base
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(
      /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "",
    )
    .replace(/_\d+$/, "")
    .trim()
    .toLowerCase();
}

function isHttpUrl(src: unknown): src is string {
  return typeof src === "string" && /^https?:\/\//.test(src);
}

/** Prefer filename stem so Storage URL ≡ Shopify CDN URL for the same file. */
function imageDedupeKey(src: string): string {
  const stem = imageIdentityKey(src);
  if (stem) return stem;
  try {
    const u = new URL(src);
    return `${u.origin}${u.pathname}`.replace(
      /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[a-z0-9]+$)/i,
      "",
    );
  } catch {
    return src.split("?")[0] ?? src;
  }
}

type ShopifyRecord = Record<string, unknown>;

async function fetchShopifyProduct(
  apiBase: string,
  headers: Record<string, string>,
  productId: string,
): Promise<ShopifyRecord | null> {
  const r = await fetch(`${apiBase}/products/${productId}.json`, { headers });
  if (!r.ok) return null;
  return (await r.json()).product as ShopifyRecord;
}

function indexShopifyImagesByDedupe(images: ShopifyRecord[]): Map<string, ShopifyRecord> {
  const byDedupe = new Map<string, ShopifyRecord>();
  for (const im of images) {
    if (!isHttpUrl(im.src)) continue;
    const key = imageDedupeKey(im.src as string);
    const prev = byDedupe.get(key);
    if (!prev || String(im.src).length < String(prev.src).length) {
      byDedupe.set(key, im);
    }
  }
  return byDedupe;
}

function findExistingProductImage(images: ShopifyRecord[], src: string): ShopifyRecord | undefined {
  return indexShopifyImagesByDedupe(images).get(imageDedupeKey(src));
}

async function ensureGalleryImagesOnShopify(
  apiBase: string,
  headers: Record<string, string>,
  parentId: string,
  galleryUrls: string[],
  primarySrc: string | null,
): Promise<ShopifyRecord[]> {
  const product = await fetchShopifyProduct(apiBase, headers, parentId);
  if (!product) return [];
  const images = [...((product.images as ShopifyRecord[]) || [])];
  const byDedupe = indexShopifyImagesByDedupe(images);
  const seen = new Set<string>();
  const uniqueGallery: string[] = [];
  if (primarySrc && isHttpUrl(primarySrc)) {
    const key = imageDedupeKey(primarySrc);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueGallery.push(primarySrc);
    }
  }
  for (const url of galleryUrls) {
    if (!isHttpUrl(url)) continue;
    const key = imageDedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueGallery.push(url);
  }
  for (const src of uniqueGallery) {
    if (byDedupe.has(imageDedupeKey(src))) continue;
    const postResp = await fetch(`${apiBase}/products/${parentId}/images.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ image: { src } }),
    });
    if (!postResp.ok) continue;
    const newImg = (await postResp.json()).image as ShopifyRecord;
    if (newImg?.id != null) {
      images.push(newImg);
      if (isHttpUrl(newImg.src)) byDedupe.set(imageDedupeKey(newImg.src as string), newImg);
    }
  }
  return images;
}

/** Map gallery URLs to live Shopify image rows (deduped) for position reorder. */
function buildOrderedShopifyImagesFromGallery(
  shopifyImages: ShopifyRecord[],
  galleryUrls: string[],
  primarySrc: string | null,
): ShopifyRecord[] {
  const byDedupe = indexShopifyImagesByDedupe(shopifyImages);
  const seen = new Set<string>();
  const uniqueGallery: string[] = [];
  const add = (src: string | null | undefined) => {
    if (!isHttpUrl(src)) return;
    const key = imageDedupeKey(src);
    if (seen.has(key)) return;
    seen.add(key);
    uniqueGallery.push(src);
  };
  add(primarySrc);
  for (const url of galleryUrls) add(url);

  const ordered: ShopifyRecord[] = [];
  for (const src of uniqueGallery) {
    const im = byDedupe.get(imageDedupeKey(src));
    if (im?.id != null) ordered.push(im);
  }
  return ordered;
}

/** PUT explicit positions so Shopify featured image matches gallery order. */
async function reorderShopifyProductImages(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  orderedImages: ShopifyRecord[],
): Promise<boolean> {
  const images = orderedImages
    .filter((im) => im.id != null)
    .map((im, i) => ({ id: Number(im.id), position: i + 1 }));
  if (images.length === 0) return false;

  const resp = await fetch(`${apiBase}/products/${shopifyId}.json`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ product: { id: Number(shopifyId), images } }),
  });
  if (!resp.ok) {
    console.warn(
      "[publish-to-shopify] gallery reorder failed:",
      (await resp.text()).slice(0, 200),
    );
    return false;
  }
  return true;
}

async function setVariantImageId(
  apiBase: string,
  headers: Record<string, string>,
  parentId: string,
  variantId: number,
  imageId: number,
): Promise<boolean> {
  const resp = await fetch(`${apiBase}/products/${parentId}/variants/${variantId}.json`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ variant: { id: variantId, image_id: imageId } }),
  });
  return resp.ok;
}

async function attachVariantImagesBySku(
  apiBase: string,
  headers: Record<string, string>,
  parentId: string,
  specs: { sku: string; image_src?: string }[],
  primarySrc: string | null,
): Promise<void> {
  const product = await fetchShopifyProduct(apiBase, headers, parentId);
  if (!product) return;
  let images = [...((product.images as ShopifyRecord[]) || [])];
  const variants = (product.variants as ShopifyRecord[]) || [];

  for (const spec of specs) {
    const rawSrc = spec.image_src;
    if (!isHttpUrl(rawSrc)) continue;
    const src = primarySrc && imageDedupeKey(rawSrc) === imageDedupeKey(primarySrc) ? primarySrc : rawSrc;
    const variant = variants.find((v) => String(v.sku) === spec.sku);
    if (variant?.id == null) continue;
    const variantId = Number(variant.id);

    let target = findExistingProductImage(images, src);
    if (!target?.id) {
      const postResp = await fetch(`${apiBase}/products/${parentId}/images.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ image: { src } }),
      });
      if (!postResp.ok) continue;
      const newImg = (await postResp.json()).image as ShopifyRecord;
      if (newImg?.id == null) continue;
      target = newImg;
      images.push(newImg);
    }
    const imageId = Number(target.id);
    const currentImageId = variant.image_id != null ? Number(variant.image_id) : null;
    if (currentImageId !== imageId) {
      await setVariantImageId(apiBase, headers, parentId, variantId, imageId);
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
    if (url && isHttpUrl(url)) {
      cols[linkKey] = url;
      cols[altKey] = title?.trim() ? title.trim() : null;
    } else {
      cols[linkKey] = null;
      cols[altKey] = null;
    }
  }
  return cols;
}

const IMAGE_METAFIELD_COL_PREFIXES = [
  "custom.more_image_link_",
  "custom.more_image_alt_",
  "my_fields.image_link",
  "my_fields.image_alt",
];

/** Strip image URL metafields from inline product create — set after Shopify CDN upload. */
function stripImageUrlMetafields(
  mf: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, val] of Object.entries(mf)) {
    if (IMAGE_METAFIELD_COL_PREFIXES.some((p) => col.startsWith(p) || col === p)) continue;
    out[col] = val;
  }
  return out;
}

/** Map gallery order → live Shopify CDN URLs for more_image_* metafields. */
function orderedShopifyCdnUrlsForMetafields(
  shopifyImages: ShopifyRecord[],
  galleryUrls: string[],
  primarySrc: string | null,
): string[] {
  return buildOrderedShopifyImagesFromGallery(shopifyImages, galleryUrls, primarySrc)
    .map((im) => String(im.src ?? ""))
    .filter((src) => isHttpUrl(src));
}

function mergeMoreImageMetafieldColumns(
  base: Record<string, string>,
  orderedUrls: string[],
  title?: string | null,
): Record<string, string> {
  const merged = { ...base };
  const moreCols = moreImageLinkColumnsFromUrls(orderedUrls.slice(0, 4), title);
  for (const [col, val] of Object.entries(moreCols)) {
    if (val && String(val).trim()) merged[col] = String(val).trim();
    else delete merged[col];
  }
  return merged;
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

  const existingResp = await fetch(
    `${apiBase}/products/${shopifyId}/metafields.json?namespace=${namespace}&key=${key}`,
    { headers },
  );
  const existing = existingResp.ok
    ? ((await existingResp.json()).metafields?.[0] as { id?: number } | undefined)
    : undefined;

  if (!trimmed) {
    if (existing?.id) {
      const del = await fetch(`${apiBase}/metafields/${existing.id}.json`, { method: "DELETE", headers });
      return del.ok;
    }
    return true;
  }

  if (existing?.id) {
    const pr = await fetch(`${apiBase}/metafields/${existing.id}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ metafield: { id: existing.id, type, value: trimmed } }),
    });
    return pr.ok;
  }

  const r = await fetch(`${apiBase}/products/${shopifyId}/metafields.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ metafield: { namespace, key, type, value: trimmed } }),
  });
  return r.ok;
}

async function syncMoreImageMetafieldsToShopify(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  orderedUrls: string[],
  title?: string | null,
): Promise<void> {
  const cols = moreImageLinkColumnsFromUrls(orderedUrls, title);
  const moreImageCols = [
    "custom.more_image_link_1", "custom.more_image_alt_1",
    "custom.more_image_link_2", "custom.more_image_alt_2",
    "custom.more_image_link_3", "custom.more_image_alt_3",
    "custom.more_image_link_4", "custom.more_image_alt_4",
  ];
  for (const col of moreImageCols) {
    await upsertProductMetafield(apiBase, headers, shopifyId, col, cols[col] ?? "");
  }
}

/** Push text/core metafields via separate API calls — inline create often drops them. */
async function syncCoreMetafieldsToShopify(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  metafields: Record<string, string> | undefined,
): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  if (!metafields) return { ok, fail };
  for (const [col, rawVal] of Object.entries(metafields)) {
    if (IMAGE_METAFIELD_COL_PREFIXES.some((p) => col.startsWith(p) || col === p)) continue;
    const val = rawVal != null ? cleanMetafieldValue(String(rawVal).trim()) : "";
    if (!val) continue;
    const success = await upsertProductMetafield(apiBase, headers, shopifyId, col, val);
    if (success) ok++;
    else fail++;
  }
  return { ok, fail };
}

/**
 * After product images exist on Shopify, write more_image_* metafields using live CDN URLs
 * and return refreshed product + mirror column map. Supabase URLs are upload sources only.
 */
async function finalizeCdnImageMetafieldsForProduct(
  apiBase: string,
  headers: Record<string, string>,
  shopifyId: string,
  title: string,
  orderedGallery: string[],
  resolvedPrimary: string | null,
): Promise<{
  liveProduct: ShopifyRecord | null;
  cdnUrls: string[];
  mfColumns: Record<string, string | null>;
}> {
  let live = await fetchShopifyProduct(apiBase, headers, shopifyId);
  if (!live) {
    return { liveProduct: null, cdnUrls: [], mfColumns: moreImageLinkColumnsFromUrls([], title) };
  }

  let images = (live.images as ShopifyRecord[]) || [];
  let cdnUrls = orderedShopifyCdnUrlsForMetafields(images, orderedGallery, resolvedPrimary).slice(0, 4);
  if (cdnUrls.length === 0) {
    cdnUrls = images
      .filter((im) => isHttpUrl(im.src))
      .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99))
      .map((im) => String(im.src))
      .slice(0, 4);
  }

  if (cdnUrls.length > 0) {
    await syncMoreImageMetafieldsToShopify(apiBase, headers, shopifyId, cdnUrls, title);
    live = await fetchShopifyProduct(apiBase, headers, shopifyId);
    if (live) {
      images = (live.images as ShopifyRecord[]) || images;
      const refreshed = orderedShopifyCdnUrlsForMetafields(images, orderedGallery, resolvedPrimary).slice(0, 4);
      if (refreshed.length > 0) cdnUrls = refreshed;
    }
  }

  return {
    liveProduct: live,
    cdnUrls,
    mfColumns: moreImageLinkColumnsFromUrls(cdnUrls, title),
  };
}

function metafieldsArrayFromColumnMap(cols: Record<string, string | null | undefined>): {
  namespace: string;
  key: string;
  type: string;
  value: string;
}[] {
  const map: Record<string, string> = {};
  for (const [col, val] of Object.entries(cols)) {
    if (val != null && String(val).trim()) map[col] = String(val).trim();
  }
  return buildShopifyMetafields(map);
}

function buildOrderedGalleryUrls(
  product: ProductPayload,
  resolvedPrimary: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (src: string | null | undefined) => {
    if (!isHttpUrl(src)) return;
    const key = imageDedupeKey(src);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(src);
  };
  const primaryCandidate = resolvedPrimary || product.primary_image_src || product.image_url || null;
  // image_url is the primary; product.images / gallery_urls are extras — always lead with primary.
  add(primaryCandidate);
  if (Array.isArray(product.gallery_urls) && product.gallery_urls.length > 0) {
    for (const url of product.gallery_urls) add(url);
  } else if (Array.isArray(product.images)) {
    for (const im of product.images) add(im?.src || im?.url);
  }
  return out;
}

/** Mirror gallery: prefer live Shopify images sorted by position; fall back to RTS URLs. */
function buildMirrorGalleryFields(
  shopifyImages: ShopifyRecord[],
  orderedGallery: string[],
): { image_url: string | null; images: ShopifyRecord[] | null } {
  const sorted = [...shopifyImages]
    .filter((im) => isHttpUrl(im.src as string))
    .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99));

  if (sorted.length > 0) {
    // Stem-dedupe so create+re-attach duplicates (Storage + CDN / foo + foo_1) collapse.
    const seen = new Set<string>();
    const deduped: ShopifyRecord[] = [];
    for (const im of sorted) {
      const key = imageDedupeKey(String(im.src));
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(im);
    }
    const normalized = deduped.map((im, i) => ({
      id: im.id,
      src: im.src,
      alt: im.alt || "",
      width: im.width,
      height: im.height,
      position: i + 1,
    }));
    const primary = (normalized[0]?.src as string) || null;
    return { image_url: primary, images: normalized };
  }
  if (orderedGallery.length > 0) {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const src of orderedGallery) {
      if (!isHttpUrl(src)) continue;
      const key = imageDedupeKey(src);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(src);
    }
    const fallback = unique.map((src, i) => ({ src, position: i + 1 }));
    return { image_url: unique[0] || null, images: fallback };
  }
  return { image_url: null, images: null };
}

function isValidHttpImageUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function isBase64Image(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("data:image/")) return true;
  if (trimmed.length > 200 && !trimmed.includes("://") && !trimmed.startsWith("/")) return true;
  if (/^[A-Za-z0-9+/=]{100,}$/.test(trimmed.substring(0, 200))) return true;
  return false;
}

function parseBase64Image(url: string): { mimeType: string; base64Data: string } | null {
  const trimmed = url.trim();
  const dataUriMatch = trimmed.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/s);
  if (dataUriMatch) {
    return { mimeType: dataUriMatch[1], base64Data: dataUriMatch[2] };
  }
  if (trimmed.length > 100) {
    let mimeType = "image/png";
    if (trimmed.startsWith("/9j/")) mimeType = "image/jpeg";
    else if (trimmed.startsWith("iVBOR")) mimeType = "image/png";
    else if (trimmed.startsWith("R0lGOD")) mimeType = "image/gif";
    else if (trimmed.startsWith("UklGR")) mimeType = "image/webp";
    return { mimeType, base64Data: trimmed };
  }
  return null;
}

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[mime] || "png";
}

async function ensureBucket(supabase: ReturnType<typeof createClient>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b: { name: string }) => b.name === STORAGE_BUCKET);
  if (!exists) {
    console.log(`[publish-to-shopify] 📦 Creating storage bucket "${STORAGE_BUCKET}"...`);
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    });
    if (error) {
      console.error(`[publish-to-shopify] ⚠️ Bucket creation error (may already exist): ${error.message}`);
    } else {
      console.log(`[publish-to-shopify] ✅ Bucket "${STORAGE_BUCKET}" created successfully`);
    }
  } else {
    console.log(`[publish-to-shopify] ✅ Bucket "${STORAGE_BUCKET}" already exists`);
  }
}

async function uploadBase64ToStorage(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  productId: string,
  base64Image: string
): Promise<string | null> {
  const parsed = parseBase64Image(base64Image);
  if (!parsed) {
    console.warn(`[publish-to-shopify] ⚠️ Could not parse base64 image for product ${productId}`);
    return null;
  }
  const { mimeType, base64Data } = parsed;
  const ext = getExtFromMime(mimeType);
  const fileName = `${productId}_${Date.now()}.${ext}`;
  const filePath = `products/${fileName}`;
  console.log(`[publish-to-shopify] 📤 Uploading image to storage: ${filePath} (${mimeType}, ~${Math.round(base64Data.length * 0.75 / 1024)}KB)`);
  try {
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) {
      console.error(`[publish-to-shopify] ❌ Storage upload error: ${uploadError.message}`);
      return null;
    }
    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    const publicUrl = publicUrlData?.publicUrl;
    if (publicUrl) {
      console.log(`[publish-to-shopify] ✅ Image uploaded → ${publicUrl}`);
      return publicUrl;
    }
    const manualUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${filePath}`;
    console.log(`[publish-to-shopify] ✅ Image uploaded → ${manualUrl} (manual URL)`);
    return manualUrl;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[publish-to-shopify] ❌ Image upload exception: ${errMsg}`);
    return null;
  }
}

async function resolveImageUrl(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  productId: string,
  imageUrl: string
): Promise<{ url: string | null; warning?: string }> {
  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.trim()) {
    return { url: null, warning: "No image URL provided" };
  }
  const trimmed = imageUrl.trim();
  if (isValidHttpImageUrl(trimmed)) {
    console.log(`[publish-to-shopify] 🔗 Image URL is valid HTTP: ${trimmed.substring(0, 80)}...`);
    return { url: trimmed };
  }
  if (isBase64Image(trimmed)) {
    console.log(`[publish-to-shopify] 🔄 Image is base64 (${Math.round(trimmed.length / 1024)}KB). Uploading to Supabase Storage...`);
    const publicUrl = await uploadBase64ToStorage(supabase, supabaseUrl, productId, trimmed);
    if (publicUrl) return { url: publicUrl };
    return { url: null, warning: `Base64 image upload to storage failed for product ${productId}. Publishing without image.` };
  }
  console.warn(`[publish-to-shopify] ⚠️ Invalid image URL format for product ${productId}: "${trimmed.substring(0, 60)}..." — skipping image`);
  return { url: null, warning: `Image URL is not a valid HTTP URL or base64 data: "${trimmed.substring(0, 40)}..."` };
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let shopifyAccessToken = "";
    let shopifyStoreUrl = "";

    console.log(`[publish-to-shopify] Fetching active Shopify connection from shopify_connections...`);
    const { data: conn, error: connErr } = await supabase
      .from("shopify_connections")
      .select("shop_domain, access_token, connected_at, updated_at, is_active")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connErr) {
      console.error("[publish-to-shopify] ❌ Error querying shopify_connections:", connErr.message);
    }

    if (conn && conn.access_token) {
      shopifyAccessToken = conn.access_token;
      shopifyStoreUrl = conn.shop_domain;
      const updatedAt = conn.updated_at || conn.connected_at;
      if (updatedAt) {
        const ageMs = Date.now() - new Date(updatedAt).getTime();
        const ageMinutes = Math.round(ageMs / 60000);
        if (ageMs > TOKEN_STALENESS_THRESHOLD_MS) {
          console.warn(`[publish-to-shopify] ⚠️ TOKEN STALE: Token for ${conn.shop_domain} was last updated ${ageMinutes} minutes ago.`);
        } else {
          console.log(`[publish-to-shopify] ✅ Token is fresh — last updated ${ageMinutes} minutes ago for ${conn.shop_domain}`);
        }
      }
    } else {
      console.warn(`[publish-to-shopify] ⚠️ No active connection found in shopify_connections table`);
    }

    const body = await req.json();
    const { products, shopify_access_token: bodyToken, shopify_store_url: bodyStoreUrl, force_create: forceCreate } = body as {
      products: ProductPayload[];
      shopify_access_token?: string;
      shopify_store_url?: string;
      force_create?: boolean;
    };

    if (!shopifyAccessToken.trim() && bodyToken && bodyToken.trim()) {
      shopifyAccessToken = bodyToken.trim();
      console.log("[publish-to-shopify] Using shopify_access_token from request body (Settings UI fallback)");
    }
    if (!shopifyStoreUrl.trim() && bodyStoreUrl && bodyStoreUrl.trim()) {
      shopifyStoreUrl = bodyStoreUrl.trim();
      console.log("[publish-to-shopify] Using shopify_store_url from request body (Settings UI fallback)");
    }

    if (!shopifyAccessToken.trim() || !shopifyStoreUrl.trim()) {
      console.error("[publish-to-shopify] ❌ No Shopify credentials available from DB or request body");
      return new Response(
        JSON.stringify({ error: "No Shopify credentials found. The shopify_connections table has no active entry (is_active=true)." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const storeHost = shopifyStoreUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const shopifyApiBase = `https://${storeHost}/admin/api/2024-10`;

    console.log("[publish-to-shopify] Token present:", !!shopifyAccessToken);
    console.log("[publish-to-shopify] Token prefix:", shopifyAccessToken.substring(0, 10) + "...");
    console.log("[publish-to-shopify] API base:", shopifyApiBase);

    if (!products || !Array.isArray(products) || products.length === 0) {
      return new Response(
        JSON.stringify({ error: "Expected { products: [...] } with at least one product." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    await ensureBucket(supabase);
    console.log(`[publish-to-shopify] INCREMENTAL CREATE-ONLY mode — Processing ${products.length} product(s)`);

    const results: {
      id: string;
      success: boolean;
      shopify_product_id?: string;
      error?: string;
      action?: string;
      image_warning?: string;
    }[] = [];

    for (const product of products) {
      try {
        // SAFETY: skip products that already exist on Shopify — UNLESS the caller
        // explicitly requested force_create (e.g. 準備上載 wants a brand-new product
        // even if this row was previously imported from Shopify).
        if (product.shopify_product_id && !forceCreate) {
          console.log(`[publish-to-shopify] SAFETY: Skipping "${product.title}" — already has Shopify ID ${product.shopify_product_id}.`);
          await supabase.from("products").update({ status: "success", error_message: null }).eq("id", product.id);
          results.push({ id: product.id, success: true, shopify_product_id: product.shopify_product_id, action: "skipped_already_exists" });
          continue;
        }
        if (product.shopify_product_id && forceCreate) {
          console.log(`[publish-to-shopify] FORCE CREATE: "${product.title}" has old Shopify ID ${product.shopify_product_id} but force_create=true — creating a brand-new Shopify product.`);
        }

        // ── AUTO-FIX: Ensure variants array always exists ──────────────────
        // Seed the default variant's SKU from the product-level sku so the SKU
        // is written to Shopify even when the product has no explicit variants.
        let productVariants = product.variants;
        if (!productVariants || !Array.isArray(productVariants) || productVariants.length === 0) {
          console.warn(`[publish-to-shopify] ⚠️ AUTO-FIX: Product "${product.title}" has no variants. Creating default variant.`);
          productVariants = [{
            id: "default",
            size: "",
            sku: product.sku || "",
            price: product.price || 0,
            compare_at_price: product.compare_at_price || null,
            inventory: 0,
          }];
        }

        // ── Sanitize variants — single option "尺寸(mm)" only, no Color ────
        // Default inventory to 1000 on every publish. Shopify tracks stock when
        // inventory_management="shopify"; inventory_quantity seeds the count for
        // the product's (single) default location at creation time.
        // Per spec: every publish seeds inventory to 1000 for all variants.
        const DEFAULT_INVENTORY = 1000;
        const sanitizedVariants = productVariants.map((v) => {
          const variantPrice = (typeof v.price === "number" && !isNaN(v.price)) ? v.price : (product.price || 0);
          const sizeValue = v.option1 || v.title || v.size || "";
          const variant: Record<string, unknown> = {
            option1: sizeValue,
            price: variantPrice.toFixed(2),
            // Fall back to the product-level sku if this variant has no sku.
            sku: (v.sku && String(v.sku).trim()) || product.sku || "",
            inventory_management: "shopify",
            inventory_quantity: DEFAULT_INVENTORY,
            requires_shipping: true,
          };
          if (v.compare_at_price && v.compare_at_price > variantPrice) {
            variant.compare_at_price = v.compare_at_price.toFixed(2);
          } else if (product.compare_at_price && product.compare_at_price > variantPrice) {
            variant.compare_at_price = product.compare_at_price.toFixed(2);
          }
          return variant;
        });

        // ── IMAGE VALIDATION & RESOLUTION ──────────────────────────────────
        let resolvedImageUrl: string | null = null;
        let imageWarning: string | undefined;

        // When RTS only had images[] extras, client may still send empty image_url.
        // Fall back to products.image_url from catalog before building the gallery.
        let catalogPrimaryUrl = "";
        if (!product.image_url?.trim() || !product.primary_image_src?.trim()) {
          const { data: prodRow } = await supabase
            .from("products")
            .select("image_url")
            .eq("id", product.id)
            .maybeSingle();
          catalogPrimaryUrl = (prodRow?.image_url || "").trim();
          if (catalogPrimaryUrl.startsWith("http")) {
            if (!product.image_url?.trim()) product.image_url = catalogPrimaryUrl;
            if (!product.primary_image_src?.trim()) product.primary_image_src = catalogPrimaryUrl;
            if (!Array.isArray(product.gallery_urls) || product.gallery_urls.length === 0) {
              const extras = (product.images || [])
                .map((im) => im?.src || im?.url || "")
                .filter((s) => typeof s === "string" && s.startsWith("http"));
              product.gallery_urls = [catalogPrimaryUrl, ...extras];
            } else if (
              product.gallery_urls.length > 0 &&
              imageIdentityKey(product.gallery_urls[0]) !== imageIdentityKey(catalogPrimaryUrl)
            ) {
              const rest = product.gallery_urls.filter(
                (u) => imageIdentityKey(u) !== imageIdentityKey(catalogPrimaryUrl),
              );
              product.gallery_urls = [catalogPrimaryUrl, ...rest];
            }
            console.log(
              `[publish-to-shopify] 📎 Catalog primary fallback for "${product.title}": ${catalogPrimaryUrl.substring(0, 80)}...`,
            );
          }
        }

        if (product.image_url) {
          console.log(`[publish-to-shopify] 🖼️ Validating primary image for "${product.title}"`);
          const imageResult = await resolveImageUrl(supabase, supabaseUrl, product.id, product.image_url);
          resolvedImageUrl = imageResult.url;
          imageWarning = imageResult.warning;
          if (imageWarning) console.warn(`[publish-to-shopify] ⚠️ Image warning for "${product.title}": ${imageWarning}`);
          if (resolvedImageUrl && resolvedImageUrl !== product.image_url) {
            console.log(`[publish-to-shopify] 📝 Updating product image_url in DB to storage URL`);
            await supabase.from("products").update({ image_url: resolvedImageUrl }).eq("id", product.id);
          }
        } else {
          console.log(`[publish-to-shopify] ℹ️ No image_url provided for "${product.title}"`);
        }

        // ── Build Shopify product payload ──────────────────────────────────
        const shopifyProduct: Record<string, unknown> = {
          title: product.title || "Untitled Product",
          body_html: product.description_html || `<p>${product.title || "Untitled Product"}</p>`,
          vendor: product.vendor || product.factory_name || "",
          product_type: product.product_type || "",
          tags: Array.isArray(product.tags) ? product.tags.join(", ") : "",
          status: "active",
          variants: sanitizedVariants,
          options: [
            { name: "尺寸(mm)" },
          ],
        };
        // URL handle from ready_to_shopify.shopify_url
        const createHandle = normalizeShopifyHandle(product.handle);
        if (createHandle) {
          shopifyProduct.handle = createHandle;
        }

        // ── Attach metafields (sent inline on product create) ──────────────
        // Image URL metafields are written after gallery upload with Shopify CDN URLs.
        const inlineMetafields = product.metafields && !Array.isArray(product.metafields)
          ? stripImageUrlMetafields(product.metafields)
          : product.metafields;
        const shopifyMetafields = buildShopifyMetafields(inlineMetafields);
        if (shopifyMetafields.length > 0) {
          shopifyProduct.metafields = shopifyMetafields;
          console.log(`[publish-to-shopify] 🏷️ Attaching ${shopifyMetafields.length} metafield(s) for "${product.title}": ${shopifyMetafields.map(m => `${m.namespace}.${m.key}`).join(", ")}`);
        }

        // ── Build images array — primary (image_url) first, then extras ─────
        const allImages: { src: string }[] = [];
        const seenImageKeys = new Set<string>();
        const rawGallerySources: string[] = [];
        const seenRawKeys = new Set<string>();
        const addRawSource = (src: string | null | undefined) => {
          if (!src || typeof src !== "string" || !src.trim()) return;
          const trimmed = src.trim();
          const key = imageIdentityKey(trimmed);
          if (seenRawKeys.has(key)) return;
          seenRawKeys.add(key);
          rawGallerySources.push(trimmed);
        };
        addRawSource(product.primary_image_src || product.image_url);
        if (Array.isArray(product.gallery_urls) && product.gallery_urls.length > 0) {
          for (const url of product.gallery_urls) addRawSource(url);
        } else if (Array.isArray(product.images) && product.images.length > 0) {
          for (const img of product.images) {
            addRawSource(img?.src || img?.url || (typeof img === "string" ? img : ""));
          }
        }

        if (rawGallerySources.length > 0) {
          console.log(`[publish-to-shopify] 🖼️ Resolving ${rawGallerySources.length} gallery image(s) for "${product.title}"`);
          for (let imgIdx = 0; imgIdx < rawGallerySources.length; imgIdx++) {
            const rawSrc = rawGallerySources[imgIdx];
            const imgResult = await resolveImageUrl(supabase, supabaseUrl, `${product.id}_gal${imgIdx}`, rawSrc);
            if (imgResult.url) {
              const key = imageIdentityKey(imgResult.url);
              if (!seenImageKeys.has(key)) {
                allImages.push({ src: imgResult.url });
                seenImageKeys.add(key);
                if (imgIdx === 0) resolvedImageUrl = imgResult.url;
                console.log(`[publish-to-shopify] ✅ Gallery image [${imgIdx}]: ${imgResult.url.substring(0, 80)}...`);
              }
            } else if (imgResult.warning) {
              console.warn(`[publish-to-shopify] ⚠️ Gallery image [${imgIdx}] skipped: ${imgResult.warning}`);
            }
          }
        } else if (resolvedImageUrl) {
          allImages.push({ src: resolvedImageUrl });
          seenImageKeys.add(imageIdentityKey(resolvedImageUrl));
          console.log(`[publish-to-shopify] ✅ Primary image: ${resolvedImageUrl.substring(0, 80)}...`);
        }
        if (allImages.length > 0) {
          shopifyProduct.images = allImages;
          console.log(`[publish-to-shopify] 📸 Total images for "${product.title}": ${allImages.length}`);
        } else {
          console.log(`[publish-to-shopify] ℹ️ Publishing "${product.title}" WITHOUT images`);
        }

        // ── Log the exact payload being sent ─────────────────────────────
        const requestPayload = { product: shopifyProduct };
        console.log(`[publish-to-shopify] POST (CREATE) new Shopify product for "${product.title}"`);
        console.log(`[publish-to-shopify] 📦 Payload for "${product.title}":`, JSON.stringify(requestPayload, null, 2));

        // ── Shopify API call ─────────────────────────────────────────────
        let shopifyResponse: Response;
        let rawResponseBody: string;
        try {
          shopifyResponse = await fetch(`${shopifyApiBase}/products.json`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": shopifyAccessToken,
            },
            body: JSON.stringify(requestPayload),
          });

          console.log(`[publish-to-shopify] 📋 Response status: ${shopifyResponse.status} ${shopifyResponse.statusText}`);
          const shopScopes = shopifyResponse.headers.get("X-Shopify-Allowed-Scopes");
          if (shopScopes !== null) {
            console.log(`[publish-to-shopify] 🔑 X-Shopify-Allowed-Scopes: ${shopScopes}`);
            if (!shopScopes.includes("write_products")) {
              console.error(`[publish-to-shopify] 🚨 CRITICAL: "write_products" scope is MISSING! Current scopes: ${shopScopes}`);
            }
          }
          const apiCallLimit = shopifyResponse.headers.get("X-Shopify-Shop-Api-Call-Limit");
          if (apiCallLimit) console.log(`[publish-to-shopify] 📊 API call limit: ${apiCallLimit}`);

          rawResponseBody = await shopifyResponse.text();
        } catch (fetchError) {
          const fetchErrMsg = fetchError instanceof Error ? fetchError.message : "Network/fetch error";
          console.error(`[publish-to-shopify] 🌐 FETCH ERROR for "${product.title}":`, fetchErrMsg);
          await supabase.from("products").update({ status: "error", error_message: `Network error: ${fetchErrMsg}` }).eq("id", product.id);
          results.push({ id: product.id, success: false, error: `Network error: ${fetchErrMsg}`, action: "create_failed" });
          continue;
        }

        // ── Handle non-OK responses ───────────────────────────────────────
        if (!shopifyResponse.ok) {
          console.error(`[publish-to-shopify] ❌ Shopify API error for "${product.title}" (HTTP ${shopifyResponse.status}):`);
          console.error(`[publish-to-shopify] ❌ FULL RESPONSE BODY:\n${rawResponseBody}`);

          const isImageError =
            shopifyResponse.status === 422 &&
            (rawResponseBody.toLowerCase().includes("image") ||
             rawResponseBody.toLowerCase().includes("src") ||
             rawResponseBody.toLowerCase().includes("url is not valid"));

          if (isImageError && resolvedImageUrl) {
            console.warn(`[publish-to-shopify] 🔄 FALLBACK: Got 422 image error. Retrying "${product.title}" WITHOUT images...`);
            delete shopifyProduct.images;
            const fallbackPayload = { product: shopifyProduct };
            try {
              const fallbackResponse = await fetch(`${shopifyApiBase}/products.json`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyAccessToken },
                body: JSON.stringify(fallbackPayload),
              });
              const fallbackBody = await fallbackResponse.text();
              if (fallbackResponse.ok) {
                let fallbackData: Record<string, unknown>;
                try {
                  fallbackData = JSON.parse(fallbackBody);
                } catch {
                  console.error(`[publish-to-shopify] ❌ Fallback response not valid JSON`);
                  await supabase.from("products").update({ status: "error", error_message: "Invalid JSON in Shopify fallback response" }).eq("id", product.id);
                  results.push({ id: product.id, success: false, error: "Invalid JSON in Shopify fallback response", action: "create_failed" });
                  continue;
                }
                const fallbackCreated = (fallbackData as Record<string, Record<string, unknown>>).product;
                const shopifyProductId = String(fallbackCreated.id);
                const warningMsg = `Published without image (original image URL was invalid). Product is live on Shopify.`;
                console.log(`[publish-to-shopify] ✅ FALLBACK SUCCESS: "${product.title}" → Shopify ID: ${shopifyProductId}`);
                await supabase.from("products").update({ status: "success", shopify_product_id: shopifyProductId, error_message: warningMsg, source: "local" }).eq("id", product.id);

                const seoMirror = await applyProductSeoMirror(storeHost, shopifyAccessToken, shopifyProductId, product);
                const publishedHandle = (seoMirror.shopify_url as string | null) || normalizeShopifyHandle(product.handle) || String(fallbackCreated.handle || "");

                const shopifyHeaders = {
                  "Content-Type": "application/json",
                  "X-Shopify-Access-Token": shopifyAccessToken,
                };
                const orderedGallery = buildOrderedGalleryUrls(product, resolvedImageUrl);
                const fbResolvedPrimary = resolvedImageUrl || product.primary_image_src || product.image_url || null;
                let finalFallbackProduct = fallbackCreated;
                if (orderedGallery.length > 0) {
                  try {
                    await ensureGalleryImagesOnShopify(
                      shopifyApiBase,
                      shopifyHeaders,
                      shopifyProductId,
                      orderedGallery,
                      fbResolvedPrimary,
                    );
                    const fbMid = await fetchShopifyProduct(shopifyApiBase, shopifyHeaders, shopifyProductId);
                    if (fbMid) {
                      const fbMidImages = (fbMid.images as ShopifyRecord[]) || [];
                      const fbOrdered = buildOrderedShopifyImagesFromGallery(
                        fbMidImages,
                        orderedGallery,
                        fbResolvedPrimary,
                      );
                      await reorderShopifyProductImages(
                        shopifyApiBase,
                        shopifyHeaders,
                        shopifyProductId,
                        fbOrdered,
                      );
                    }
                  } catch (fbGalErr) {
                    console.warn(
                      `[publish-to-shopify] ⚠️ Fallback gallery attach failed for "${product.title}":`,
                      fbGalErr instanceof Error ? fbGalErr.message : String(fbGalErr),
                    );
                  }
                }

                const fbCdnFinalize = await finalizeCdnImageMetafieldsForProduct(
                  shopifyApiBase,
                  shopifyHeaders,
                  shopifyProductId,
                  product.title || "",
                  orderedGallery,
                  fbResolvedPrimary,
                );
                if (fbCdnFinalize.liveProduct) finalFallbackProduct = fbCdnFinalize.liveProduct;

                const fbCoreMf = product.metafields && !Array.isArray(product.metafields)
                  ? stripImageUrlMetafields(product.metafields)
                  : undefined;
                const fbCoreSync = await syncCoreMetafieldsToShopify(
                  shopifyApiBase,
                  shopifyHeaders,
                  shopifyProductId,
                  fbCoreMf,
                );
                console.log(
                  `[publish-to-shopify] 🏷️ Fallback core metafields synced for "${product.title}": ${fbCoreSync.ok} ok, ${fbCoreSync.fail} fail`,
                );

                // 寫入 shopify_products mirror（fallback：無圖上傳成功）
                try {
                  const fbSpImages = (finalFallbackProduct.images as ShopifyRecord[]) || [];
                  const fbMirrorGallery = buildMirrorGalleryFields(fbSpImages, orderedGallery);
                  const fbCreatedVariants = (finalFallbackProduct.variants as Record<string, unknown>[]) || [];
                  const fbSpPrice = fbCreatedVariants[0]?.price != null ? Number(fbCreatedVariants[0].price) : (product.price ?? 0);
                  const fbSpCompareAt = fbCreatedVariants[0]?.compare_at_price != null ? Number(fbCreatedVariants[0].compare_at_price) : null;
                  const fbMfColumns: Record<string, string> = {};
                  for (const m of shopifyMetafields) {
                    fbMfColumns[`${m.namespace}.${m.key}`] = m.value;
                  }
                  const fbMergedMf: Record<string, string | null> = { ...fbMfColumns };
                  for (const [col, val] of Object.entries(fbCdnFinalize.mfColumns)) {
                    if (val != null && String(val).trim()) fbMergedMf[col] = String(val).trim();
                    else fbMergedMf[col] = null;
                  }
                  const fbMirrorMetafields = metafieldsArrayFromColumnMap(fbMergedMf);
                  const fbSpRow: Record<string, unknown> = {
                    shopify_product_id: shopifyProductId,
                    source_product_id: product.id,
                    title: (finalFallbackProduct.title as string) || product.title || null,
                    body_html: (finalFallbackProduct.body_html as string) || product.description_html || null,
                    vendor: (finalFallbackProduct.vendor as string) || product.vendor || product.factory_name || null,
                    product_type: (finalFallbackProduct.product_type as string) || product.product_type || null,
                    handle: publishedHandle,
                    status: "active",
                    published_at: new Date().toISOString(),
                    image_url: fbMirrorGallery.image_url,
                    images: fbMirrorGallery.images,
                    variants: fbCreatedVariants.length > 0 ? fbCreatedVariants : null,
                    tags: Array.isArray(product.tags) ? product.tags : [],
                    price: fbSpPrice,
                    compare_at_price: fbSpCompareAt,
                    shopify_created_at: String(fallbackCreated.created_at || new Date().toISOString()),
                    shopify_updated_at: String(fallbackCreated.updated_at || new Date().toISOString()),
                    imported_at: new Date().toISOString(),
                    shop_domain: storeHost,
                    metafields: fbMirrorMetafields.length > 0 ? fbMirrorMetafields : null,
                    ...Object.fromEntries(
                      Object.entries(fbMergedMf).filter(([, v]) => v != null && String(v).trim()),
                    ),
                    ...seoMirror,
                  };
                  if (product.rts_id) fbSpRow.id = product.rts_id;
                  await supabase.from("shopify_products").upsert(fbSpRow, { onConflict: "shopify_product_id" });
                } catch (fbSpErr) {
                  console.warn(`[publish-to-shopify] ⚠️ shopify_products mirror write failed (fallback, non-blocking):`, fbSpErr instanceof Error ? fbSpErr.message : String(fbSpErr));
                }

                try {
                  await exitPublishPipeline(supabase, product.id);
                } catch (pipeErr) {
                  console.warn(`[publish-to-shopify] ⚠️ pipeline cleanup failed (fallback):`, pipeErr instanceof Error ? pipeErr.message : String(pipeErr));
                }

                results.push({ id: product.id, success: true, shopify_product_id: shopifyProductId, action: "created_without_image", image_warning: warningMsg });
                continue;
              } else {
                console.error(`[publish-to-shopify] ❌ Fallback also failed (HTTP ${fallbackResponse.status}): ${fallbackBody.substring(0, 300)}`);
              }
            } catch (fallbackFetchErr) {
              console.error(`[publish-to-shopify] ❌ Fallback fetch error:`, fallbackFetchErr instanceof Error ? fallbackFetchErr.message : String(fallbackFetchErr));
            }
          }

          let errMsg: string;
          try {
            const errorJson = JSON.parse(rawResponseBody);
            errMsg = JSON.stringify(errorJson.errors || errorJson);
          } catch {
            errMsg = rawResponseBody.substring(0, 500);
          }
          await supabase.from("products").update({ status: "error", error_message: `Shopify API (${shopifyResponse.status}): ${errMsg}` }).eq("id", product.id);
          results.push({ id: product.id, success: false, error: `Shopify API (${shopifyResponse.status}): ${errMsg}`, action: "create_failed", image_warning: imageWarning });
          continue;
        }

        // ── Parse successful response ────────────────────────────────────
        let shopifyData: Record<string, unknown>;
        try {
          shopifyData = JSON.parse(rawResponseBody);
        } catch {
          console.error(`[publish-to-shopify] ❌ Failed to parse success response as JSON:`, rawResponseBody.substring(0, 500));
          await supabase.from("products").update({ status: "error", error_message: `Invalid JSON in Shopify 200 response` }).eq("id", product.id);
          results.push({ id: product.id, success: false, error: "Invalid JSON in Shopify 200 response", action: "create_failed" });
          continue;
        }

        const createdProduct = (shopifyData as Record<string, Record<string, unknown>>).product;
        const shopifyProductId = String(createdProduct.id);
        const shopifyHeaders = {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyAccessToken,
        };

        // ── Post-create: attach per-variant images + sync more_image metafields (Shopify CDN) ──
        const orderedGallery = buildOrderedGalleryUrls(product, resolvedImageUrl);
        const variantImageSpecs = productVariants
          .filter((v) => isHttpUrl((v as { image_src?: string }).image_src))
          .map((v) => ({
            sku: String((v.sku && String(v.sku).trim()) || product.sku || ""),
            image_src: (v as { image_src?: string }).image_src,
          }));

        let finalProduct = createdProduct;
        const resolvedPrimary = resolvedImageUrl || product.primary_image_src || product.image_url || null;
        if (orderedGallery.length > 0 || variantImageSpecs.length > 0) {
          try {
            await ensureGalleryImagesOnShopify(
              shopifyApiBase,
              shopifyHeaders,
              shopifyProductId,
              orderedGallery,
              resolvedPrimary,
            );
            if (variantImageSpecs.length > 0) {
              await attachVariantImagesBySku(
                shopifyApiBase,
                shopifyHeaders,
                shopifyProductId,
                variantImageSpecs,
                resolvedPrimary || orderedGallery[0] || null,
              );
            }
            if (orderedGallery.length > 0) {
              const midProduct = await fetchShopifyProduct(shopifyApiBase, shopifyHeaders, shopifyProductId);
              if (midProduct) {
                const postGalleryImages = (midProduct.images as ShopifyRecord[]) || [];
                const orderedForReorder = buildOrderedShopifyImagesFromGallery(
                  postGalleryImages,
                  orderedGallery,
                  resolvedPrimary,
                );
                await reorderShopifyProductImages(
                  shopifyApiBase,
                  shopifyHeaders,
                  shopifyProductId,
                  orderedForReorder,
                );
              }
            }
          } catch (postImgErr) {
            console.warn(
              `[publish-to-shopify] ⚠️ Post-create gallery/variant image step failed for "${product.title}":`,
              postImgErr instanceof Error ? postImgErr.message : String(postImgErr),
            );
          }
        }

        const cdnFinalize = await finalizeCdnImageMetafieldsForProduct(
          shopifyApiBase,
          shopifyHeaders,
          shopifyProductId,
          product.title || "",
          orderedGallery,
          resolvedPrimary,
        );
        if (cdnFinalize.liveProduct) finalProduct = cdnFinalize.liveProduct;

        const coreMf = product.metafields && !Array.isArray(product.metafields)
          ? stripImageUrlMetafields(product.metafields)
          : undefined;
        const coreSync = await syncCoreMetafieldsToShopify(
          shopifyApiBase,
          shopifyHeaders,
          shopifyProductId,
          coreMf,
        );
        console.log(
          `[publish-to-shopify] 🏷️ Core metafields synced for "${product.title}": ${coreSync.ok} ok, ${coreSync.fail} fail`,
        );

        const shopifyVariants = (finalProduct.variants as Record<string, unknown>[]) || [];
        const shopifyFirstVariant = shopifyVariants[0] || {};
        const shopifyReturnedPrice = shopifyFirstVariant.price ? Number(shopifyFirstVariant.price) : product.price;
        const shopifyReturnedCompareAt = shopifyFirstVariant.compare_at_price ? Number(shopifyFirstVariant.compare_at_price) : (product.compare_at_price || null);

        console.log(`[publish-to-shopify] ✅ SUCCESS: "${product.title}" → Shopify ID: ${shopifyProductId}`);
        await supabase.from("products").update({ status: "success", shopify_product_id: shopifyProductId, error_message: imageWarning || null, source: "local" }).eq("id", product.id);

        const seoMirror = await applyProductSeoMirror(storeHost, shopifyAccessToken, shopifyProductId, product);
        const publishedHandle = (seoMirror.shopify_url as string | null) || normalizeShopifyHandle(product.handle) || String(createdProduct.handle || "");

        // ── Write to shopify_products mirror table ────────────────────────
        try {
          const spImages = (finalProduct.images as ShopifyRecord[]) || [];
          const mirrorGallery = buildMirrorGalleryFields(spImages, orderedGallery);
          const spVariants = (finalProduct.variants as Record<string, unknown>[]) || [];
          const spPrice = spVariants[0]?.price != null ? Number(spVariants[0].price) : (product.price ?? 0);
          const spCompareAt = spVariants[0]?.compare_at_price != null ? Number(spVariants[0].compare_at_price) : null;
          const mfColumns: Record<string, string> = {};
          for (const m of shopifyMetafields) {
            mfColumns[`${m.namespace}.${m.key}`] = m.value;
          }
          const mergedMfColumns: Record<string, string | null> = { ...mfColumns };
          for (const [col, val] of Object.entries(cdnFinalize.mfColumns)) {
            if (val != null && String(val).trim()) mergedMfColumns[col] = String(val).trim();
            else mergedMfColumns[col] = null;
          }
          const mirrorMetafields = metafieldsArrayFromColumnMap(mergedMfColumns);
          const parentSku = (product.sku && String(product.sku).trim()) || "";
          const spRow: Record<string, unknown> = {
            shopify_product_id: shopifyProductId,
            // 連結回 products 表（products.id），讓產品目錄可判斷是否已上傳 Shopify
            source_product_id: product.id,
            title: (finalProduct.title as string) || product.title || null,
            body_html: (finalProduct.body_html as string) || product.description_html || null,
            vendor: (finalProduct.vendor as string) || product.vendor || product.factory_name || null,
            product_type: (finalProduct.product_type as string) || product.product_type || null,
            handle: publishedHandle,
            status: "active",
            published_at: new Date().toISOString(),
            image_url: mirrorGallery.image_url,
            images: mirrorGallery.images,
            variants: spVariants.length > 0 ? spVariants : null,
            tags: Array.isArray(product.tags) ? product.tags : [],
            price: spPrice,
            compare_at_price: spCompareAt,
            configurable: null,
            sku: parentSku || null,
            shopify_created_at: String(finalProduct.created_at || new Date().toISOString()),
            shopify_updated_at: String(finalProduct.updated_at || new Date().toISOString()),
            imported_at: new Date().toISOString(),
            shop_domain: storeHost,
            metafields: mirrorMetafields.length > 0 ? mirrorMetafields : null,
            ...Object.fromEntries(
              Object.entries(mergedMfColumns).filter(([, v]) => v != null && String(v).trim()),
            ),
            ...seoMirror,
          };
          // id = ready_to_shopify row uuid (1:1 trace), when provided
          if (product.rts_id) spRow.id = product.rts_id;
          await supabase.from("shopify_products").upsert(spRow, { onConflict: "shopify_product_id" });
          console.log(`[publish-to-shopify] ✅ shopify_products mirror written for Shopify ID: ${shopifyProductId}`);

          if (parentSku) {
            const childRtsIds = productVariants
              .map((v) => String((v as { id?: string }).id ?? ""))
              .filter((id) => id && id !== product.rts_id);
            await mirrorMergedRtsChildren(supabase, shopifyProductId, parentSku, storeHost, childRtsIds);
          }
        } catch (spErr) {
          console.warn(`[publish-to-shopify] ⚠️ shopify_products mirror write failed (non-blocking):`, spErr instanceof Error ? spErr.message : String(spErr));
        }

        try {
          await exitPublishPipeline(supabase, product.id);
        } catch (pipeErr) {
          console.warn(`[publish-to-shopify] ⚠️ pipeline cleanup failed:`, pipeErr instanceof Error ? pipeErr.message : String(pipeErr));
        }

        results.push({ id: product.id, success: true, shopify_product_id: shopifyProductId, action: "created", image_warning: imageWarning });

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[publish-to-shopify] 💥 Unexpected error processing "${product.title}":`, errMsg);
        if (err instanceof Error && err.stack) console.error(`[publish-to-shopify] Stack trace:`, err.stack);
        await supabase.from("products").update({ status: "error", error_message: `Publish error: ${errMsg}` }).eq("id", product.id);
        results.push({ id: product.id, success: false, error: errMsg, action: "create_failed" });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;
    const skippedCount = results.filter((r) => r.action === "skipped_already_exists").length;
    const createdCount = results.filter((r) => r.action === "created").length;
    const createdWithoutImageCount = results.filter((r) => r.action === "created_without_image").length;

    console.log(`[publish-to-shopify] Done. ${createdCount} created, ${createdWithoutImageCount} created without image, ${skippedCount} skipped, ${errorCount} failed.`);

    return new Response(
      JSON.stringify({
        success: errorCount === 0,
        results,
        summary: { total: products.length, created: createdCount, created_without_image: createdWithoutImageCount, skipped: skippedCount, errors: errorCount, success: successCount },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    console.error("[publish-to-shopify] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});

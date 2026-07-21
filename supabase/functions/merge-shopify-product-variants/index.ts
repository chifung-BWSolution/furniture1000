import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type VariantSpec = {
  size: string;
  price: number | string;
  sku: string;
  /** Mirror / Shopify product id this variant came from */
  shopify_product_id: string;
  /** Existing Shopify variant id when updating the parent row */
  variant_id?: number | string;
  /** Optional image URL assigned in UI (overrides auto-collected source image) */
  image_src?: string;
};

type MergeBody = {
  parent_shopify_product_id: string;
  parent_sku: string;
  variants: VariantSpec[];
  /** First gallery thumbnail — stored as shopify_products.image_url */
  primary_image_src?: string;
  /** Full gallery order from merge UI (used to order mirror images[]) */
  gallery_urls?: string[];
};

type ShopifyRecord = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function isHttpUrl(src: unknown): src is string {
  return typeof src === "string" && /^https?:\/\//.test(src);
}

async function fetchShopifyProduct(
  apiBase: string,
  headers: Record<string, string>,
  productId: string,
): Promise<ShopifyRecord | null> {
  const r = await fetch(`${apiBase}/products/${productId}.json`, { headers });
  if (!r.ok) return null;
  return (await r.json()).product as ShopifyRecord;
}

/** Primary image URL for a standalone product or a specific variant row. */
function resolveProductImageSrc(product: ShopifyRecord, variantId?: number | string): string | null {
  const images = (product.images as ShopifyRecord[]) || [];
  const variants = (product.variants as ShopifyRecord[]) || [];
  const vid = variantId != null ? String(variantId) : "";

  if (vid) {
    const variant = variants.find((v) => String(v.id) === vid);
    const imageId = variant?.image_id;
    if (imageId != null) {
      const linked = images.find((im) => String(im.id) === String(imageId));
      if (isHttpUrl(linked?.src)) return linked.src;
    }
    const byVariantIds = images.find(
      (im) => Array.isArray(im.variant_ids) && (im.variant_ids as unknown[]).some((id) => String(id) === vid),
    );
    if (isHttpUrl(byVariantIds?.src)) return byVariantIds.src;
  }

  if (images.length > 0 && isHttpUrl(images[0].src)) return images[0].src as string;
  const legacy = product.image as ShopifyRecord | undefined;
  if (isHttpUrl(legacy?.src)) return legacy.src as string;
  return null;
}

/** Collect each merge spec's source image before child products are deleted. */
async function collectSpecImageSources(
  apiBase: string,
  headers: Record<string, string>,
  parentId: string,
  parentProduct: ShopifyRecord,
  specs: VariantSpec[],
  existingVariants: ShopifyRecord[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const spec of specs) {
    const pid = String(spec.shopify_product_id);
    const product = pid === parentId
      ? parentProduct
      : await fetchShopifyProduct(apiBase, headers, pid);
    if (!product) continue;
    const variants = (product.variants as ShopifyRecord[]) || [];
    const vid = spec.variant_id
      ?? (pid === parentId ? existingVariants[0]?.id : variants.find((v) => String(v.sku) === spec.sku)?.id ?? variants[0]?.id);
    const src = resolveProductImageSrc(product, vid as number | string | undefined);
    if (src) out.set(spec.sku, src);
  }
  return out;
}

function normalizeImageUrl(src: string): string {
  try {
    const u = new URL(src);
    return `${u.origin}${u.pathname}`;
  } catch {
    return src.split("?")[0] ?? src;
  }
}

function imageDedupeKey(src: string): string {
  const stem = imageIdentityKey(src);
  if (stem) return stem;
  return normalizeImageUrl(src).replace(
    /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[a-z0-9]+$)/i,
    "",
  );
}

/** Filename stem — Storage vs Shopify CDN; strip _1/_12 suffix on CDN only. */
function imageIdentityKey(url: string): string {
  if (!url || typeof url !== "string") return "";
  const noQuery = url.split("?")[0];
  const base = noQuery.substring(noQuery.lastIndexOf("/") + 1);
  let stem = base
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(
      /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "",
    )
    .trim()
    .toLowerCase();
  if (/cdn\.shopify\.com/i.test(url)) {
    stem = stem.replace(/_\d{1,2}$/, "");
  }
  return stem;
}

function dedupeGalleryUrls(urls: string[], primarySrc: string | null): string[] {
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

function collectProductImages(product: ShopifyRecord): ShopifyRecord[] {
  const images = [...((product.images as ShopifyRecord[]) || [])];
  const legacy = product.image as ShopifyRecord | undefined;
  if (legacy?.src && isHttpUrl(legacy.src)) {
    const legacyKey = imageDedupeKey(legacy.src as string);
    const hasLegacy = images.some(
      (im) => isHttpUrl(im.src) && imageDedupeKey(im.src as string) === legacyKey,
    );
    if (!hasLegacy) images.unshift(legacy);
  }
  return images;
}

function findExistingProductImage(
  images: ShopifyRecord[],
  src: string,
): ShopifyRecord | undefined {
  return indexShopifyImagesByDedupe(images).get(imageDedupeKey(src));
}

/** When variant reuses Shopify primary, always resolve to the primary URL for lookup. */
function resolveAttachImageSrc(src: string, primarySrc: string | null): string {
  if (primarySrc && imageDedupeKey(src) === imageDedupeKey(primarySrc)) {
    return primarySrc;
  }
  return src;
}

async function setVariantImageId(
  apiBase: string,
  headers: Record<string, string>,
  parentId: string,
  variantId: number,
  imageId: number,
): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch(`${apiBase}/products/${parentId}/variants/${variantId}.json`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ variant: { id: variantId, image_id: imageId } }),
  });
  if (resp.ok) return { ok: true };
  return { ok: false, error: (await resp.text()).slice(0, 200) };
}

/** Attach collected images to merged variants on the parent product. */
async function attachVariantImages(
  apiBase: string,
  headers: Record<string, string>,
  parentId: string,
  specs: VariantSpec[],
  imageSrcBySku: Map<string, string>,
  primarySrc: string | null,
): Promise<{ attached: { sku: string; image_id: number; src: string }[]; failed: { sku: string; error: string }[] }> {
  const attached: { sku: string; image_id: number; src: string }[] = [];
  const failed: { sku: string; error: string }[] = [];

  const product = await fetchShopifyProduct(apiBase, headers, parentId);
  if (!product) return { attached, failed };

  let images = collectProductImages(product);
  const variants = (product.variants as ShopifyRecord[]) || [];

  for (const spec of specs) {
    const rawSrc = imageSrcBySku.get(spec.sku);
    if (!isHttpUrl(rawSrc)) continue;
    const src = resolveAttachImageSrc(rawSrc, primarySrc);

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
      if (!postResp.ok) {
        failed.push({ sku: spec.sku, error: (await postResp.text()).slice(0, 200) });
        continue;
      }
      const newImg = (await postResp.json()).image as ShopifyRecord;
      if (newImg?.id == null) {
        failed.push({ sku: spec.sku, error: "Image POST returned no id" });
        continue;
      }
      target = newImg;
      images.push(newImg);
    }

    const imageId = Number(target.id);
    const currentImageId = variant.image_id != null ? Number(variant.image_id) : null;
    if (currentImageId === imageId) {
      attached.push({ sku: spec.sku, image_id: imageId, src: String(target.src ?? src) });
      continue;
    }

    const setResult = await setVariantImageId(apiBase, headers, parentId, variantId, imageId);
    if (!setResult.ok) {
      failed.push({ sku: spec.sku, error: setResult.error ?? "variant image_id PUT failed" });
      continue;
    }
    attached.push({ sku: spec.sku, image_id: imageId, src: String(target.src ?? src) });
  }

  return { attached, failed };
}

function mapProductImages(images: ShopifyRecord[]) {
  return images.length > 0
    ? images.map((im) => ({
      id: im.id,
      src: im.src,
      alt: im.alt || "",
      width: im.width,
      height: im.height,
      position: im.position,
      variant_ids: im.variant_ids,
    }))
    : null;
}

function imageNormKey(src: string): string {
  return imageDedupeKey(src);
}

/** PUT explicit positions so Shopify featured image matches merge UI gallery order. */
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
      "[merge-shopify-product-variants] gallery reorder failed:",
      (await resp.text()).slice(0, 200),
    );
    return false;
  }
  return true;
}

/** POST gallery URLs that are not yet attached to the merged parent product. */
async function ensureGalleryImagesOnShopify(
  apiBase: string,
  headers: Record<string, string>,
  parentId: string,
  galleryUrls: string[],
  primarySrc: string | null,
): Promise<ShopifyRecord[]> {
  const product = await fetchShopifyProduct(apiBase, headers, parentId);
  if (!product) return [];

  let images = collectProductImages(product);
  const byDedupe = indexShopifyImagesByDedupe(images);

  const uniqueGallery = dedupeGalleryUrls(galleryUrls, primarySrc);
  const toUpload: string[] = [];
  for (const src of uniqueGallery) {
    if (!byDedupe.has(imageDedupeKey(src))) toUpload.push(src);
  }

  for (const src of toUpload) {
    const postResp = await fetch(`${apiBase}/products/${parentId}/images.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ image: { src } }),
    });
    if (!postResp.ok) {
      console.warn(
        "[merge-shopify-product-variants] gallery POST failed:",
        (await postResp.text()).slice(0, 120),
      );
      continue;
    }
    const newImg = (await postResp.json()).image as ShopifyRecord;
    if (newImg?.id != null) {
      images.push(newImg);
      const key = isHttpUrl(newImg.src) ? imageDedupeKey(newImg.src as string) : imageDedupeKey(src);
      const prev = byDedupe.get(key);
      if (!prev || String(newImg.src).length < String(prev.src).length) {
        byDedupe.set(key, newImg);
      }
    }
  }

  return images;
}

/** Mirror images[] = unique gallery order; fall back to live Shopify when UI gallery empty. */
function buildMirrorImagesFromGallery(
  shopifyImages: ShopifyRecord[],
  galleryUrls: string[],
  primarySrc: string | null,
): ShopifyRecord[] {
  const byDedupe = indexShopifyImagesByDedupe(shopifyImages);
  const uniqueGallery = dedupeGalleryUrls(galleryUrls, primarySrc);
  const ordered: ShopifyRecord[] = [];

  for (const src of uniqueGallery) {
    const im = byDedupe.get(imageDedupeKey(src));
    ordered.push(
      im
        ? { ...im, src: (im.src as string) || src }
        : { src, alt: "", position: ordered.length + 1 },
    );
  }

  if (ordered.length === 0) {
    const live = [...shopifyImages]
      .filter((im) => isHttpUrl(im.src as string))
      .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99));
    const seen = new Set<string>();
    for (const im of live) {
      const key = imageDedupeKey(String(im.src));
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(im);
    }
  }

  return ordered.map((im, i) => ({ ...im, position: i + 1 }));
}

/** Point variant image_id at canonical gallery image (same dedupe key → one Shopify image). */
function normalizeVariantImageIds(
  variants: ShopifyRecord[],
  orderedImages: ShopifyRecord[],
): ShopifyRecord[] {
  const byDedupe = indexShopifyImagesByDedupe(orderedImages);
  const idToDedupe = new Map<string, string>();
  for (const im of orderedImages) {
    if (im.id != null && isHttpUrl(im.src)) {
      idToDedupe.set(String(im.id), imageDedupeKey(im.src as string));
    }
  }
  return variants.map((v) => {
    if (v.image_id == null) return v;
    const dedupe = idToDedupe.get(String(v.image_id));
    if (!dedupe) return v;
    const canonical = byDedupe.get(dedupe);
    if (canonical?.id != null && Number(canonical.id) !== Number(v.image_id)) {
      return { ...v, image_id: canonical.id };
    }
    return v;
  });
}

function resolvePrimaryImageSrc(
  orderedImages: ShopifyRecord[],
  primaryFromUi: string | null,
): string | null {
  if (primaryFromUi) {
    const norm = imageDedupeKey(primaryFromUi);
    const match = orderedImages.find(
      (im) => isHttpUrl(im.src) && imageDedupeKey(im.src as string) === norm,
    );
    if (match && isHttpUrl(match.src)) return match.src as string;
    return primaryFromUi;
  }
  return isHttpUrl(orderedImages[0]?.src) ? (orderedImages[0].src as string) : null;
}

function mapProductOptions(options: ShopifyRecord[] | undefined) {
  if (!options?.length) return [{ name: "尺寸(mm)" }];
  return options.map((o) => ({
    id: o.id,
    name: o.name,
    position: o.position,
    product_id: o.product_id,
    values: o.values,
  }));
}

const MORE_IMAGE_MF_TYPES: Record<string, string> = {
  "custom.more_image_link_1": "url",
  "custom.more_image_alt_1": "multi_line_text_field",
  "custom.more_image_link_2": "url",
  "custom.more_image_alt_2": "multi_line_text_field",
  "custom.more_image_link_3": "url",
  "custom.more_image_alt_3": "multi_line_text_field",
  "custom.more_image_link_4": "url",
  "custom.more_image_alt_4": "multi_line_text_field",
};

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
  const type = MORE_IMAGE_MF_TYPES[col] || "single_line_text_field";
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
  for (const col of Object.keys(MORE_IMAGE_MF_TYPES)) {
    await upsertProductMetafield(apiBase, headers, shopifyId, col, cols[col] ?? "");
  }
}

/** Same-SKU rows → base SKU on lowest price; others get -1, -2, … suffixes. */
function assignUniqueMergeSkus(specs: VariantSpec[], parentSku: string): VariantSpec[] {
  const next = specs.map((s) => ({ ...s, sku: String(s.sku || "").trim() || parentSku }));
  const groups = new Map<string, number[]>();
  next.forEach((spec, idx) => {
    const sku = spec.sku.trim();
    if (!sku) return;
    const list = groups.get(sku) ?? [];
    list.push(idx);
    groups.set(sku, list);
  });
  for (const [baseSku, indices] of groups) {
    if (indices.length <= 1) continue;
    const sorted = [...indices].sort((a, b) => {
      const pa = Number(next[a].price);
      const pb = Number(next[b].price);
      const priceDiff = (Number.isFinite(pa) ? pa : 0) - (Number.isFinite(pb) ? pb : 0);
      if (priceDiff !== 0) return priceDiff;
      return String(next[a].size).localeCompare(String(next[b].size), "zh-Hant");
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

    const body = await req.json().catch(() => ({})) as MergeBody;
    const parentId = String(body.parent_shopify_product_id || "").trim();
    const parentSku = String(body.parent_sku || "").trim();
    let specs = Array.isArray(body.variants) ? body.variants : [];

    if (!/^\d+$/.test(parentId) || !parentSku || specs.length < 2) {
      return json({ error: "parent_shopify_product_id, parent_sku, and variants (>=2) are required" }, 400);
    }

    specs = assignUniqueMergeSkus(
      specs.map((s) => ({
        ...s,
        shopify_product_id: String(s.shopify_product_id || "").trim(),
        size: String(s.size || "").trim(),
        sku: String(s.sku || "").trim() || parentSku,
      })),
      parentSku,
    );

    for (const spec of specs) {
      if (!spec.size || !spec.sku || !/^\d+$/.test(spec.shopify_product_id)) {
        return json({ error: "Each variant needs size, sku, and shopify_product_id" }, 400);
      }
    }

    const apiBase = `https://${shopDomain}/admin/api/2024-10`;
    const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken };

    const existing = await fetchShopifyProduct(apiBase, headers, parentId);
    if (!existing) return json({ error: `Shopify GET parent failed for ${parentId}` }, 502);
    const existingVariants = (existing.variants as ShopifyRecord[]) || [];

    // Capture child/parent image URLs before deleting standalone listings.
    const imageSrcBySku = await collectSpecImageSources(
      apiBase, headers, parentId, existing, specs, existingVariants,
    );
    for (const spec of specs) {
      if (isHttpUrl(spec.image_src)) {
        imageSrcBySku.set(spec.sku, spec.image_src);
      }
    }

    const shopifyVariants = specs.map((spec, index) => {
      const price = Number(spec.price);
      const row: Record<string, unknown> = {
        option1: spec.size,
        price: Number.isFinite(price) ? price.toFixed(2) : "0.00",
        sku: spec.sku,
        inventory_management: "shopify",
        inventory_quantity: 1000,
        requires_shipping: true,
      };
      const isParentRow = String(spec.shopify_product_id) === parentId;
      const vid = isParentRow
        ? (spec.variant_id ?? (index === 0 ? existingVariants[0]?.id : undefined))
        : undefined;
      if (vid != null) row.id = Number(vid);
      return row;
    });

    const childProductIds = [...new Set(
      specs
        .map((s) => String(s.shopify_product_id))
        .filter((id) => id !== parentId && /^\d+$/.test(id)),
    )];

    // Archive child listings first so Shopify SKU conflicts are less likely during variant PUT.
    const archivedOnShopify: string[] = [];
    const archiveErrors: { shopify_product_id: string; error: string }[] = [];
    for (const childId of childProductIds) {
      const archResp = await fetch(`${apiBase}/products/${childId}.json`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ product: { id: Number(childId), status: "archived" } }),
      });
      if (archResp.ok) {
        archivedOnShopify.push(childId);
      } else {
        const t = await archResp.text();
        archiveErrors.push({ shopify_product_id: childId, error: t.slice(0, 200) });
      }
    }

    const putResp = await fetch(`${apiBase}/products/${parentId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        product: {
          id: Number(parentId),
          options: [{ name: "尺寸(mm)" }],
          variants: shopifyVariants,
        },
      }),
    });
    if (!putResp.ok) {
      const t = await putResp.text();
      return json({ error: `Shopify PUT parent failed (${putResp.status}): ${t.slice(0, 300)}` }, 502);
    }

    const galleryUrlsRaw = Array.isArray(body.gallery_urls)
      ? body.gallery_urls.filter(isHttpUrl)
      : [];
    const primaryFromUi = isHttpUrl(body.primary_image_src) ? body.primary_image_src : null;
    const galleryUrls = dedupeGalleryUrls(galleryUrlsRaw, primaryFromUi);

    await ensureGalleryImagesOnShopify(
      apiBase, headers, parentId, galleryUrls, primaryFromUi,
    );

    const { attached: imagesAttached, failed: imagesFailed } = await attachVariantImages(
      apiBase, headers, parentId, specs, imageSrcBySku, primaryFromUi,
    );

    // Reorder live Shopify gallery so position 1 = merge UI primary (variant image_id
    // assignment alone does not guarantee the storefront featured image stays correct).
    const midProduct = await fetchShopifyProduct(apiBase, headers, parentId);
    if (midProduct && galleryUrls.length > 0) {
      const midImages = collectProductImages(midProduct);
      const orderedForReorder = buildMirrorImagesFromGallery(midImages, galleryUrls, primaryFromUi);
      await reorderShopifyProductImages(apiBase, headers, parentId, orderedForReorder);
    }

    const finalProduct = await fetchShopifyProduct(apiBase, headers, parentId);
    if (!finalProduct) return json({ error: "Shopify GET parent after merge failed" }, 502);

    const shopifyImages = collectProductImages(finalProduct);
    const orderedImages = buildMirrorImagesFromGallery(shopifyImages, galleryUrls, primaryFromUi);
    const mergedVariants = normalizeVariantImageIds(
      (finalProduct.variants as ShopifyRecord[]) || [],
      orderedImages,
    );
    const primaryImageSrc = resolvePrimaryImageSrc(orderedImages, primaryFromUi);
    const prices = mergedVariants.map((v) => parseFloat(String(v.price ?? "0")) || 0);
    const minPrice = prices.length ? Math.min(...prices) : null;
    const productTitle = typeof finalProduct.title === "string" ? finalProduct.title : "";
    const cdnUrlsForMetafields = orderedImages
      .filter((im) => im.id != null && isHttpUrl(im.src))
      .map((im) => im.src as string);
    const moreImageCols = moreImageLinkColumnsFromUrls(cdnUrlsForMetafields.slice(0, 4), productTitle);

    await syncMoreImageMetafieldsToShopify(
      apiBase, headers, parentId, cdnUrlsForMetafields.slice(0, 4), productTitle,
    );

    await supabase
      .from("shopify_products")
      .update({
        variants: mergedVariants,
        options: mapProductOptions(finalProduct.options as ShopifyRecord[] | undefined),
        sku: parentSku,
        price: minPrice,
        configurable: null,
        image_url: primaryImageSrc,
        images: mapProductImages(orderedImages),
        shopify_updated_at: String(finalProduct.updated_at || new Date().toISOString()),
        ...moreImageCols,
      })
      .eq("shopify_product_id", parentId);

    for (const childId of childProductIds) {
      const childSpec = specs.find((s) => String(s.shopify_product_id) === childId);
      await supabase
        .from("shopify_products")
        .update({
          configurable: parentSku,
          status: "archived",
          sku: childSpec?.sku ?? null,
        })
        .eq("shopify_product_id", childId);
    }

    return json({
      success: true,
      parent_shopify_product_id: parentId,
      parent_sku: parentSku,
      variant_count: mergedVariants.length,
      archived_on_shopify: archivedOnShopify,
      archive_errors: archiveErrors,
      /** @deprecated use archived_on_shopify */
      deleted_on_shopify: archivedOnShopify,
      images_attached: imagesAttached,
      images_failed: imagesFailed,
      variants: mergedVariants.map((v) => ({
        id: v.id,
        sku: v.sku,
        option1: v.option1,
        price: v.price,
        image_id: v.image_id ?? null,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[merge-shopify-product-variants]", msg);
    return json({ error: msg }, 500);
  }
});

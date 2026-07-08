import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function imageDedupeKey(src: string): string {
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

  const resp = await fetch(`${apiBase}/products/${shopifyId}.json`, {
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

  let product = (await fetch(`${apiBase}/products/${shopifyId}.json`, { headers })
    .then((r) => r.json())).product as Record<string, unknown>;
  let liveImages = [...((product.images as Record<string, unknown>[]) || [])];
  let canonicalByKey = indexLiveImagesByDedupe(liveImages, primarySrc);

  for (const im of dedupedMirror) {
    const src = resolveAttachImageSrc(String(im.src), primarySrc);
    const key = imageDedupeKey(src);
    if (canonicalByKey.has(key)) continue;
    const postResp = await fetch(`${apiBase}/products/${shopifyId}/images.json`, {
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

  product = (await fetch(`${apiBase}/products/${shopifyId}.json`, { headers })
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
      const delResp = await fetch(
        `${apiBase}/products/${shopifyId}/images/${id}.json`,
        { method: "DELETE", headers },
      );
      if (delResp.ok) deleted++;
    }
  }

  product = (await fetch(`${apiBase}/products/${shopifyId}.json`, { headers })
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
  const spUpdate: Record<string, unknown> = {
    shopify_updated_at: String(liveProduct.updated_at || new Date().toISOString()),
    variants: liveProduct.variants ?? null,
    images: keptImages.length > 0 ? mapLiveImagesForMirror(keptImages) : null,
    image_url: resolvedPrimary,
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
      const postResp = await fetch(`${apiBase}/products/${shopifyId}/images.json`, {
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

    const resp = await fetch(`${apiBase}/products/${shopifyId}/variants/${variantId}.json`, {
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
): Promise<{ success: boolean; error?: string; metafields_updated?: number; metafields_failed?: number }> {
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

  const getResp = await fetch(`${apiBase}/products/${shopifyId}.json`, { headers });
  if (!getResp.ok) {
    const t = await getResp.text();
    return { success: false, error: `Shopify GET failed (${getResp.status}): ${t.slice(0, 200)}` };
  }
  const existing = (await getResp.json()).product as Record<string, unknown>;
  const existingVariants = (existing.variants as Record<string, unknown>[]) || [];

  const productUpdate: Record<string, unknown> = { id: Number(shopifyId) };
  if (typeof title === "string" && title.trim()) productUpdate.title = title;
  if (typeof bodyHtml === "string") productUpdate.body_html = bodyHtml;
  if (typeof vendor === "string") productUpdate.vendor = vendor;
  if (typeof productType === "string") productUpdate.product_type = productType;
  if (tags !== undefined) {
    productUpdate.tags = Array.isArray(tags)
      ? tags.filter(Boolean).join(", ")
      : String(tags || "");
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
    (price != null && !isNaN(Number(price))) ||
    requestedVariantSkus.size > 0 ||
    requestedVariantOptions.size > 0 ||
    requestedVariantPrices.size > 0 ||
    fallbackSku !== undefined;

  if (shouldUpdateVariants) {
    productUpdate.variants = existingVariants.map((v, index) => {
      const nv: Record<string, unknown> = { id: v.id };
      const idKey = v.id != null ? String(v.id) : "";
      const indexKey = `index-${index}`;
      const variantPrice = requestedVariantPrices.get(idKey) ?? requestedVariantPrices.get(indexKey);
      if (variantPrice != null) {
        nv.price = variantPrice;
      } else if (price != null && !isNaN(Number(price))) {
        nv.price = Number(price).toFixed(2);
      }
      if (
        price != null &&
        compareAtPrice != null &&
        !isNaN(Number(compareAtPrice)) &&
        Number(compareAtPrice) > Number(price)
      ) {
        nv.compare_at_price = Number(compareAtPrice).toFixed(2);
      }
      if (requestedVariantSkus.has(idKey)) {
        nv.sku = requestedVariantSkus.get(idKey) || "";
      } else if (requestedVariantSkus.has(indexKey)) {
        nv.sku = requestedVariantSkus.get(indexKey) || "";
      } else if (fallbackSku !== undefined && existingVariants.length === 1) {
        nv.sku = fallbackSku;
      }
      if (requestedVariantOptions.has(idKey)) {
        nv.option1 = requestedVariantOptions.get(idKey) || "";
      } else if (requestedVariantOptions.has(indexKey)) {
        nv.option1 = requestedVariantOptions.get(indexKey) || "";
      }
      return nv;
    });
  }

  if (Array.isArray(images)) {
    const valid = images.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
    const mirrorHasVariantImages = Array.isArray(variants)
      && variants.some((v) => v.image_id != null);
    const liveHasVariantImages = existingVariants.length > 1
      && existingVariants.some((v) => v.image_id != null);
    // Never replace the whole images[] when variants have per-size thumbnails — that
    // invalidates mirror image_ids and breaks variant.image_id PUT on Shopify.
    if (!mirrorHasVariantImages && !liveHasVariantImages) {
      productUpdate.images = valid.map((src, i) => ({ src, position: i + 1 }));
    }
  }

  const putResp = await fetch(`${apiBase}/products/${shopifyId}.json`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ product: productUpdate }),
  });
  if (!putResp.ok) {
    const t = await putResp.text();
    return { success: false, error: `Shopify PUT failed (${putResp.status}): ${t.slice(0, 200)}` };
  }
  let updated = (await putResp.json()).product as Record<string, unknown>;
  const existingHandle = typeof existing.handle === "string" ? existing.handle.trim() : "";

  const imgsForSync: MirrorImageRef[] = (productImages?.length
    ? productImages.map((im, i) => ({ ...im, position: i + 1 }))
    : (images || []).map((src, i) => ({ src, position: i + 1 })));
  const primarySrc = typeof mirrorImageUrl === "string" && /^https?:\/\//.test(mirrorImageUrl)
    ? mirrorImageUrl
    : (imgsForSync[0]?.src && /^https?:\/\//.test(String(imgsForSync[0].src))
      ? String(imgsForSync[0].src)
      : null);
  const dedupedMirror = dedupeMirrorImages(imgsForSync, primarySrc);

  let variantImagesSynced = 0;
  let galleryImagesDeleted = 0;
  let keptGalleryImages: Record<string, unknown>[] = [];

  if (Array.isArray(variants) && dedupedMirror.length > 0) {
    const galleryResult = await syncProductGalleryCleanup(
      apiBase, headers, shopifyId, dedupedMirror, primarySrc,
    );
    keptGalleryImages = galleryResult.kept;
    galleryImagesDeleted = galleryResult.deleted;
    let refreshResp = await fetch(`${apiBase}/products/${shopifyId}.json`, { headers });
    if (refreshResp.ok) {
      updated = (await refreshResp.json()).product as Record<string, unknown>;
    }
    variantImagesSynced = await syncVariantImagesFromMirror(
      apiBase, headers, shopifyId, variants, dedupedMirror, updated, primarySrc,
    );
    if (keptGalleryImages.length > 0) {
      await reorderShopifyProductImages(apiBase, headers, shopifyId, keptGalleryImages);
    }
    refreshResp = await fetch(`${apiBase}/products/${shopifyId}.json`, { headers });
    if (refreshResp.ok) {
      updated = (await refreshResp.json()).product as Record<string, unknown>;
    }
  } else if (Array.isArray(images) && dedupedMirror.length > 0) {
    const galleryResult = await syncProductGalleryCleanup(
      apiBase, headers, shopifyId, dedupedMirror, primarySrc,
    );
    keptGalleryImages = galleryResult.kept;
    galleryImagesDeleted = galleryResult.deleted;
  }

  const normalizedHandle = normalizeShopifyHandle(handle) || undefined;
  let handleForSeo: string | undefined = normalizedHandle;
  if (normalizedHandle && normalizedHandle !== existingHandle) {
    const usedByOther = await mirrorHandleUsedByOther(supabase, normalizedHandle, shopifyId);
    if (usedByOther) {
      console.warn(
        `[update-shopify-product] Skip duplicate handle "${normalizedHandle}" for product ${shopifyId} — keeping Shopify handle "${existingHandle}"`,
      );
      handleForSeo = undefined;
    }
  } else if (normalizedHandle && normalizedHandle === existingHandle) {
    handleForSeo = undefined;
  }

  const seoResult = await updateSeoAndHandle(shopDomain, shopifyToken, shopifyId, {
    handle: handleForSeo,
    seoTitle: typeof seoTitle === "string" ? seoTitle : undefined,
    seoDescription: typeof seoDescription === "string" ? seoDescription : undefined,
  });
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

  const mfs = buildMetafields(metafields);
  let mfOk = 0, mfFail = 0;
  for (const mf of mfs) {
    try {
      const r = await fetch(`${apiBase}/products/${shopifyId}/metafields.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ metafield: { namespace: mf.namespace, key: mf.key, type: mf.type, value: mf.value } }),
      });
      if (r.ok) mfOk++;
      else {
        const existingMf = await fetch(
          `${apiBase}/products/${shopifyId}/metafields.json?namespace=${mf.namespace}&key=${mf.key}`,
          { headers },
        ).then((x) => x.ok ? x.json() : { metafields: [] }).catch(() => ({ metafields: [] }));
        const mid = existingMf?.metafields?.[0]?.id;
        if (mid) {
          const pr = await fetch(`${apiBase}/metafields/${mid}.json`, {
            method: "PUT", headers,
            body: JSON.stringify({ metafield: { id: mid, type: mf.type, value: mf.value } }),
          });
          if (pr.ok) mfOk++; else mfFail++;
        } else mfFail++;
      }
    } catch { mfFail++; }
  }

  if (!opts?.skipMirrorWrite) {
    const mfColumns: Record<string, string> = {};
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
    live_handle: liveHandle,
    metafields_updated: mfOk,
    metafields_failed: mfFail,
    variant_images_synced: variantImagesSynced,
    gallery_images_deleted: galleryImagesDeleted,
    ...(sourceProductId ? {} : {}),
  };
}

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
  for (const row of rows) {
    const sid = String(row.shopify_product_id || "");
    if (!/^\d+$/.test(sid)) {
      skipped++;
      continue;
    }
    const payload = mirrorRowToPayload(row);
    const result = await pushProductToShopify(supabase, shopDomain, shopifyToken, sid, payload, { skipMirrorWrite: true });
    if (result.success) {
      pushed++;
    } else {
      failed++;
      if (errors.length < 20) errors.push({ shopify_product_id: sid, error: result.error || "unknown" });
    }
  }
  return { pushed, failed, skipped, errors };
}

/**
 * update-shopify-product
 *
 * Single product push: POST { shopify_product_id, title?, body_html?, ... }
 * Push one mirror row: POST { push_from_mirror: true, shopify_product_id }
 * Push selected mirror rows: POST { shopify_product_ids: string[] }
 * Batch push all mirror rows: POST { push_all_from_mirror: true }
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

    if (body.push_all_from_mirror) {
      const { data: rows, error: fetchErr } = await supabase.from("shopify_products").select("*");
      if (fetchErr) return json({ error: fetchErr.message }, 500);
      const stats = await pushMirrorRows(supabase, shopDomain, shopifyToken, (rows || []) as Record<string, unknown>[]);
      return json({ success: true, mode: "push_all_from_mirror", ...stats });
    }

    if (Array.isArray(body.shopify_product_ids) && body.shopify_product_ids.length > 0) {
      const ids = body.shopify_product_ids.map(String).filter((id) => /^\d+$/.test(id));
      if (ids.length === 0) return json({ error: "No valid numeric shopify_product_ids" }, 400);
      const { data: rows, error: fetchErr } = await supabase
        .from("shopify_products")
        .select("*")
        .in("shopify_product_id", ids);
      if (fetchErr) return json({ error: fetchErr.message }, 500);
      const stats = await pushMirrorRows(supabase, shopDomain, shopifyToken, (rows || []) as Record<string, unknown>[]);
      return json({ success: true, mode: "push_selected_from_mirror", ...stats });
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
      if (stats.failed > 0) {
        return json({ success: false, error: stats.errors[0]?.error || "Push failed", ...stats });
      }
      return json({ success: true, mode: "push_from_mirror", ...stats });
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

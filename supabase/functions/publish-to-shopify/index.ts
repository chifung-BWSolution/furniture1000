import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
  }[];
  vendor?: string;
  product_type?: string;
  factory_name?: string;
  cost_price?: number | null;
  sale_price?: number | null;
  // ready_to_shopify row uuid → stored as shopify_products.id for 1:1 trace.
  rts_id?: string;
  // URL handle (ready_to_shopify.shopify_url).
  handle?: string;
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
function cleanMetafieldValue(raw: string): string {
  let v = raw;
  // Day-range or number followed by mangled CJK → normalise to "<n>天"
  const m = v.match(/^(\d+\s*(?:-\s*\d+)?)\s*[�\s]*$/);
  if (m && /�/.test(v)) {
    return `${m[1].replace(/\s+/g, "")}天`;
  }
  // Otherwise drop any stray replacement chars
  v = v.replace(/�+/g, "").trim();
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

// ─── Image Validation & Upload Helpers ──────────────────────────────────────

/** Identity key for de-duplicating images across different host URLs.
 * The same image often appears as both a Storage URL (image_url) and a
 * Shopify CDN URL (after a prior publish), e.g.
 *   .../products/abc_primary_123.jpg            (Storage)
 *   cdn.shopify.com/.../abc_primary_123.jpg?v=… (Shopify, re-published)
 * Comparing full URLs misses these, sending the primary twice. We key on the
 * filename stem (basename without query string / extension) instead. */
function imageIdentityKey(url: string): string {
  if (!url || typeof url !== "string") return "";
  const noQuery = url.split("?")[0];
  const base = noQuery.substring(noQuery.lastIndexOf("/") + 1);
  return base.replace(/\.[a-zA-Z0-9]+$/, "").trim().toLowerCase();
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
        let productVariants = product.variants;
        if (!productVariants || !Array.isArray(productVariants) || productVariants.length === 0) {
          console.warn(`[publish-to-shopify] ⚠️ AUTO-FIX: Product "${product.title}" has no variants. Creating default variant.`);
          productVariants = [{
            id: "default",
            size: "",
            sku: "",
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
            sku: v.sku || "",
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
        // URL handle from ready_to_shopify.shopify_url (Shopify slugifies it)
        if (product.handle && product.handle.trim()) {
          shopifyProduct.handle = product.handle.trim();
        }

        // ── Attach metafields (sent inline on product create) ──────────────
        const shopifyMetafields = buildShopifyMetafields(product.metafields);
        if (shopifyMetafields.length > 0) {
          shopifyProduct.metafields = shopifyMetafields;
          console.log(`[publish-to-shopify] 🏷️ Attaching ${shopifyMetafields.length} metafield(s) for "${product.title}": ${shopifyMetafields.map(m => `${m.namespace}.${m.key}`).join(", ")}`);
        }

        // ── Build images array — resolve ALL images (HTTP + base64) ─────────
        // De-dup by filename stem (see imageIdentityKey): the primary image
        // often re-appears inside product.images as a Shopify CDN URL after a
        // previous publish, so a plain URL-equality check would send it twice.
        const allImages: { src: string }[] = [];
        const seenImageKeys = new Set<string>();
        if (resolvedImageUrl) {
          allImages.push({ src: resolvedImageUrl });
          seenImageKeys.add(imageIdentityKey(resolvedImageUrl));
          if (product.image_url) seenImageKeys.add(imageIdentityKey(product.image_url));
          console.log(`[publish-to-shopify] ✅ Primary image: ${resolvedImageUrl.substring(0, 80)}...`);
        }
        if (Array.isArray(product.images) && product.images.length > 0) {
          console.log(`[publish-to-shopify] 🖼️ Resolving ${product.images.length} additional image(s) for "${product.title}"`);
          for (let imgIdx = 0; imgIdx < product.images.length; imgIdx++) {
            const img = product.images[imgIdx];
            const rawSrc: string = img?.src || img?.url || (typeof img === "string" ? img : "");
            if (!rawSrc) continue;
            // Skip if it resolves to the same image as the primary (by stem)
            if (seenImageKeys.has(imageIdentityKey(rawSrc))) {
              console.log(`[publish-to-shopify] ⏭️ Skipping duplicate image [${imgIdx}] (matches primary/earlier): ${rawSrc.substring(0, 80)}`);
              continue;
            }
            const imgResult = await resolveImageUrl(supabase, supabaseUrl, `${product.id}_img${imgIdx}`, rawSrc);
            if (imgResult.url) {
              const key = imageIdentityKey(imgResult.url);
              if (!seenImageKeys.has(key)) {
                allImages.push({ src: imgResult.url });
                seenImageKeys.add(key);
                console.log(`[publish-to-shopify] ✅ Additional image [${imgIdx}]: ${imgResult.url.substring(0, 80)}...`);
              } else {
                console.log(`[publish-to-shopify] ⏭️ Skipping duplicate resolved image [${imgIdx}]`);
              }
            } else if (imgResult.warning) {
              console.warn(`[publish-to-shopify] ⚠️ Additional image [${imgIdx}] skipped: ${imgResult.warning}`);
            }
          }
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

                // 寫入 shopify_products mirror（fallback：無圖上傳成功）
                try {
                  const fbCreatedImages = (fallbackCreated.images as Record<string, unknown>[]) || [];
                  const fbCreatedVariants = (fallbackCreated.variants as Record<string, unknown>[]) || [];
                  const fbSpPrice = fbCreatedVariants[0]?.price != null ? Number(fbCreatedVariants[0].price) : (product.price ?? 0);
                  const fbSpCompareAt = fbCreatedVariants[0]?.compare_at_price != null ? Number(fbCreatedVariants[0].compare_at_price) : null;
                  const fbMfColumns: Record<string, string> = {};
                  for (const m of shopifyMetafields) {
                    fbMfColumns[`${m.namespace}.${m.key}`] = m.value;
                  }
                  const fbSpRow: Record<string, unknown> = {
                    shopify_product_id: shopifyProductId,
                    source_product_id: product.id,
                    title: product.title || null,
                    body_html: product.description_html || null,
                    vendor: product.vendor || product.factory_name || null,
                    product_type: product.product_type || null,
                    handle: product.handle || String(fallbackCreated.handle || ""),
                    status: "active",
                    published_at: new Date().toISOString(),
                    image_url: product.image_url || null,
                    images: fbCreatedImages.length > 0 ? fbCreatedImages : null,
                    variants: fbCreatedVariants.length > 0 ? fbCreatedVariants : null,
                    tags: Array.isArray(product.tags) ? product.tags : [],
                    price: fbSpPrice,
                    compare_at_price: fbSpCompareAt,
                    shopify_created_at: String(fallbackCreated.created_at || new Date().toISOString()),
                    shopify_updated_at: String(fallbackCreated.updated_at || new Date().toISOString()),
                    imported_at: new Date().toISOString(),
                    shop_domain: storeHost,
                    metafields: shopifyMetafields.length > 0 ? shopifyMetafields : null,
                    ...fbMfColumns,
                  };
                  if (product.rts_id) fbSpRow.id = product.rts_id;
                  await supabase.from("shopify_products").upsert(fbSpRow, { onConflict: "shopify_product_id" });
                } catch (fbSpErr) {
                  console.warn(`[publish-to-shopify] ⚠️ shopify_products mirror write failed (fallback, non-blocking):`, fbSpErr instanceof Error ? fbSpErr.message : String(fbSpErr));
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
        const shopifyVariants = (createdProduct.variants as Record<string, unknown>[]) || [];
        const shopifyFirstVariant = shopifyVariants[0] || {};
        const shopifyReturnedPrice = shopifyFirstVariant.price ? Number(shopifyFirstVariant.price) : product.price;
        const shopifyReturnedCompareAt = shopifyFirstVariant.compare_at_price ? Number(shopifyFirstVariant.compare_at_price) : (product.compare_at_price || null);

        console.log(`[publish-to-shopify] ✅ SUCCESS: "${product.title}" → Shopify ID: ${shopifyProductId}`);
        await supabase.from("products").update({ status: "success", shopify_product_id: shopifyProductId, error_message: imageWarning || null, source: "local" }).eq("id", product.id);

        // ── Write to shopify_products mirror table ────────────────────────
        try {
          const spImages = (createdProduct.images as Record<string, unknown>[]) || [];
          const spVariants = (createdProduct.variants as Record<string, unknown>[]) || [];
          const spPrice = spVariants[0]?.price != null ? Number(spVariants[0].price) : (product.price ?? 0);
          const spCompareAt = spVariants[0]?.compare_at_price != null ? Number(spVariants[0].compare_at_price) : null;
          // Persist metafields: raw array + dedicated namespace.key columns
          const mfColumns: Record<string, string> = {};
          for (const m of shopifyMetafields) {
            mfColumns[`${m.namespace}.${m.key}`] = m.value;
          }
          const spRow: Record<string, unknown> = {
            shopify_product_id: shopifyProductId,
            // 連結回 products 表（products.id），讓產品目錄可判斷是否已上傳 Shopify
            source_product_id: product.id,
            title: product.title || null,
            body_html: product.description_html || null,
            vendor: product.vendor || product.factory_name || null,
            product_type: product.product_type || null,
            handle: product.handle || String(createdProduct.handle || ""),
            status: "active",
            published_at: new Date().toISOString(),
            image_url: resolvedImageUrl || product.image_url || null,
            images: spImages.length > 0 ? spImages : null,
            variants: spVariants.length > 0 ? spVariants : null,
            tags: Array.isArray(product.tags) ? product.tags : [],
            price: spPrice,
            compare_at_price: spCompareAt,
            shopify_created_at: String(createdProduct.created_at || new Date().toISOString()),
            shopify_updated_at: String(createdProduct.updated_at || new Date().toISOString()),
            imported_at: new Date().toISOString(),
            shop_domain: storeHost,
            metafields: shopifyMetafields.length > 0 ? shopifyMetafields : null,
            ...mfColumns,
          };
          // id = ready_to_shopify row uuid (1:1 trace), when provided
          if (product.rts_id) spRow.id = product.rts_id;
          await supabase.from("shopify_products").upsert(spRow, { onConflict: "shopify_product_id" });
          console.log(`[publish-to-shopify] ✅ shopify_products mirror written for Shopify ID: ${shopifyProductId}`);
        } catch (spErr) {
          console.warn(`[publish-to-shopify] ⚠️ shopify_products mirror write failed (non-blocking):`, spErr instanceof Error ? spErr.message : String(spErr));
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

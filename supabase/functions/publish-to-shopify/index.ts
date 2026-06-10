import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TARGET_STORE = "office-works-360.myshopify.com";
const TOKEN_STALENESS_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour in milliseconds
const STORAGE_BUCKET = "product-images";

// ─── Global Master Project (Archive) ─────────────────────────────────────────
// The master project (kqwktnplkqucsbasyfjl) holds the bwf_product_master table
// which is a permanent archive of all products ever published to Shopify.
// It uses a SEPARATE Supabase client with its own service role key.
const MASTER_SUPABASE_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

/**
 * Initialize the master Supabase client for bwf_product_master writes.
 * Returns null if the MASTER_SERVICE_ROLE_KEY secret is not configured.
 */
function getMasterClient(): ReturnType<typeof createClient> | null {
  const masterServiceKey = Deno.env.get("MASTER_SERVICE_ROLE_KEY");
  if (!masterServiceKey) {
    console.warn(
      "[publish-to-shopify] ⚠️ MASTER_SERVICE_ROLE_KEY not set. " +
      "Skipping bwf_product_master upsert on Global Master project."
    );
    return null;
  }
  return createClient(MASTER_SUPABASE_URL, masterServiceKey);
}

/**
 * Upsert a product record into bwf_product_master on the Global Master project.
 * This is a fire-and-forget operation — errors are logged but don't block publishing.
 */
async function upsertToMaster(
  masterClient: ReturnType<typeof createClient>,
  record: Record<string, unknown>
): Promise<void> {
  try {
    const { error: masterErr } = await masterClient
      .from("bwf_product_master")
      .upsert(record, { onConflict: "shopify_id" });

    if (masterErr) {
      console.error(
        `[publish-to-shopify] ⚠️ MASTER bwf_product_master upsert error:`,
        masterErr.message
      );
    } else {
      console.log(
        `[publish-to-shopify] ✅ MASTER bwf_product_master upserted for Shopify ID: ${record.shopify_id}`
      );
    }
  } catch (err) {
    console.error(
      `[publish-to-shopify] ⚠️ MASTER bwf_product_master upsert exception:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

interface ProductPayload {
  id: string;
  title: string;
  description_html: string;
  tags: string[];
  price: number;
  compare_at_price?: number | null;
  collection: string;
  image_url: string;
  // Additional images beyond the primary image_url
  images?: { src?: string; url?: string }[];
  shopify_product_id?: string | null;
  variants: {
    id: string;
    size: string;
    color: string;
    sku: string;
    price: number;
    compare_at_price?: number | null;
    inventory: number;
  }[];
  // Shopify vendor = factory display name
  vendor?: string;
  // Shopify product_type = collection / category
  product_type?: string;
  category?: string;
  factory_name?: string;
  material?: string;
  dimension_l_mm?: number | null;
  dimension_w_mm?: number | null;
  dimension_h_mm?: number | null;
  cost_price?: number | null;
  sale_price?: number | null;
  delivery_days?: number | null;
}

// ─── Image Validation & Upload Helpers ──────────────────────────────────────

/**
 * Check if a string looks like a valid HTTP(S) URL for an image.
 */
function isValidHttpImageUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

/**
 * Check if a string is a base64-encoded image (data URI or raw base64).
 */
function isBase64Image(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("data:image/")) return true;
  if (trimmed.length > 200 && !trimmed.includes("://") && !trimmed.startsWith("/")) return true;
  if (/^[A-Za-z0-9+/=]{100,}$/.test(trimmed.substring(0, 200))) return true;
  return false;
}

/**
 * Extract mime type and raw base64 data from a data URI or raw base64 string.
 */
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

/**
 * Get file extension from mime type.
 */
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

/**
 * Ensure the storage bucket exists. Creates it if it doesn't.
 */
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

/**
 * Upload a base64 image to Supabase Storage and return the public URL.
 */
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

  console.log(
    `[publish-to-shopify] 📤 Uploading image to storage: ${filePath} (${mimeType}, ~${Math.round(base64Data.length * 0.75 / 1024)}KB)`
  );

  try {
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, bytes, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`[publish-to-shopify] ❌ Storage upload error: ${uploadError.message}`);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

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

/**
 * Validate and resolve an image URL:
 * - If valid HTTP(S) URL → use directly
 * - If base64 → upload to Supabase Storage → return public URL
 * - If local path or invalid → return null (skip image)
 */
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
    console.log(
      `[publish-to-shopify] 🔄 Image is base64 (${Math.round(trimmed.length / 1024)}KB). Uploading to Supabase Storage...`
    );
    const publicUrl = await uploadBase64ToStorage(supabase, supabaseUrl, productId, trimmed);
    if (publicUrl) {
      return { url: publicUrl };
    }
    return {
      url: null,
      warning: `Base64 image upload to storage failed for product ${productId}. Publishing without image.`,
    };
  }

  console.warn(
    `[publish-to-shopify] ⚠️ Invalid image URL format for product ${productId}: "${trimmed.substring(0, 60)}..." — skipping image`
  );
  return {
    url: null,
    warning: `Image URL is not a valid HTTP URL or base64 data: "${trimmed.substring(0, 40)}..."`,
  };
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

    // Initialize the Global Master client for bwf_product_master dual-write
    const masterSupabase = getMasterClient();

    // ──────────────────────────────────────────────────────────────────────────
    // ALWAYS fetch fresh token from DB — no static caching, no env fallback
    // for the target store. This ensures the 1-hour refresh cycle is honored.
    // ──────────────────────────────────────────────────────────────────────────
    let shopifyAccessToken = "";
    let shopifyStoreUrl = "";

    console.log(`[publish-to-shopify] Fetching fresh token from shopify_connections for ${TARGET_STORE}...`);
    const { data: conn, error: connErr } = await supabase
      .from("shopify_connections")
      .select("shop_domain, access_token, connected_at, updated_at, is_active")
      .eq("shop_domain", TARGET_STORE)
      .eq("is_active", true)
      .maybeSingle();

    if (connErr) {
      console.error("[publish-to-shopify] ❌ Error querying shopify_connections:", connErr.message);
    }

    if (conn && conn.access_token) {
      shopifyAccessToken = conn.access_token;
      shopifyStoreUrl = conn.shop_domain;

      // ── Token staleness check ──────────────────────────────────────────
      const updatedAt = conn.updated_at || conn.connected_at;
      if (updatedAt) {
        const lastUpdated = new Date(updatedAt).getTime();
        const now = Date.now();
        const ageMs = now - lastUpdated;
        const ageMinutes = Math.round(ageMs / 60000);

        if (ageMs > TOKEN_STALENESS_THRESHOLD_MS) {
          console.warn(
            `[publish-to-shopify] ⚠️ TOKEN STALE: Token for ${TARGET_STORE} was last updated ${ageMinutes} minutes ago (threshold: 60 min). ` +
            `The refresh-shopify-tokens cron may have failed. Proceeding with potentially stale token.`
          );
        } else {
          console.log(
            `[publish-to-shopify] ✅ Token is fresh — last updated ${ageMinutes} minutes ago for ${conn.shop_domain}`
          );
        }
      } else {
        console.warn(
          `[publish-to-shopify] ⚠️ No updated_at or connected_at timestamp found for ${TARGET_STORE}. Cannot verify token freshness.`
        );
      }
    } else {
      console.warn(`[publish-to-shopify] ⚠️ No active connection found in DB for ${TARGET_STORE}`);
    }

    // ── Fallback: request body credentials (Settings UI) ─────────────────
    const body = await req.json();
    const { products, shopify_access_token: bodyToken, shopify_store_url: bodyStoreUrl } = body as {
      products: ProductPayload[];
      shopify_access_token?: string;
      shopify_store_url?: string;
    };

    if (!shopifyAccessToken.trim() && bodyToken && bodyToken.trim()) {
      shopifyAccessToken = bodyToken.trim();
      console.log("[publish-to-shopify] Using shopify_access_token from request body (Settings UI fallback)");
    }
    if (!shopifyStoreUrl.trim() && bodyStoreUrl && bodyStoreUrl.trim()) {
      shopifyStoreUrl = bodyStoreUrl.trim();
      console.log("[publish-to-shopify] Using shopify_store_url from request body (Settings UI fallback)");
    }

    // ── Final credential validation ──────────────────────────────────────
    if (!shopifyAccessToken.trim() || !shopifyStoreUrl.trim()) {
      console.error("[publish-to-shopify] ❌ No Shopify credentials available from DB or request body");
      return new Response(
        JSON.stringify({
          error:
            "No Shopify credentials found. The shopify_connections table has no active entry for " +
            TARGET_STORE +
            ". Enter your credentials in Settings or ensure the refresh-shopify-tokens cron is running.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Build Shopify API base URL
    const storeHost = shopifyStoreUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const shopifyApiBase = `https://${storeHost}/admin/api/2024-10`;

    console.log("[publish-to-shopify] Token present:", !!shopifyAccessToken);
    console.log("[publish-to-shopify] Token prefix:", shopifyAccessToken.substring(0, 10) + "...");
    console.log("[publish-to-shopify] API base:", shopifyApiBase);

    if (!products || !Array.isArray(products) || products.length === 0) {
      return new Response(
        JSON.stringify({ error: "Expected { products: [...] } with at least one product." }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // ── Ensure Supabase Storage bucket exists for image uploads ──────────
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
        if (product.shopify_product_id) {
          console.log(`[publish-to-shopify] SAFETY: Skipping "${product.title}" — already has Shopify ID ${product.shopify_product_id}. Use Shopify Admin to edit existing products.`);
          
          await supabase
            .from("products")
            .update({
              status: "success",
              error_message: null,
            })
            .eq("id", product.id);

          results.push({
            id: product.id,
            success: true,
            shopify_product_id: product.shopify_product_id,
            action: "skipped_already_exists",
          });
          continue;
        }

        // ── AUTO-FIX: Ensure variants array always exists ──────────────────
        let productVariants = product.variants;
        if (!productVariants || !Array.isArray(productVariants) || productVariants.length === 0) {
          console.warn(
            `[publish-to-shopify] ⚠️ AUTO-FIX: Product "${product.title}" has no variants. ` +
            `Creating default variant with price: ${product.price || "0.00"}`
          );
          productVariants = [
            {
              id: "default",
              size: "Default",
              color: "Default",
              sku: "",
              price: product.price || 0,
              compare_at_price: product.compare_at_price || null,
              inventory: 0,
            },
          ];
        }

        // ── Sanitize price values ────────────────────────────────────────
        const sanitizedVariants = productVariants.map((v) => {
          const variantPrice = (typeof v.price === "number" && !isNaN(v.price)) ? v.price : (product.price || 0);
          const variant: Record<string, unknown> = {
            option1: v.size || "Default",
            option2: v.color || "Default",
            price: variantPrice.toFixed(2),
            sku: v.sku || "",
            inventory_management: (v.inventory !== undefined && v.inventory !== null) ? "shopify" : null,
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
        // Validate image URL before sending to Shopify:
        //  - Valid HTTP(S) URLs → use directly
        //  - Base64 images → upload to Supabase Storage → use public URL
        //  - Invalid/local paths → skip image, publish product without it
        let resolvedImageUrl: string | null = null;
        let imageWarning: string | undefined;

        if (product.image_url) {
          console.log(`[publish-to-shopify] 🖼️ Validating image for "${product.title}": "${String(product.image_url).substring(0, 80)}..."`);
          const imageResult = await resolveImageUrl(supabase, supabaseUrl, product.id, product.image_url);
          resolvedImageUrl = imageResult.url;
          imageWarning = imageResult.warning;

          if (imageWarning) {
            console.warn(`[publish-to-shopify] ⚠️ Image warning for "${product.title}": ${imageWarning}`);
          }

          // Update product record with resolved storage URL if it changed
          if (resolvedImageUrl && resolvedImageUrl !== product.image_url) {
            console.log(`[publish-to-shopify] 📝 Updating product image_url in DB to storage URL`);
            await supabase
              .from("products")
              .update({ image_url: resolvedImageUrl })
              .eq("id", product.id);
          }
        } else {
          console.log(`[publish-to-shopify] ℹ️ No image_url provided for "${product.title}"`);
        }

        // ── Build Shopify product payload ──────────────────────────────────
        // Field mapping:
        //   product.title            → title
        //   product.description_html → body_html
        //   product.vendor / factory_name → vendor
        //   product.product_type / collection → product_type
        //   product.tags             → tags
        //   product.image_url        → images[0]
        //   product.images[]         → images[1..n]
        const shopifyProduct: Record<string, unknown> = {
          title: product.title || "Untitled Product",
          body_html: product.description_html || `<p>${product.title || "Untitled Product"}</p>`,
          vendor: product.vendor || product.factory_name || "",
          product_type: product.product_type || product.collection || "",
          tags: Array.isArray(product.tags) ? product.tags.join(", ") : "",
          status: "active",
          variants: sanitizedVariants,
          options: [
            { name: "Size" },
            { name: "Color" },
          ],
        };

        // Build images array: primary image_url first, then additional images
        const allImages: { src: string }[] = [];
        if (resolvedImageUrl) {
          allImages.push({ src: resolvedImageUrl });
          console.log(`[publish-to-shopify] ✅ Primary image: ${resolvedImageUrl.substring(0, 80)}...`);
        }
        // Add additional images (skip duplicates of primary)
        if (Array.isArray(product.images)) {
          for (const img of product.images) {
            const imgSrc = img?.src || img?.url || (typeof img === "string" ? img : null);
            if (imgSrc && typeof imgSrc === "string" && imgSrc.startsWith("http") && imgSrc !== resolvedImageUrl) {
              allImages.push({ src: imgSrc });
              console.log(`[publish-to-shopify] ✅ Additional image: ${imgSrc.substring(0, 80)}...`);
            }
          }
        }
        if (allImages.length > 0) {
          shopifyProduct.images = allImages;
        } else {
          console.log(`[publish-to-shopify] ℹ️ Publishing "${product.title}" WITHOUT images`);
        }

        // ── Log the exact payload being sent ─────────────────────────────
        const requestPayload = { product: shopifyProduct };
        console.log(`[publish-to-shopify] POST (CREATE) new Shopify product for "${product.title}"`);
        console.log(`[publish-to-shopify] 📦 Payload for "${product.title}":`, JSON.stringify(requestPayload, null, 2));

        // ── Shopify API call with full error logging ─────────────────────
        let shopifyResponse: Response;
        let rawResponseBody: string;
        try {
          shopifyResponse = await fetch(
            `${shopifyApiBase}/products.json`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": shopifyAccessToken,
              },
              body: JSON.stringify(requestPayload),
            }
          );

          // ── SCOPE VERIFICATION: Log Shopify response headers ─────────
          console.log(`[publish-to-shopify] 📋 Response status: ${shopifyResponse.status} ${shopifyResponse.statusText}`);
          const allowedScopes = shopifyResponse.headers.get("X-Shopify-Shop-Api-Call-Limit");
          const shopScopes = shopifyResponse.headers.get("X-Shopify-Allowed-Scopes");
          if (shopScopes !== null) {
            console.log(`[publish-to-shopify] 🔑 X-Shopify-Allowed-Scopes: ${shopScopes}`);
            if (!shopScopes.includes("write_products")) {
              console.error(
                `[publish-to-shopify] 🚨 CRITICAL SCOPE ISSUE: "write_products" is MISSING from allowed scopes! ` +
                `Current scopes: ${shopScopes}. ` +
                `You must re-authorize the app with the write_products scope.`
              );
            }
          } else {
            console.log(`[publish-to-shopify] ℹ️ X-Shopify-Allowed-Scopes header not present in response.`);
          }
          if (allowedScopes) {
            console.log(`[publish-to-shopify] 📊 API call limit: ${allowedScopes}`);
          }

          // Log ALL response headers for debugging
          console.log(`[publish-to-shopify] 📋 All response headers:`);
          shopifyResponse.headers.forEach((value, key) => {
            console.log(`  ${key}: ${value}`);
          });

          // Read the FULL raw response body
          rawResponseBody = await shopifyResponse.text();

        } catch (fetchError) {
          const fetchErrMsg = fetchError instanceof Error ? fetchError.message : "Network/fetch error";
          console.error(`[publish-to-shopify] 🌐 FETCH ERROR for "${product.title}":`, fetchErrMsg);

          await supabase
            .from("products")
            .update({
              status: "error",
              error_message: `Network error: ${fetchErrMsg}`,
            })
            .eq("id", product.id);

          results.push({
            id: product.id,
            success: false,
            error: `Network error: ${fetchErrMsg}`,
            action: "create_failed",
          });
          continue;
        }

        // ── Handle non-OK responses ───────────────────────────────────────
        if (!shopifyResponse.ok) {
          console.error(
            `[publish-to-shopify] ❌ Shopify API error for "${product.title}" ` +
            `(HTTP ${shopifyResponse.status} ${shopifyResponse.statusText}):`
          );
          console.error(`[publish-to-shopify] ❌ FULL RESPONSE BODY:\n${rawResponseBody}`);

          // ── IMAGE ERROR FALLBACK ────────────────────────────────────────
          // If Shopify returns 422 and the error mentions images/src/url,
          // retry the request WITHOUT images so title/price/desc still sync.
          const isImageError =
            shopifyResponse.status === 422 &&
            (rawResponseBody.toLowerCase().includes("image") ||
             rawResponseBody.toLowerCase().includes("src") ||
             rawResponseBody.toLowerCase().includes("url is not valid"));

          if (isImageError && resolvedImageUrl) {
            console.warn(
              `[publish-to-shopify] 🔄 FALLBACK: Got 422 image error. Retrying "${product.title}" WITHOUT images...`
            );

            delete shopifyProduct.images;
            const fallbackPayload = { product: shopifyProduct };
            console.log(`[publish-to-shopify] 📦 Fallback payload (no images):`, JSON.stringify(fallbackPayload, null, 2));

            try {
              const fallbackResponse = await fetch(
                `${shopifyApiBase}/products.json`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Shopify-Access-Token": shopifyAccessToken,
                  },
                  body: JSON.stringify(fallbackPayload),
                }
              );

              const fallbackBody = await fallbackResponse.text();

              if (fallbackResponse.ok) {
                let fallbackData: Record<string, unknown>;
                try {
                  fallbackData = JSON.parse(fallbackBody);
                } catch {
                  console.error(`[publish-to-shopify] ❌ Fallback response not valid JSON`);
                  await supabase
                    .from("products")
                    .update({
                      status: "error",
                      error_message: "Invalid JSON in Shopify fallback response",
                    })
                    .eq("id", product.id);
                  results.push({
                    id: product.id,
                    success: false,
                    error: "Invalid JSON in Shopify fallback response",
                    action: "create_failed",
                  });
                  continue;
                }

                const createdProduct = (fallbackData as Record<string, Record<string, unknown>>).product;
                const shopifyProductId = String(createdProduct.id);

                console.log(
                  `[publish-to-shopify] ✅ FALLBACK SUCCESS: "${product.title}" → Shopify ID: ${shopifyProductId} (created WITHOUT image)`
                );

                const warningMsg = `Published without image (original image URL was invalid). Product is live on Shopify.`;

                await supabase
                  .from("products")
                  .update({
                    status: "success",
                    shopify_product_id: shopifyProductId,
                    error_message: warningMsg,
                    source: "local",
                  })
                  .eq("id", product.id);

                // ── DUAL WRITE: Upsert into bwf_product_master (fallback path) ──
                // Action A: Primary project (local bwf_product_master if it exists)
                // Action B: Global Master project (permanent archive)
                const fallbackVariants = (createdProduct.variants as Record<string, unknown>[]) || [];
                const fallbackFirstVariant = fallbackVariants[0] || {};
                const fbPrice = fallbackFirstVariant.price ? Number(fallbackFirstVariant.price) : product.price;
                const fbCompareAt = fallbackFirstVariant.compare_at_price ? Number(fallbackFirstVariant.compare_at_price) : (product.compare_at_price || null);

                const fallbackMasterRecord = {
                  shopify_id: shopifyProductId,
                  title: product.title || null,
                  category: product.category || product.collection || null,
                  factory_name: product.factory_name || null,
                  image_url: product.image_url || null,
                  description: product.description_html || null,
                  material: product.material || null,
                  dimension_l_mm: product.dimension_l_mm || null,
                  dimension_w_mm: product.dimension_w_mm || null,
                  dimension_h_mm: product.dimension_h_mm || null,
                  cost_price: product.cost_price || null,
                  sale_price: product.sale_price || product.price || null,
                  shopify_price: fbPrice,
                  shopify_compare_at_price: fbCompareAt,
                  delivery_days: product.delivery_days || null,
                };

                // Action A: Primary project local bwf_product_master
                try {
                  const { error: localMasterErr } = await supabase
                    .from("bwf_product_master")
                    .upsert(fallbackMasterRecord, { onConflict: "shopify_id" });
                  if (localMasterErr) {
                    console.error(`[publish-to-shopify] ⚠️ PRIMARY bwf_product_master upsert error (fallback):`, localMasterErr.message);
                  } else {
                    console.log(`[publish-to-shopify] ✅ PRIMARY bwf_product_master upserted (fallback) for Shopify ID: ${shopifyProductId}`);
                  }
                } catch (localErr) {
                  console.error(`[publish-to-shopify] ⚠️ PRIMARY bwf_product_master exception (fallback):`, localErr);
                }

                // Action B: Global Master project (permanent archive)
                if (masterSupabase) {
                  await upsertToMaster(masterSupabase, fallbackMasterRecord);
                }

                results.push({
                  id: product.id,
                  success: true,
                  shopify_product_id: shopifyProductId,
                  action: "created_without_image",
                  image_warning: warningMsg,
                });
                continue;
              } else {
                console.error(
                  `[publish-to-shopify] ❌ Fallback also failed (HTTP ${fallbackResponse.status}): ${fallbackBody.substring(0, 300)}`
                );
              }
            } catch (fallbackFetchErr) {
              console.error(
                `[publish-to-shopify] ❌ Fallback fetch error:`,
                fallbackFetchErr instanceof Error ? fallbackFetchErr.message : String(fallbackFetchErr)
              );
            }
          }

          // Original error handling (not image-related or fallback also failed)
          let errMsg: string;
          try {
            const errorJson = JSON.parse(rawResponseBody);
            errMsg = JSON.stringify(errorJson.errors || errorJson);
            console.error(`[publish-to-shopify] ❌ Parsed errors:`, errMsg);
          } catch {
            errMsg = rawResponseBody.substring(0, 500);
            console.error(`[publish-to-shopify] ❌ Response was not valid JSON. Raw text (first 500 chars): ${errMsg}`);
          }

          await supabase
            .from("products")
            .update({
              status: "error",
              error_message: `Shopify API (${shopifyResponse.status}): ${errMsg}`,
            })
            .eq("id", product.id);

          results.push({
            id: product.id,
            success: false,
            error: `Shopify API (${shopifyResponse.status}): ${errMsg}`,
            action: "create_failed",
            image_warning: imageWarning,
          });
          continue;
        }

        // ── Parse successful response ────────────────────────────────────
        let shopifyData: Record<string, unknown>;
        try {
          shopifyData = JSON.parse(rawResponseBody);
        } catch {
          console.error(`[publish-to-shopify] ❌ Failed to parse success response as JSON:`, rawResponseBody.substring(0, 500));
          await supabase
            .from("products")
            .update({
              status: "error",
              error_message: `Invalid JSON in Shopify 200 response`,
            })
            .eq("id", product.id);
          results.push({
            id: product.id,
            success: false,
            error: "Invalid JSON in Shopify 200 response",
            action: "create_failed",
          });
          continue;
        }

        const createdProduct = (shopifyData as Record<string, Record<string, unknown>>).product;
        const shopifyProductId = String(createdProduct.id);

        // Extract Shopify price info from the created product
        const shopifyVariants = (createdProduct.variants as Record<string, unknown>[]) || [];
        const shopifyFirstVariant = shopifyVariants[0] || {};
        const shopifyReturnedPrice = shopifyFirstVariant.price ? Number(shopifyFirstVariant.price) : product.price;
        const shopifyReturnedCompareAt = shopifyFirstVariant.compare_at_price ? Number(shopifyFirstVariant.compare_at_price) : (product.compare_at_price || null);

        console.log(`[publish-to-shopify] ✅ SUCCESS: "${product.title}" → Shopify ID: ${shopifyProductId}`);

        await supabase
          .from("products")
          .update({
            status: "success",
            shopify_product_id: shopifyProductId,
            error_message: imageWarning || null,
            source: "local",
          })
          .eq("id", product.id);

        // ── Write to shopify_products mirror table ────────────────────────
        // Mirrors the published product so it appears in "已上載產品" page.
        try {
          const shopifyCreatedProduct = (shopifyData as Record<string, Record<string, unknown>>).product;
          const spImages = (shopifyCreatedProduct.images as Record<string, unknown>[]) || [];
          const spVariants = (shopifyCreatedProduct.variants as Record<string, unknown>[]) || [];
          const spPrice = spVariants[0]?.price != null ? Number(spVariants[0].price) : (product.price ?? 0);
          const spCompareAt = spVariants[0]?.compare_at_price != null ? Number(spVariants[0].compare_at_price) : null;

          await supabase.from("shopify_products").upsert({
            shopify_product_id: shopifyProductId,
            title: product.title || null,
            body_html: product.description_html || null,
            vendor: product.vendor || product.factory_name || null,
            product_type: product.product_type || product.collection || null,
            handle: String(shopifyCreatedProduct.handle || ""),
            status: "active",
            published_at: new Date().toISOString(),
            image_url: resolvedImageUrl || product.image_url || null,
            images: spImages.length > 0 ? spImages : null,
            variants: spVariants.length > 0 ? spVariants : null,
            tags: Array.isArray(product.tags) ? product.tags : [],
            price: spPrice,
            compare_at_price: spCompareAt,
            shopify_created_at: String(shopifyCreatedProduct.created_at || new Date().toISOString()),
            shopify_updated_at: String(shopifyCreatedProduct.updated_at || new Date().toISOString()),
            imported_at: new Date().toISOString(),
            shop_domain: storeHost,
          }, { onConflict: "shopify_product_id" });
          console.log(`[publish-to-shopify] ✅ shopify_products mirror written for Shopify ID: ${shopifyProductId}`);
        } catch (spErr) {
          console.warn(`[publish-to-shopify] ⚠️ shopify_products mirror write failed (non-blocking):`, spErr instanceof Error ? spErr.message : String(spErr));
        }

        // ── DUAL WRITE: Upsert into bwf_product_master ────────────────────
        // Action A: Primary project (local bwf_product_master)
        // Action B: Global Master project (permanent archive at kqwktnplkqucsbasyfjl)
        const masterRecord = {
          shopify_id: shopifyProductId,
          title: product.title || null,
          category: product.category || product.collection || null,
          factory_name: product.factory_name || null,
          image_url: resolvedImageUrl || product.image_url || null,
          description: product.description_html || null,
          material: product.material || null,
          dimension_l_mm: product.dimension_l_mm || null,
          dimension_w_mm: product.dimension_w_mm || null,
          dimension_h_mm: product.dimension_h_mm || null,
          cost_price: product.cost_price || null,
          sale_price: product.sale_price || product.price || null,
          shopify_price: shopifyReturnedPrice,
          shopify_compare_at_price: shopifyReturnedCompareAt,
          delivery_days: product.delivery_days || null,
        };

        // Action A: Primary project local bwf_product_master
        try {
          const { error: localMasterErr } = await supabase
            .from("bwf_product_master")
            .upsert(masterRecord, { onConflict: "shopify_id" });

          if (localMasterErr) {
            console.error(`[publish-to-shopify] ⚠️ PRIMARY bwf_product_master upsert error for "${product.title}":`, localMasterErr.message);
          } else {
            console.log(`[publish-to-shopify] ✅ PRIMARY bwf_product_master upserted for Shopify ID: ${shopifyProductId}`);
          }
        } catch (localMasterCatchErr) {
          console.error(`[publish-to-shopify] ⚠️ PRIMARY bwf_product_master upsert exception:`, localMasterCatchErr);
        }

        // Action B: Global Master project (permanent archive)
        if (masterSupabase) {
          await upsertToMaster(masterSupabase, masterRecord);
        }

        results.push({
          id: product.id,
          success: true,
          shopify_product_id: shopifyProductId,
          action: "created",
          image_warning: imageWarning,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[publish-to-shopify] 💥 Unexpected error processing "${product.title}":`, errMsg);
        if (err instanceof Error && err.stack) {
          console.error(`[publish-to-shopify] Stack trace:`, err.stack);
        }

        await supabase
          .from("products")
          .update({
            status: "error",
            error_message: `Publish error: ${errMsg}`,
          })
          .eq("id", product.id);

        results.push({
          id: product.id,
          success: false,
          error: errMsg,
          action: "create_failed",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;
    const skippedCount = results.filter((r) => r.action === "skipped_already_exists").length;
    const createdCount = results.filter((r) => r.action === "created").length;
    const createdWithoutImageCount = results.filter((r) => r.action === "created_without_image").length;

    console.log(
      `[publish-to-shopify] Done. ${createdCount} created, ${createdWithoutImageCount} created without image, ${skippedCount} skipped (already exist), ${errorCount} failed.`
    );

    return new Response(
      JSON.stringify({
        success: errorCount === 0,
        results,
        summary: {
          total: products.length,
          created: createdCount,
          created_without_image: createdWithoutImageCount,
          skipped: skippedCount,
          errors: errorCount,
          success: successCount,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("[publish-to-shopify] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  }
});

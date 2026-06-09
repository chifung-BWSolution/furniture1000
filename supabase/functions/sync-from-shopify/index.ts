import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    // ─── 1. Read environment variables ─────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(
        {
          error: "Missing Configuration",
          hint: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
          missing_secrets: [
            ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
            ...(!supabaseServiceKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
          ],
        },
        400
      );
    }

    // ─── 2. Create Supabase client ──────────────────────────────────────
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ─── 3. Resolve Shopify credentials (DB first, then env fallback) ────
    // The DB token is refreshed automatically every 1 hour by the
    // refresh-shopify-token cron job, so it should always be the freshest.
    let shopifyAccessToken = "";
    let shopifyStoreUrl = "";

    console.log("[sync-from-shopify] --- Starting sync ---");

    // PRIORITY 1: Always check shopify_connections table first (auto-refreshed token)
    console.log("[sync-from-shopify] Checking shopify_connections table for latest token...");
    const { data: conn, error: connErr } = await supabase
      .from("shopify_connections")
      .select("shop_domain, access_token, connected_at")
      .eq("is_active", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connErr) {
      console.error("[sync-from-shopify] Error querying shopify_connections:", connErr.message);
    }

    if (conn) {
      console.log("[sync-from-shopify] ✅ Found active connection in DB for shop:", conn.shop_domain, "| Last refreshed:", conn.connected_at);
      if (conn.access_token) {
        shopifyAccessToken = conn.access_token;
        console.log("[sync-from-shopify] Using access_token from DB (auto-refreshed)");
      }
      if (conn.shop_domain) {
        shopifyStoreUrl = conn.shop_domain;
        console.log("[sync-from-shopify] Using shop_domain from DB:", conn.shop_domain);
      }
    } else {
      console.log("[sync-from-shopify] No active connection found in shopify_connections table");
    }

    // PRIORITY 2: Fall back to env secrets if DB didn't have credentials
    if (!shopifyAccessToken.trim()) {
      const envToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN") || "";
      if (envToken.trim()) {
        shopifyAccessToken = envToken;
        console.log("[sync-from-shopify] Using SHOPIFY_ACCESS_TOKEN from env (fallback):", `${envToken.length} chars`);
      }
    }
    if (!shopifyStoreUrl.trim()) {
      const envUrl = Deno.env.get("SHOPIFY_STORE_URL") || "";
      if (envUrl.trim()) {
        shopifyStoreUrl = envUrl;
        console.log("[sync-from-shopify] Using SHOPIFY_STORE_URL from env (fallback):", envUrl);
      }
    }

    console.log("[sync-from-shopify] Final token source:", conn?.access_token ? "DB (auto-refreshed)" : "env secret or pending body");
    console.log("[sync-from-shopify] Final store URL:", shopifyStoreUrl || "⚠️ NOT SET (pending body)");

    // PRIORITY 3: Fall back to credentials sent in request body (from Settings UI)
    let bodyData: Record<string, string> = {};
    try {
      bodyData = await req.json();
    } catch { /* empty body is fine */ }

    if (!shopifyAccessToken.trim() && bodyData?.shopify_access_token?.trim()) {
      shopifyAccessToken = bodyData.shopify_access_token.trim();
      console.log("[sync-from-shopify] Using shopify_access_token from request body (Settings UI fallback)");
    }
    if (!shopifyStoreUrl.trim() && bodyData?.shopify_store_url?.trim()) {
      shopifyStoreUrl = bodyData.shopify_store_url.trim();
      console.log("[sync-from-shopify] Using shopify_store_url from request body (Settings UI fallback)");
    }

    // Final validation
    const missingSecrets: string[] = [];
    if (!shopifyAccessToken.trim()) missingSecrets.push("SHOPIFY_ACCESS_TOKEN");
    if (!shopifyStoreUrl.trim()) missingSecrets.push("SHOPIFY_STORE_URL");

    if (missingSecrets.length > 0) {
      const msg = `Missing Shopify credentials: ${missingSecrets.join(", ")}. Enter them in Settings, set as Edge Function secrets, or connect via OAuth.`;
      console.error("[sync-from-shopify]", msg);
      return jsonResponse(
        {
          error: "Missing Configuration",
          hint: "No Shopify credentials found. Enter your Shopify Admin API access token and store URL in Settings, or set SHOPIFY_ACCESS_TOKEN and SHOPIFY_STORE_URL as Edge Function secrets.",
          missing_secrets: missingSecrets,
        },
        200
      );
    }

    // ─── 4. Build Shopify API URL (handle double-https and trailing slashes) ──
    const storeHost = shopifyStoreUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
    const shopifyApiBase = `https://${storeHost}/admin/api/2024-04`;

    console.log("[sync-from-shopify] Resolved Shopify API base:", shopifyApiBase);

    // ─── Helper: attempt token refresh via refresh-shopify-tokens edge function ──
    let hasAttemptedTokenRefresh = false;

    async function attemptTokenRefresh(): Promise<string | null> {
      if (hasAttemptedTokenRefresh) return null;
      hasAttemptedTokenRefresh = true;

      console.log("[sync-from-shopify] 🔄 401 detected — attempting automatic token refresh...");

      try {
        // Call the refresh-shopify-tokens edge function
        const refreshUrl = `${supabaseUrl}/functions/v1/supabase-functions-refresh-shopify-tokens`;
        const refreshRes = await fetch(refreshUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({}),
        });

        const refreshData = await refreshRes.json();
        console.log("[sync-from-shopify] Refresh response:", JSON.stringify(refreshData));

        if (!refreshRes.ok || !refreshData.success) {
          console.error("[sync-from-shopify] ❌ Token refresh failed:", refreshData.error || refreshRes.status);
          return null;
        }

        // Now read the freshly-updated token from the DB
        const { data: freshConn, error: freshErr } = await supabase
          .from("shopify_connections")
          .select("access_token")
          .eq("shop_domain", shopifyStoreUrl.replace(/^https?:\/\//, "").replace(/\/+$/, ""))
          .eq("is_active", true)
          .maybeSingle();

        if (freshErr || !freshConn?.access_token) {
          // Try without exact domain match — get the most recently updated active row
          const { data: anyConn } = await supabase
            .from("shopify_connections")
            .select("access_token")
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (anyConn?.access_token) {
            console.log("[sync-from-shopify] ✅ Got refreshed token from DB (fallback query)");
            return anyConn.access_token;
          }

          console.error("[sync-from-shopify] ❌ Could not read refreshed token from DB");
          return null;
        }

        console.log("[sync-from-shopify] ✅ Got refreshed token from DB");
        return freshConn.access_token;
      } catch (refreshErr) {
        console.error("[sync-from-shopify] ❌ Token refresh error:", refreshErr);
        return null;
      }
    }

    // ─── 5. Paginate through ALL Shopify products ───────────────────────
    console.log("[sync-from-shopify] Fetching products from Shopify...");

    const allShopifyProducts: Record<string, unknown>[] = [];
    let nextPageUrl: string | null =
      `${shopifyApiBase}/products.json?limit=250`;

    while (nextPageUrl) {
      console.log("[sync-from-shopify] Fetching page:", nextPageUrl);

      let response: Response;
      try {
        response = await fetch(nextPageUrl, {
          headers: {
            "X-Shopify-Access-Token": shopifyAccessToken,
            "Content-Type": "application/json",
          },
        });
      } catch (fetchErr) {
        const errMsg =
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(
          "[sync-from-shopify] Network error fetching Shopify:",
          errMsg
        );
        return jsonResponse(
          {
            error: `Network error connecting to Shopify at ${nextPageUrl}: ${errMsg}`,
            hint: "Check that SHOPIFY_STORE_URL is correct and the store is accessible.",
          },
          502
        );
      }

      console.log(
        "[sync-from-shopify] Shopify response status:",
        response.status
      );

      if (!response.ok) {
        // ─── 401 Auto-Retry: refresh the token once, then retry this request ──
        if (response.status === 401 && !hasAttemptedTokenRefresh) {
          const newToken = await attemptTokenRefresh();
          if (newToken) {
            shopifyAccessToken = newToken;
            console.log("[sync-from-shopify] 🔄 Retrying Shopify request with refreshed token...");
            // Retry this same page URL with the new token
            try {
              response = await fetch(nextPageUrl, {
                headers: {
                  "X-Shopify-Access-Token": shopifyAccessToken,
                  "Content-Type": "application/json",
                },
              });
              console.log("[sync-from-shopify] Retry response status:", response.status);
            } catch (retryErr) {
              const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              console.error("[sync-from-shopify] Retry network error:", retryMsg);
              return jsonResponse(
                { error: `Network error on retry: ${retryMsg}` },
                502
              );
            }
          }
        }

        // If still not OK after potential retry, return the error
        if (!response.ok) {
          const errText = await response.text();
          let errData: unknown;
          try {
            errData = JSON.parse(errText);
          } catch {
            errData = { raw: errText };
          }
          console.error(
            "[sync-from-shopify] Shopify API error:",
            response.status,
            JSON.stringify(errData)
          );
          return jsonResponse(
            {
              error: `Shopify API error (${response.status})`,
              shopify_error: errData,
              url_used: nextPageUrl,
              token_refresh_attempted: hasAttemptedTokenRefresh,
              hint:
                response.status === 401
                  ? "SHOPIFY_ACCESS_TOKEN is invalid or expired. Automatic refresh was attempted but failed. Try reconnecting via OAuth in Settings."
                  : response.status === 404
                    ? "Store URL or API version may be wrong. Expected format: your-store.myshopify.com"
                    : "Check Shopify API response details.",
            },
            response.status >= 500 ? 502 : response.status
          );
        }
      }

      // Parse the response body safely
      let data: Record<string, unknown>;
      try {
        const rawText = await response.text();
        data = JSON.parse(rawText);
      } catch (parseErr) {
        console.error(
          "[sync-from-shopify] Failed to parse Shopify JSON response"
        );
        return jsonResponse(
          {
            error: "Shopify returned a non-JSON response.",
            hint: "The Shopify API URL may be incorrect.",
          },
          502
        );
      }

      const products = data.products;
      if (Array.isArray(products)) {
        allShopifyProducts.push(...products);
      } else {
        console.warn(
          "[sync-from-shopify] Unexpected response shape — 'products' key is missing or not an array. Keys:",
          Object.keys(data)
        );
      }

      // Handle cursor-based pagination via Link header
      const linkHeader = response.headers.get("link");
      nextPageUrl = null;
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch) {
          nextPageUrl = nextMatch[1];
        }
      }
    }

    console.log(
      `[sync-from-shopify] Fetched ${allShopifyProducts.length} total products from Shopify`
    );

    // ─── PREVIEW MODE: return product list without writing to DB ────────
    // Triggered when body contains { preview_only: true } or { import: false }
    let bodyData: Record<string, unknown> = {};
    try {
      if (req.method === "POST") {
        const cloned = req.clone();
        bodyData = await cloned.json().catch(() => ({}));
      }
    } catch { /* ignore */ }

    if (bodyData?.preview_only === true) {
      const preview = allShopifyProducts.map((p: Record<string, unknown>) => {
        const variants = (p.variants as { price?: string }[]) ?? [];
        const minPrice = variants.length
          ? Math.min(...variants.map((v) => parseFloat(v.price ?? "0") || 0))
          : 0;
        const img = (p.images as { src?: string }[])?.[0]?.src ?? null;
        return {
          shopify_product_id: String(p.id),
          title: p.title ?? "Untitled",
          vendor: p.vendor ?? "",
          product_type: p.product_type ?? "",
          status: p.status ?? "active",
          published_at: p.published_at ?? null,
          image_url: img,
          price: minPrice,
          variants_count: variants.length,
        };
      });
      return jsonResponse({ products: preview, total: preview.length });
    }

    // ─── SELECTIVE IMPORT MODE: import only specified product IDs ────────
    let productIdsToImport: Set<string> | null = null;
    if (Array.isArray(bodyData?.product_ids) && (bodyData.product_ids as string[]).length > 0) {
      productIdsToImport = new Set(bodyData.product_ids as string[]);
      console.log(`[sync-from-shopify] Selective import: ${productIdsToImport.size} products requested`);
    }

    // Handle empty product list gracefully
    if (allShopifyProducts.length === 0) {
      console.log("[sync-from-shopify] No products found on Shopify store.");
      return jsonResponse({
        success: true,
        summary: {
          total_shopify: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
          message: "No products found on your Shopify store.",
        },
      });
    }

    // ─── 6. Load existing products from Supabase for diff ───────────────
    const { data: existingProducts, error: fetchExistingErr } = await supabase
      .from("products")
      .select("id, shopify_product_id, source, synced_at");

    if (fetchExistingErr) {
      console.error(
        "[sync-from-shopify] Error fetching existing products from Supabase:",
        fetchExistingErr
      );
      return jsonResponse(
        {
          error: `Supabase query error: ${fetchExistingErr.message}`,
          hint: "There may be a database schema issue. Check the products table exists.",
        },
        500
      );
    }

    const existingByShopifyId: Record<
      string,
      { id: string; source: string; synced_at: string | null }
    > = {};
    (existingProducts || []).forEach(
      (p: {
        id: string;
        shopify_product_id: string | null;
        source: string;
        synced_at: string | null;
      }) => {
        if (p.shopify_product_id) {
          existingByShopifyId[p.shopify_product_id] = {
            id: p.id,
            source: p.source,
            synced_at: p.synced_at,
          };
        }
      }
    );

    // ─── 7. Upsert each product ─────────────────────────────────────────
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: { shopifyId: string; title: string; error: string }[] = [];
    const syncTimestamp = new Date().toISOString();

    for (const shopifyProduct of allShopifyProducts) {
      try {
        const sp = shopifyProduct as Record<string, unknown>;
        const shopifyId = String(sp.id);

        // Skip if selective import and this product wasn't selected
        if (productIdsToImport !== null && !productIdsToImport.has(shopifyId)) {
          skipped++;
          continue;
        }
        const title = (sp.title as string) || "Untitled";
        const bodyHtml = (sp.body_html as string) || "";
        const tags = ((sp.tags as string) || "")
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean);
        const productType = (sp.product_type as string) || "";
        const images = (sp.images as Record<string, unknown>[]) || [];
        const imageUrl =
          images.length > 0 ? (images[0].src as string) : "";
        const variants =
          (sp.variants as Record<string, unknown>[]) || [];
        const mainPrice =
          variants.length > 0
            ? parseFloat(String(variants[0].price)) || 0
            : 0;
        const compareAtPrice =
          variants.length > 0 && variants[0].compare_at_price
            ? parseFloat(String(variants[0].compare_at_price)) || null
            : null;

        // Full images array for JSONB storage
        const imagesJson = images.map(
          (img: Record<string, unknown>) => ({
            id: img.id,
            src: img.src,
            alt: img.alt || "",
            width: img.width,
            height: img.height,
            position: img.position,
          })
        );

        const shopifySyncedData = {
          title,
          body_html: bodyHtml,
          tags: tags.join(", "),
          product_type: productType,
          price: mainPrice,
          compare_at_price: compareAtPrice,
          image_url: imageUrl,
          variant_count: variants.length,
          shopify_updated_at: (sp.updated_at as string) || null,
          images: imagesJson,
        };

        const existing = existingByShopifyId[shopifyId];

        if (existing) {
          if (existing.source === "local") {
            console.log(
              `[sync-from-shopify] SKIP "${title}" (${existing.id}) — source=local`
            );
            const { error: metaErr } = await supabase
              .from("products")
              .update({
                synced_at: syncTimestamp,
                shopify_synced_data: shopifySyncedData,
              })
              .eq("id", existing.id);

            if (metaErr) {
              console.error(
                `[sync-from-shopify] Error updating sync metadata for "${title}":`,
                metaErr.message
              );
            }
            skipped++;
            continue;
          }

          // Update existing shopify-sourced product (wrapped in try/catch for safety)
          let updateErr: { message: string } | null = null;
          try {
            const updatePayload = {
              title,
              description: bodyHtml
                .replace(/<[^>]*>/g, "")
                .substring(0, 500),
              description_html: bodyHtml,
              tags,
              price: mainPrice,
              compare_at_price: compareAtPrice,
              collection: productType,
              status: "success",
              image_url: imageUrl,
              images: imagesJson,
              shopify_product_id: shopifyId,
              error_message: null,
              source: "shopify",
              synced_at: syncTimestamp,
              shopify_synced_data: shopifySyncedData,
            };
            console.log(
              `[sync-from-shopify] Updating "${title}" (${existing.id}), payload keys:`,
              Object.keys(updatePayload)
            );
            const result = await supabase
              .from("products")
              .update(updatePayload)
              .eq("id", existing.id);
            updateErr = result.error;
          } catch (dbCrash) {
            const crashMsg = dbCrash instanceof Error ? dbCrash.message : String(dbCrash);
            console.error(
              `[sync-from-shopify] DB UPDATE CRASH for "${title}":`,
              crashMsg
            );
            errors.push({ shopifyId, title, error: `DB crash: ${crashMsg}` });
            continue;
          }

          if (updateErr) {
            console.error(
              `[sync-from-shopify] DB update error for "${title}":`,
              updateErr.message
            );
            errors.push({
              shopifyId,
              title,
              error: `DB update: ${updateErr.message}`,
            });
            continue;
          }

          // Replace variants safely
          try {
            await supabase
              .from("product_variants")
              .delete()
              .eq("product_id", existing.id);

            if (variants.length > 0) {
              const variantRows = variants.map(
                (v: Record<string, unknown>) => ({
                  id: `sv-${shopifyId}-${String(v.id)}`,
                  product_id: existing.id,
                  size: (v.option1 as string) || "Default",
                  color: (v.option2 as string) || "Default",
                  sku: (v.sku as string) || "",
                  price: parseFloat(String(v.price)) || 0,
                  inventory: (v.inventory_quantity as number) || 0,
                })
              );
              const { error: variantErr } = await supabase
                .from("product_variants")
                .insert(variantRows);
              if (variantErr) {
                console.error(
                  `[sync-from-shopify] Variant insert error for "${title}":`,
                  variantErr.message
                );
              }
            }
          } catch (varErr) {
            console.error(
              `[sync-from-shopify] Variant upsert crash for "${title}":`,
              varErr
            );
          }

          updated++;
        } else {
          // Insert new product (wrapped in try/catch for safety)
          const newId = `shopify-${shopifyId}`;
          let insertErr: { message: string } | null = null;
          let resultProductId = newId;
          try {
            const insertPayload = {
              id: newId,
              title,
              description: bodyHtml
                .replace(/<[^>]*>/g, "")
                .substring(0, 500),
              description_html: bodyHtml,
              tags,
              price: mainPrice,
              compare_at_price: compareAtPrice,
              collection: productType,
              status: "success",
              image_url: imageUrl,
              images: imagesJson,
              shopify_product_id: shopifyId,
              error_message: null,
              source: "shopify",
              synced_at: syncTimestamp,
              shopify_synced_data: shopifySyncedData,
              created_at:
                (sp.created_at as string) || new Date().toISOString(),
            };
            console.log(
              `[sync-from-shopify] Inserting new "${title}" (${newId}), payload keys:`,
              Object.keys(insertPayload)
            );

            // Use plain insert first; if it conflicts on shopify_product_id,
            // fall back to update by shopify_product_id
            const result = await supabase
              .from("products")
              .insert(insertPayload);

            if (result.error) {
              // Check if it's a unique constraint violation (duplicate shopify_product_id or id)
              const isDuplicate =
                result.error.message.includes("duplicate") ||
                result.error.message.includes("unique") ||
                result.error.message.includes("23505");

              if (isDuplicate) {
                console.log(
                  `[sync-from-shopify] Duplicate detected for "${title}" (shopify_product_id=${shopifyId}), falling back to update`
                );
                // Remove id from update payload to avoid PK conflict
                const { id: _removeId, created_at: _removeCreated, ...updatePayload } = insertPayload;
                const updateResult = await supabase
                  .from("products")
                  .update(updatePayload)
                  .eq("shopify_product_id", shopifyId)
                  .select("id")
                  .maybeSingle();

                insertErr = updateResult.error;
                if (updateResult.data) {
                  resultProductId = updateResult.data.id;
                }
                // If the fallback update succeeds, count as updated not created
                if (!insertErr) {
                  updated++;
                  // Handle variants for updated product
                  try {
                    await supabase
                      .from("product_variants")
                      .delete()
                      .eq("product_id", resultProductId);

                    if (variants.length > 0) {
                      const variantRows = variants.map(
                        (v: Record<string, unknown>) => ({
                          id: `sv-${shopifyId}-${String(v.id)}`,
                          product_id: resultProductId,
                          size: (v.option1 as string) || "Default",
                          color: (v.option2 as string) || "Default",
                          sku: (v.sku as string) || "",
                          price: parseFloat(String(v.price)) || 0,
                          inventory: (v.inventory_quantity as number) || 0,
                        })
                      );
                      const { error: variantErr } = await supabase
                        .from("product_variants")
                        .upsert(variantRows, { onConflict: "id" });
                      if (variantErr) {
                        console.error(
                          `[sync-from-shopify] Variant upsert error for "${title}":`,
                          variantErr.message
                        );
                      }
                    }
                  } catch (varErr) {
                    console.error(
                      `[sync-from-shopify] Variant upsert crash for "${title}":`,
                      varErr
                    );
                  }
                  continue;
                }
              } else {
                insertErr = result.error;
              }
            }
          } catch (dbCrash) {
            const crashMsg = dbCrash instanceof Error ? dbCrash.message : String(dbCrash);
            console.error(
              `[sync-from-shopify] DB INSERT CRASH for "${title}":`,
              crashMsg
            );
            errors.push({ shopifyId, title, error: `DB crash: ${crashMsg}` });
            continue;
          }

          if (insertErr) {
            console.error(
              `[sync-from-shopify] DB insert error for "${title}":`,
              insertErr.message
            );
            errors.push({
              shopifyId,
              title,
              error: `DB insert: ${insertErr.message}`,
            });
            continue;
          }

          // Insert variants for new product
          try {
            if (variants.length > 0) {
              const variantRows = variants.map(
                (v: Record<string, unknown>) => ({
                  id: `sv-${shopifyId}-${String(v.id)}`,
                  product_id: resultProductId,
                  size: (v.option1 as string) || "Default",
                  color: (v.option2 as string) || "Default",
                  sku: (v.sku as string) || "",
                  price: parseFloat(String(v.price)) || 0,
                  inventory: (v.inventory_quantity as number) || 0,
                })
              );
              const { error: variantErr } = await supabase
                .from("product_variants")
                .upsert(variantRows, { onConflict: "id" });
              if (variantErr) {
                console.error(
                  `[sync-from-shopify] Variant upsert error for "${title}":`,
                  variantErr.message
                );
              }
            }
          } catch (varErr) {
            console.error(
              `[sync-from-shopify] Variant upsert crash for "${title}":`,
              varErr
            );
          }

          created++;
        }
      } catch (productErr) {
        const sp = shopifyProduct as Record<string, unknown>;
        const shopifyId = String(sp.id);
        const title = (sp.title as string) || "Unknown";
        console.error(
          `[sync-from-shopify] Unexpected error processing "${title}":`,
          productErr
        );
        errors.push({
          shopifyId,
          title,
          error:
            productErr instanceof Error
              ? productErr.message
              : "Unknown processing error",
        });
      }
    }

    console.log(
      `[sync-from-shopify] ✅ Complete: ${created} created, ${updated} updated, ${skipped} skipped, ${errors.length} errors`
    );

    return jsonResponse({
      success: true,
      summary: {
        total_shopify: allShopifyProducts.length,
        created,
        updated,
        skipped,
        errors: errors.length,
        error_details: errors.length > 0 ? errors.slice(0, 10) : undefined,
      },
    });
  } catch (error) {
    // Top-level catch — something truly unexpected happened
    const errMsg =
      error instanceof Error ? error.message : String(error);
    const errStack =
      error instanceof Error ? error.stack : undefined;
    console.error("[sync-from-shopify] 💥 FATAL uncaught error:", errMsg);
    if (errStack) {
      console.error("[sync-from-shopify] Stack trace:", errStack);
    }
    return jsonResponse(
      {
        error: `Fatal error: ${errMsg}`,
        stack: errStack,
        hint: "Check Edge Function logs in Supabase Dashboard for full details.",
      },
      500
    );
  }
});

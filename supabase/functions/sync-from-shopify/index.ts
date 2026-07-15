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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let shopifyAccessToken = "";
    let shopifyStoreUrl = "";

    const { data: conn } = await supabase
      .from("shopify_connections")
      .select("shop_domain, access_token, connected_at")
      .eq("is_active", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conn?.access_token) shopifyAccessToken = conn.access_token;
    if (conn?.shop_domain) shopifyStoreUrl = conn.shop_domain;

    if (!shopifyAccessToken) shopifyAccessToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN") || "";
    if (!shopifyStoreUrl) shopifyStoreUrl = Deno.env.get("SHOPIFY_STORE_URL") || "";

    // Parse request body
    let bodyData: Record<string, unknown> = {};
    try { bodyData = await req.json(); } catch { /* empty body */ }

    if (!shopifyAccessToken && bodyData?.shopify_access_token) {
      shopifyAccessToken = String(bodyData.shopify_access_token);
    }
    if (!shopifyStoreUrl && bodyData?.shopify_store_url) {
      shopifyStoreUrl = String(bodyData.shopify_store_url);
    }

    if (!shopifyAccessToken || !shopifyStoreUrl) {
      return jsonResponse({
        error: "Missing Shopify credentials",
        hint: "Connect via OAuth in Settings or set SHOPIFY_ACCESS_TOKEN and SHOPIFY_STORE_URL.",
        missing_secrets: [
          ...(!shopifyAccessToken ? ["SHOPIFY_ACCESS_TOKEN"] : []),
          ...(!shopifyStoreUrl ? ["SHOPIFY_STORE_URL"] : []),
        ],
      }, 200);
    }

    const storeHost = shopifyStoreUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const shopifyApiBase = `https://${storeHost}/admin/api/2024-04`;

    // ─── Paginate all Shopify products ──────────────────────────────────
    const allShopifyProducts: Record<string, unknown>[] = [];
    let nextPageUrl: string | null = `${shopifyApiBase}/products.json?limit=250`;

    while (nextPageUrl) {
      let response: Response;
      try {
        response = await fetch(nextPageUrl, {
          headers: { "X-Shopify-Access-Token": shopifyAccessToken, "Content-Type": "application/json" },
        });
      } catch (fetchErr) {
        return jsonResponse({ error: `Network error: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}` }, 502);
      }

      if (!response.ok) {
        const errText = await response.text();
        return jsonResponse({ error: `Shopify API error (${response.status})`, detail: errText.slice(0, 300) }, 502);
      }

      const data = await response.json();
      if (Array.isArray(data.products)) allShopifyProducts.push(...data.products);

      const linkHeader = response.headers.get("link");
      nextPageUrl = null;
      if (linkHeader) {
        const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (m) nextPageUrl = m[1];
      }
    }

    console.log(`[sync-from-shopify] Fetched ${allShopifyProducts.length} products`);

    // ─── PREVIEW MODE: return list without writing to DB ────────────────
    if (bodyData?.preview_only === true) {
      const preview = allShopifyProducts.map((p: Record<string, unknown>) => {
        const variants = (p.variants as Record<string, unknown>[]) ?? [];
        const variantPrices = variants.map((v) => parseFloat(String(v.price ?? "0")) || 0);
        const minPrice = variantPrices.length ? Math.min(...variantPrices) : 0;
        const compareAt = variants.length && variants[0].compare_at_price
          ? parseFloat(String(variants[0].compare_at_price)) || null : null;
        const images = (p.images as Record<string, unknown>[]) ?? [];
        const img = images[0]?.src as string ?? null;
        const tags = ((p.tags as string) || "").split(",").map((t) => t.trim()).filter(Boolean);
        return {
          shopify_product_id: String(p.id),
          title: p.title ?? "Untitled",
          body_html: p.body_html ?? "",
          vendor: p.vendor ?? "",
          product_type: p.product_type ?? "",
          handle: p.handle ?? "",
          status: p.status ?? "active",
          published_at: p.published_at ?? null,
          image_url: img,
          images: images.map((im) => ({
            id: im.id, src: im.src, alt: im.alt || "", width: im.width, height: im.height, position: im.position,
          })),
          variants: variants.map((v) => ({
            id: v.id, title: v.title,
            option1: v.option1, option2: v.option2, option3: v.option3,
            sku: v.sku || "",
            price: parseFloat(String(v.price ?? "0")) || 0,
            compare_at_price: v.compare_at_price ? parseFloat(String(v.compare_at_price)) || null : null,
            inventory_quantity: v.inventory_quantity ?? 0,
          })),
          tags,
          price: minPrice,
          compare_at_price: compareAt,
          shopify_created_at: p.created_at ?? null,
          shopify_updated_at: p.updated_at ?? null,
          variants_count: variants.length,
        };
      });
      return jsonResponse({ products: preview, total: preview.length });
    }

    // ─── SELECTIVE IMPORT: only sync specified product IDs ───────────────
    let productIdsToImport: Set<string> | null = null;
    if (Array.isArray(bodyData?.product_ids) && (bodyData.product_ids as string[]).length > 0) {
      productIdsToImport = new Set(bodyData.product_ids as string[]);
    }

    if (allShopifyProducts.length === 0) {
      return jsonResponse({ success: true, summary: { total_shopify: 0, created: 0, updated: 0, skipped: 0, errors: 0 } });
    }

    // ─── Load existing products ──────────────────────────────────────────
    const { data: existingProducts } = await supabase
      .from("products")
      .select("id, shopify_product_id, source, synced_at");

    const existingByShopifyId: Record<string, { id: string; source: string }> = {};
    (existingProducts || []).forEach((p: { id: string; shopify_product_id: string | null; source: string; synced_at: string | null }) => {
      if (p.shopify_product_id) existingByShopifyId[p.shopify_product_id] = { id: p.id, source: p.source };
    });

    let created = 0, updated = 0, skipped = 0;
    const errors: { shopifyId: string; title: string; error: string }[] = [];
    const syncTimestamp = new Date().toISOString();

    for (const shopifyProduct of allShopifyProducts) {
      try {
        const sp = shopifyProduct as Record<string, unknown>;
        const shopifyId = String(sp.id);

        // Skip if selective import and not selected
        if (productIdsToImport !== null && !productIdsToImport.has(shopifyId)) {
          skipped++;
          continue;
        }

        const title = (sp.title as string) || "Untitled";
        const bodyHtml = (sp.body_html as string) || "";
        const tags = ((sp.tags as string) || "").split(",").map((t: string) => t.trim()).filter(Boolean);
        const productType = (sp.product_type as string) || "";
        const images = (sp.images as Record<string, unknown>[]) || [];
        const imageIdentity = (src: string) => {
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
        };
        const sortedImages = [...images].sort(
          (a, b) => (Number(a.position) || 99) - (Number(b.position) || 99),
        );
        const seenImg = new Set<string>();
        const dedupedImages: Record<string, unknown>[] = [];
        for (const img of sortedImages) {
          const src = typeof img.src === "string" ? img.src : "";
          if (!src.startsWith("http")) continue;
          const key = imageIdentity(src);
          if (seenImg.has(key)) continue;
          seenImg.add(key);
          dedupedImages.push(img);
        }
        const imageUrl = dedupedImages.length > 0 ? (dedupedImages[0].src as string) : "";
        const variants = (sp.variants as Record<string, unknown>[]) || [];
        const mainPrice = variants.length > 0 ? parseFloat(String(variants[0].price)) || 0 : 0;
        const compareAtPrice = variants.length > 0 && variants[0].compare_at_price
          ? parseFloat(String(variants[0].compare_at_price)) || null : null;

        const imagesJson = dedupedImages.map((img: Record<string, unknown>, i) => ({
          id: img.id, src: img.src, alt: img.alt || "", width: img.width, height: img.height, position: i + 1,
        }));

        const shopifySyncedData = {
          title, body_html: bodyHtml, tags: tags.join(", "), product_type: productType,
          price: mainPrice, compare_at_price: compareAtPrice, image_url: imageUrl,
          variant_count: variants.length, shopify_updated_at: (sp.updated_at as string) || null, images: imagesJson,
        };

        const existing = existingByShopifyId[shopifyId];

        if (existing) {
          if (existing.source === "local") {
            await supabase.from("products").update({ synced_at: syncTimestamp, shopify_synced_data: shopifySyncedData }).eq("id", existing.id);
            skipped++;
            continue;
          }

          const { error: updateErr } = await supabase.from("products").update({
            title, description: bodyHtml.replace(/<[^>]*>/g, "").substring(0, 500),
            description_html: bodyHtml, tags, price: mainPrice, compare_at_price: compareAtPrice,
            collection: productType, status: "success", image_url: imageUrl, images: imagesJson,
            shopify_product_id: shopifyId, error_message: null, source: "shopify",
            synced_at: syncTimestamp, shopify_synced_data: shopifySyncedData,
          }).eq("id", existing.id);

          if (updateErr) { errors.push({ shopifyId, title, error: updateErr.message }); continue; }

          await supabase.from("product_variants").delete().eq("product_id", existing.id);
          if (variants.length > 0) {
            await supabase.from("product_variants").insert(variants.map((v: Record<string, unknown>) => ({
              id: `sv-${shopifyId}-${String(v.id)}`, product_id: existing.id,
              size: (v.option1 as string) || "Default", color: (v.option2 as string) || "Default",
              sku: (v.sku as string) || "", price: parseFloat(String(v.price)) || 0,
              inventory: (v.inventory_quantity as number) || 0,
            })));
          }
          updated++;
        } else {
          const newId = `shopify-${shopifyId}`;
          const { error: insertErr } = await supabase.from("products").insert({
            id: newId, title, description: bodyHtml.replace(/<[^>]*>/g, "").substring(0, 500),
            description_html: bodyHtml, tags, price: mainPrice, compare_at_price: compareAtPrice,
            collection: productType, status: "success", image_url: imageUrl, images: imagesJson,
            shopify_product_id: shopifyId, error_message: null, source: "shopify",
            synced_at: syncTimestamp, shopify_synced_data: shopifySyncedData,
            created_at: (sp.created_at as string) || new Date().toISOString(),
          });

          if (insertErr) {
            if (insertErr.message.includes("duplicate") || insertErr.message.includes("unique") || insertErr.message.includes("23505")) {
              const { error: uErr } = await supabase.from("products").update({
                title, description: bodyHtml.replace(/<[^>]*>/g, "").substring(0, 500),
                description_html: bodyHtml, tags, price: mainPrice, collection: productType,
                status: "success", image_url: imageUrl, images: imagesJson, source: "shopify",
                synced_at: syncTimestamp, shopify_synced_data: shopifySyncedData,
              }).eq("shopify_product_id", shopifyId);
              if (uErr) { errors.push({ shopifyId, title, error: uErr.message }); continue; }
              updated++;
            } else {
              errors.push({ shopifyId, title, error: insertErr.message });
              continue;
            }
          } else {
            if (variants.length > 0) {
              await supabase.from("product_variants").upsert(variants.map((v: Record<string, unknown>) => ({
                id: `sv-${shopifyId}-${String(v.id)}`, product_id: newId,
                size: (v.option1 as string) || "Default", color: (v.option2 as string) || "Default",
                sku: (v.sku as string) || "", price: parseFloat(String(v.price)) || 0,
                inventory: (v.inventory_quantity as number) || 0,
              })), { onConflict: "id" });
            }
            created++;
          }
        }
      } catch (err) {
        const sp = shopifyProduct as Record<string, unknown>;
        errors.push({ shopifyId: String(sp.id), title: (sp.title as string) || "Unknown", error: err instanceof Error ? err.message : String(err) });
      }
    }

    return jsonResponse({
      success: true,
      summary: {
        total_shopify: allShopifyProducts.length,
        created, updated, skipped,
        errors: errors.length,
        error_details: errors.length > 0 ? errors.slice(0, 10) : undefined,
      },
    });

  } catch (error) {
    return jsonResponse({ error: `Fatal error: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
});

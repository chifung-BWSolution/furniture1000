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

/** Build Shopify-format metafields from a {"namespace.key": value} map.
 * Empty values and the reserved `shopify.*` namespace are skipped. */
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

/**
 * update-shopify-product
 *
 * Single-direction sync: system → Shopify. Updates an EXISTING Shopify product
 * (title, body_html, variant price, images) and upserts its metafields.
 *
 * POST {
 *   shopify_product_id: string,                 // required — the live Shopify product id
 *   source_product_id?: string,                 // products.id, to mirror back to shopify_products
 *   title?, body_html?, price?, compare_at_price?,
 *   images?: string[],                          // ordered image URLs (first = primary)
 *   metafields?: { "namespace.key": value }     // map matching shopify_products columns
 * }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseKey) return json({ error: "Missing env vars" }, 400);
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Shopify credentials (active connection → env fallback) ──
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

    const body = await req.json().catch(() => ({}));
    const {
      shopify_product_id: shopifyId,
      source_product_id: sourceProductId,
      title, body_html: bodyHtml,
      price, compare_at_price: compareAtPrice,
      vendor, product_type: productType, tags,
      images, metafields,
    } = body as {
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
      metafields?: Record<string, string>;
    };

    if (!shopifyId) return json({ error: "shopify_product_id is required" }, 400);

    const apiBase = `https://${shopDomain}/admin/api/2024-10`;
    const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken };

    // ── 1. Fetch the existing product to get variant ids (needed to update price) ──
    const getResp = await fetch(`${apiBase}/products/${shopifyId}.json`, { headers });
    if (!getResp.ok) {
      const t = await getResp.text();
      return json({ error: `Shopify GET failed (${getResp.status})`, detail: t.slice(0, 300) }, 502);
    }
    const existing = (await getResp.json()).product as Record<string, unknown>;
    const existingVariants = (existing.variants as Record<string, unknown>[]) || [];

    // ── 2. Build the product update payload ──
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

    // Price → applied to every variant (these products are variant-less / single variant)
    if (price != null && !isNaN(Number(price))) {
      productUpdate.variants = existingVariants.map((v) => {
        const nv: Record<string, unknown> = { id: v.id, price: Number(price).toFixed(2) };
        if (compareAtPrice != null && !isNaN(Number(compareAtPrice)) && Number(compareAtPrice) > Number(price)) {
          nv.compare_at_price = Number(compareAtPrice).toFixed(2);
        }
        return nv;
      });
    }

    // Images → replace the product image set with the supplied ordered URLs
    if (Array.isArray(images)) {
      const valid = images.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
      productUpdate.images = valid.map((src, i) => ({ src, position: i + 1 }));
    }

    const putResp = await fetch(`${apiBase}/products/${shopifyId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ product: productUpdate }),
    });
    if (!putResp.ok) {
      const t = await putResp.text();
      return json({ error: `Shopify PUT failed (${putResp.status})`, detail: t.slice(0, 400) }, 502);
    }
    const updated = (await putResp.json()).product as Record<string, unknown>;

    // ── 3. Upsert metafields (one POST each; Shopify upserts by namespace+key) ──
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
          // 422 usually means it already exists → find id and PUT to overwrite
          const existingMf = await fetch(
            `${apiBase}/products/${shopifyId}/metafields.json?namespace=${mf.namespace}&key=${mf.key}`,
            { headers }
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

    // ── 4. Mirror the new values back into shopify_products ──
    const mfColumns: Record<string, string> = {};
    for (const mf of mfs) mfColumns[`${mf.namespace}.${mf.key}`] = mf.value;
    const spUpdate: Record<string, unknown> = {
      shopify_updated_at: String(updated.updated_at || new Date().toISOString()),
      ...mfColumns,
    };
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
      spUpdate.image_url = valid[0] || null;
      spUpdate.images = valid.map((src, i) => ({ src, position: i + 1 }));
      if (mfs.length > 0) spUpdate.metafields = mfs;
    } else if (mfs.length > 0) {
      spUpdate.metafields = mfs;
    }
    await supabase.from("shopify_products").update(spUpdate).eq("shopify_product_id", shopifyId);

    return json({
      success: true,
      shopify_product_id: shopifyId,
      source_product_id: sourceProductId || null,
      metafields_updated: mfOk,
      metafields_failed: mfFail,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[update-shopify-product] Error:", msg);
    return json({ error: msg }, 500);
  }
});

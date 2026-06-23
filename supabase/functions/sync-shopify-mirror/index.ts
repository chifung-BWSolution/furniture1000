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

/**
 * sync-shopify-mirror
 *
 * Mirror reconciliation: makes shopify_products an exact reflection of the live
 * Shopify store.
 *  1. Fetch ALL products from Shopify (paginated).
 *  2. UPSERT each into shopify_products (status, title, price, images, handle…),
 *     preserving the existing row's id / source_product_id / metafield columns.
 *  3. DELETE any shopify_products row whose shopify_product_id is no longer on
 *     Shopify (product was deleted in the Shopify admin).
 *
 * POST {}  → returns { live, upserted, deleted }
 *
 * Title/price/status always reflect Shopify (source of truth for the mirror).
 * Metafield columns are NOT touched here — they are owned by the import /
 * update-shopify-product flows.
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

    const apiBase = `https://${shopDomain}/admin/api/2024-10`;
    const headers = { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" };

    // ── 1. Fetch ALL live Shopify products (paginate via Link header) ──
    // NOTE: do NOT pass status=any together with a fields= whitelist — that combo
    // returns 0 products on this API version. Omit status to get every product.
    const live: Record<string, unknown>[] = [];
    let url: string | null =
      `${apiBase}/products.json?limit=250&fields=id,title,body_html,vendor,product_type,handle,status,published_at,images,variants,tags,created_at,updated_at`;
    let fetchedPages = 0;
    while (url) {
      const r = await fetch(url, { headers });
      if (!r.ok) {
        const t = await r.text();
        return json({ error: `Shopify API error (${r.status})`, detail: t.slice(0, 300) }, 502);
      }
      const j = await r.json();
      if (Array.isArray(j.products)) live.push(...j.products);
      fetchedPages++;
      const link = r.headers.get("link") || "";
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    }

    // SAFETY GUARD: if Shopify returned zero products, do NOT delete anything —
    // a transient/auth/parameter error must never wipe the mirror. Bail out.
    if (live.length === 0) {
      return json({
        success: false,
        live: 0,
        upserted: 0,
        deleted: 0,
        error: "Shopify returned 0 products — aborting sync to protect the mirror (no rows deleted).",
      });
    }

    const liveIds = new Set(live.map((p) => String(p.id)));

    // ── 2. Load existing mirror rows to preserve id / source_product_id ──
    const { data: existingRows } = await supabase
      .from("shopify_products")
      .select("id, shopify_product_id, source_product_id");
    const existingByShopifyId = new Map<string, { id: string; source_product_id: string | null }>();
    (existingRows || []).forEach((r: { id: string; shopify_product_id: string; source_product_id: string | null }) => {
      existingByShopifyId.set(String(r.shopify_product_id), { id: r.id, source_product_id: r.source_product_id });
    });

    // ── 3. UPSERT each live product into the mirror ──
    let upserted = 0;
    const nowIso = new Date().toISOString();
    for (const p of live) {
      const sp = p as Record<string, unknown>;
      const shopifyId = String(sp.id);
      const variants = (sp.variants as Record<string, unknown>[]) ?? [];
      const prices = variants.map((v) => parseFloat(String(v.price ?? "0")) || 0);
      const minPrice = prices.length ? Math.min(...prices) : 0;
      const compareAt = variants.length && variants[0].compare_at_price
        ? parseFloat(String(variants[0].compare_at_price)) || null : null;
      const images = (sp.images as Record<string, unknown>[]) ?? [];
      const tags = ((sp.tags as string) || "").split(",").map((t) => t.trim()).filter(Boolean);
      const prev = existingByShopifyId.get(shopifyId);

      const row: Record<string, unknown> = {
        shopify_product_id: shopifyId,
        title: sp.title ?? "(未命名)",
        body_html: sp.body_html ?? null,
        vendor: sp.vendor ?? null,
        product_type: sp.product_type ?? null,
        handle: sp.handle ?? null,
        status: sp.status ?? "active",
        published_at: sp.published_at ?? null,
        image_url: (images[0]?.src as string) ?? null,
        images: images.length > 0 ? images.map((im) => ({
          id: im.id, src: im.src, alt: im.alt || "", width: im.width, height: im.height, position: im.position,
        })) : null,
        variants: variants.length > 0 ? variants : null,
        tags,
        price: minPrice,
        compare_at_price: compareAt,
        shopify_created_at: sp.created_at ?? null,
        shopify_updated_at: sp.updated_at ?? null,
        imported_at: nowIso,
        shop_domain: shopDomain,
      };
      // Preserve the stable PK + the products linkage if we already had this row.
      if (prev) {
        row.id = prev.id;
        if (prev.source_product_id) row.source_product_id = prev.source_product_id;
      }

      const { error } = await supabase
        .from("shopify_products")
        .upsert(row, { onConflict: "shopify_product_id" });
      if (!error) upserted++;
      else console.error(`[sync-shopify-mirror] upsert error ${shopifyId}:`, error.message);
    }

    // ── 4. DELETE orphan mirror rows (deleted on Shopify) ──
    let deleted = 0;
    const orphanIds = (existingRows || [])
      .map((r: { shopify_product_id: string }) => String(r.shopify_product_id))
      .filter((id) => /^\d+$/.test(id) && !liveIds.has(id)); // only numeric Shopify ids, not local placeholders
    if (orphanIds.length > 0) {
      const { error: delErr, count } = await supabase
        .from("shopify_products")
        .delete({ count: "exact" })
        .in("shopify_product_id", orphanIds);
      if (delErr) console.error("[sync-shopify-mirror] delete orphans error:", delErr.message);
      else deleted = count ?? orphanIds.length;
    }

    // ── 5. Backfill source_product_id from products.shopify_product_id ──
    // New rows (created after a wipe) have no products linkage; restore it so the
    // catalog can tell which local product each Shopify product came from.
    try {
      const { data: prodLinks } = await supabase
        .from("products")
        .select("id, shopify_product_id")
        .not("shopify_product_id", "is", null);
      const prodByShopifyId = new Map<string, string>();
      (prodLinks || []).forEach((p: { id: string; shopify_product_id: string | null }) => {
        if (p.shopify_product_id) prodByShopifyId.set(String(p.shopify_product_id), p.id);
      });
      for (const id of liveIds) {
        const prodId = prodByShopifyId.get(id);
        if (prodId) {
          await supabase
            .from("shopify_products")
            .update({ source_product_id: prodId })
            .eq("shopify_product_id", id)
            .is("source_product_id", null);
        }
      }
    } catch (e) {
      console.warn("[sync-shopify-mirror] source_product_id backfill skipped:", e instanceof Error ? e.message : String(e));
    }

    return json({ success: true, live: live.length, upserted, deleted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-shopify-mirror] Error:", msg);
    return json({ error: msg }, 500);
  }
});

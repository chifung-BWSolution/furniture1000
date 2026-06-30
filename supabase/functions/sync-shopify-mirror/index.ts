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

/** Plain text for meta description when Shopify seo.description is unset. */
function plainProductDescription(node: {
  description?: string | null;
  descriptionHtml?: string | null;
}): string | null {
  const direct = typeof node.description === "string" ? node.description.trim() : "";
  if (direct) return direct;
  const html = typeof node.descriptionHtml === "string" ? node.descriptionHtml : "";
  if (!html) return null;
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

/** Fetch SEO for ALL products via GraphQL pagination (REST omits seo fields). */
async function fetchAllProductsSeoGraphQL(
  shopDomain: string,
  token: string,
): Promise<Map<string, {
  shopify_page_title: string | null;
  shopify_page_description: string | null;
  shopify_url: string | null;
}>> {
  const out = new Map<string, {
    shopify_page_title: string | null;
    shopify_page_description: string | null;
    shopify_url: string | null;
  }>();
  let cursor: string | null = null;
  const gqlHeaders = { "Content-Type": "application/json", "X-Shopify-Access-Token": token };

  for (;;) {
    const resp = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: gqlHeaders,
      body: JSON.stringify({
        query: `query productsSeo($cursor: String) {
          products(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              title
              handle
              description
              descriptionHtml
              seo { title description }
            }
          }
        }`,
        variables: { cursor },
      }),
    });
    if (!resp.ok) {
      console.error("[sync-shopify-mirror] SEO GraphQL error:", resp.status, (await resp.text()).slice(0, 200));
      break;
    }
    const j = await resp.json();
    if (j?.errors?.length) {
      console.error("[sync-shopify-mirror] SEO GraphQL errors:", JSON.stringify(j.errors).slice(0, 300));
      break;
    }
    const conn = j?.data?.products;
    const nodes = conn?.nodes ?? [];
    for (const node of nodes) {
      const gid = String(node?.id ?? "");
      const shopifyId = gid.replace("gid://shopify/Product/", "");
      if (!/^\d+$/.test(shopifyId)) continue;
      const seo = node?.seo ?? {};
      const handle = typeof node?.handle === "string" && node.handle.trim() ? node.handle.trim() : null;
      const productTitle = typeof node?.title === "string" && node.title.trim() ? node.title.trim() : null;
      const seoTitle = typeof seo.title === "string" && seo.title.trim() ? seo.title.trim() : null;
      const seoDesc = typeof seo.description === "string" && seo.description.trim() ? seo.description.trim() : null;
      const fallbackDesc = plainProductDescription(node);
      out.set(shopifyId, {
        shopify_page_title: seoTitle || productTitle,
        // Shopify Admin shows product description in Meta description when seo.description is unset.
        shopify_page_description: seoDesc || fallbackDesc,
        shopify_url: handle,
      });
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }
  return out;
}

/** Apply SEO map to shopify_products mirror rows (parallel batches). */
async function applySeoBackfill(
  supabase: ReturnType<typeof createClient>,
  seoMap: Map<string, {
    shopify_page_title: string | null;
    shopify_page_description: string | null;
    shopify_url: string | null;
  }>,
  opts?: { fillOnlyNull?: boolean },
): Promise<number> {
  let updated = 0;
  const entries = Array.from(seoMap.entries());
  const BATCH = 20;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    await Promise.all(batch.map(async ([shopifyId, seo]) => {
      if (opts?.fillOnlyNull) {
        const { data: row, error: fetchErr } = await supabase
          .from("shopify_products")
          .select("shopify_page_title, shopify_page_description, shopify_url")
          .eq("shopify_product_id", shopifyId)
          .maybeSingle();
        if (fetchErr || !row) return;
        const patch: Record<string, string> = {};
        const curTitle = (row.shopify_page_title as string | null)?.trim();
        const curDesc = (row.shopify_page_description as string | null)?.trim();
        const curUrl = (row.shopify_url as string | null)?.trim();
        if (!curTitle && seo.shopify_page_title) patch.shopify_page_title = seo.shopify_page_title;
        if (!curDesc && seo.shopify_page_description) patch.shopify_page_description = seo.shopify_page_description;
        if (!curUrl && seo.shopify_url) patch.shopify_url = seo.shopify_url;
        if (Object.keys(patch).length === 0) return;
        const { error } = await supabase
          .from("shopify_products")
          .update(patch)
          .eq("shopify_product_id", shopifyId);
        if (!error) updated++;
        else console.error(`[sync-shopify-mirror] SEO fill ${shopifyId}:`, error.message);
        return;
      }
      const { error } = await supabase
        .from("shopify_products")
        .update(seo)
        .eq("shopify_product_id", shopifyId);
      if (!error) updated++;
      else console.error(`[sync-shopify-mirror] SEO update ${shopifyId}:`, error.message);
    }));
  }
  return updated;
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
 * POST { backfill_seo?: boolean }  → SEO-only backfill (no mirror reconcile)
 * POST {}                          → full mirror + SEO backfill
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

    let body: { backfill_seo?: boolean } = {};
    try { body = await req.json(); } catch { /* empty body */ }

    // ── SEO-only mode: pull Page title / Meta description / URL handle for all products ──
    if (body.backfill_seo) {
      const seoMap = await fetchAllProductsSeoGraphQL(shopDomain, shopifyToken);
      const seoBackfilled = await applySeoBackfill(supabase, seoMap);
      return json({
        success: true,
        mode: "backfill_seo",
        shopify_products_fetched: seoMap.size,
        seo_backfilled: seoBackfilled,
      });
    }

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
        shopify_url: sp.handle ?? null,
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

    // ── 6. Backfill SEO for ALL live Shopify products (Page title, Meta description, URL handle) ──
    let seoBackfilled = 0;
    try {
      const seoMap = await fetchAllProductsSeoGraphQL(shopDomain, shopifyToken);
      seoBackfilled = await applySeoBackfill(supabase, seoMap, { fillOnlyNull: true });
    } catch (e) {
      console.warn("[sync-shopify-mirror] SEO backfill skipped:", e instanceof Error ? e.message : String(e));
    }

    return json({ success: true, live: live.length, upserted, deleted, seo_backfilled: seoBackfilled });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-shopify-mirror] Error:", msg);
    return json({ error: msg }, 500);
  }
});

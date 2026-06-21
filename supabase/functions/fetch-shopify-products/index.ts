import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

/** Fetch all metafields for a single product (handles pagination) */
async function fetchProductMetafields(
  shopDomain: string,
  shopifyToken: string,
  productId: string
): Promise<Record<string, unknown>[]> {
  const metafields: Record<string, unknown>[] = [];
  let pageInfo: string | null = null;
  do {
    let url = `https://${shopDomain}/admin/api/2024-01/products/${productId}/metafields.json?limit=250`;
    if (pageInfo) url += `&page_info=${pageInfo}`;
    const resp = await fetch(url, { headers: { "X-Shopify-Access-Token": shopifyToken } });
    if (!resp.ok) break;
    const data = await resp.json();
    metafields.push(...(data.metafields ?? []));
    const linkHeader = resp.headers.get("Link") ?? "";
    const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^>&"]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
  } while (pageInfo);
  return metafields;
}

/** Known product metafield definitions → DB column "namespace.key".
 * Each Shopify metafield is stored both in the raw `metafields` jsonb
 * AND mapped to its dedicated column for easy matching / upload. */
const METAFIELD_COLUMNS = new Set<string>([
  "my_fields.recommend_size",
  "my_fields.normal_size",
  "my_fields.materials",
  "my_fields.production_time",
  "my_fields.more_recommend_size",
  "my_fields.image_alt",
  "my_fields.image_link",
  "my_fields.video_link",
  "custom.more_image_link_1",
  "custom.more_image_alt_1",
  "custom.more_image_link_2",
  "custom.more_image_alt_2",
  "custom.more_image_link_3",
  "custom.more_image_alt_3",
  "custom.more_image_link_4",
  "custom.more_image_alt_4",
  "shopify.color-pattern",
]);

/** Build a {column: value} map from a raw metafields array,
 * keeping only keys we have dedicated columns for. */
function mapMetafieldsToColumns(
  mfs: Record<string, unknown>[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const mf of mfs) {
    const ns = String(mf.namespace ?? "");
    const key = String(mf.key ?? "");
    const col = `${ns}.${key}`;
    if (METAFIELD_COLUMNS.has(col)) {
      out[col] = mf.value != null ? String(mf.value) : "";
    }
  }
  return out;
}

/** Fetch specific products by IDs */
async function fetchProductsByIds(
  shopDomain: string,
  shopifyToken: string,
  ids: string[]
): Promise<Record<string, unknown>[]> {
  const products: Record<string, unknown>[] = [];
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const idsParam = chunk.join(",");
    const url = `https://${shopDomain}/admin/api/2024-01/products.json?limit=250&ids=${idsParam}&fields=id,title,body_html,vendor,product_type,handle,status,published_at,images,variants,tags,options,created_at,updated_at`;
    const resp = await fetch(url, { headers: { "X-Shopify-Access-Token": shopifyToken } });
    if (!resp.ok) continue;
    const data = await resp.json();
    products.push(...(data.products ?? []));
  }
  return products;
}

/**
 * fetch-shopify-products
 *
 * Mode 1 (preview):          POST {} — list all products (no DB write)
 * Mode 2 (import):           POST { import: true, product_ids: [...] } — import basic data
 * Mode 3 (sync_metafields):  POST { sync_metafields: true, product_ids: [...] } — update metafields only
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
    const shopDomain = (conn?.shop_domain || Deno.env.get("SHOPIFY_STORE_URL") || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

    if (!shopifyToken || !shopDomain) {
      return json({ error: "Shopify credentials not configured." }, 400);
    }

    let body: { import?: boolean; sync_metafields?: boolean; product_ids?: string[] } = {};
    try { body = await req.json(); } catch { /* no body */ }

    // ── MODE 3: Sync metafields only (call after import) ──────────────────
    if (body.sync_metafields) {
      const ids = body.product_ids ?? [];
      if (ids.length === 0) return json({ error: "No product_ids" }, 400);

      let updated = 0;
      let totalMfs = 0;
      const CONCURRENCY = 3;
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = ids.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (pid) => {
          const mfs = await fetchProductMetafields(shopDomain, shopifyToken, pid);
          // Map known metafields to their dedicated namespace.key columns
          const colValues = mapMetafieldsToColumns(mfs);
          const { error } = await supabase
            .from("shopify_products")
            .update({ metafields: mfs, ...colValues })
            .eq("shopify_product_id", pid);
          if (!error) { updated++; totalMfs += mfs.length; }
          else console.error(`[metafields] update error for ${pid}:`, error.message);
        }));
      }
      return json({ success: true, updated, total_metafields: totalMfs });
    }

    // ── MODE 2: Import basic product data ─────────────────────────────────
    if (body.import) {
      const selectedIds = body.product_ids ?? [];
      if (selectedIds.length === 0) return json({ error: "No product_ids provided" }, 400);

      console.log(`[fetch-shopify-products] Fetching ${selectedIds.length} products by ID...`);
      const toImport = await fetchProductsByIds(shopDomain, shopifyToken, selectedIds);
      if (toImport.length === 0) return json({ error: "No matching products found" }, 400);

      const rows = toImport.map((p: Record<string, unknown>) => {
        const variants = (p.variants as any[]) ?? [];
        const minPrice = variants.length
          ? Math.min(...variants.map((v) => parseFloat(v.price ?? "0") || 0)) : 0;
        const compareAt = variants.length
          ? Math.max(...variants.map((v) => parseFloat(v.compare_at_price ?? "0") || 0)) : 0;
        const img = (p.images as any[])?.[0]?.src ?? null;
        const tags = typeof p.tags === "string"
          ? (p.tags as string).split(",").map((t: string) => t.trim()).filter(Boolean) : [];
        return {
          shopify_product_id: String(p.id),
          title: (p.title as string) ?? "Untitled",
          body_html: (p.body_html as string) ?? null,
          vendor: (p.vendor as string) ?? null,
          product_type: (p.product_type as string) ?? null,
          handle: (p.handle as string) ?? null,
          status: (p.status as string) ?? "active",
          published_at: p.published_at ? new Date(p.published_at as string).toISOString() : null,
          image_url: img,
          images: p.images ?? [],
          variants,
          options: p.options ?? [],
          tags,
          price: minPrice || null,
          compare_at_price: compareAt || null,
          shopify_created_at: p.created_at ? new Date(p.created_at as string).toISOString() : null,
          shopify_updated_at: p.updated_at ? new Date(p.updated_at as string).toISOString() : null,
          imported_at: new Date().toISOString(),
          shop_domain: shopDomain,
        };
      });

      let imported = 0;
      const CHUNK = 50;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase
          .from("shopify_products")
          .upsert(rows.slice(i, i + CHUNK), { onConflict: "shopify_product_id" });
        if (!error) imported += rows.slice(i, i + CHUNK).length;
        else console.error(`[fetch-shopify-products] Upsert error:`, error.message);
      }

      return json({
        success: true,
        message: `已導入 ${imported} 件產品`,
        imported,
        total_selected: toImport.length,
        shop_domain: shopDomain,
        // Tell client to call sync_metafields next
        metafields_pending: true,
        product_ids: toImport.map((p: any) => String(p.id)),
      });
    }

    // ── MODE 1: Preview all products ──────────────────────────────────────
    const allProducts: Record<string, unknown>[] = [];
    let pageInfo: string | null = null;
    let page = 0;
    const MAX_PAGES = 25;

    do {
      page++;
      let url = `https://${shopDomain}/admin/api/2024-01/products.json?limit=250&fields=id,title,vendor,product_type,status,published_at,images,variants`;
      if (pageInfo) url += `&page_info=${pageInfo}`;

      const resp = await fetch(url, { headers: { "X-Shopify-Access-Token": shopifyToken } });
      if (!resp.ok) {
        const errText = await resp.text();
        return json({ error: `Shopify API error: ${resp.status}`, detail: errText.slice(0, 200) }, 502);
      }

      const data = await resp.json();
      allProducts.push(...(data.products ?? []));

      const linkHeader = resp.headers.get("Link") ?? "";
      const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^>&"]+)[^>]*>;\s*rel="next"/);
      pageInfo = nextMatch ? nextMatch[1] : null;
    } while (pageInfo && page < MAX_PAGES);

    const preview = allProducts.map((p: Record<string, unknown>) => {
      const variants = (p.variants as any[]) ?? [];
      const minPrice = variants.length
        ? Math.min(...variants.map((v) => parseFloat(v.price ?? "0") || 0)) : 0;
      const img = (p.images as any[])?.[0]?.src ?? null;
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

    return json({ products: preview, total: preview.length, shop_domain: shopDomain });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[fetch-shopify-products] Unexpected error:", msg);
    return json({ error: msg }, 500);
  }
});

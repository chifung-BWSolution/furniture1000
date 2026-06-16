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

/** Fetch all metafields for a single product via REST API (handles pagination) */
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

    const resp = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": shopifyToken,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      console.error(`[fetch-shopify-products] Metafields error for product ${productId}: ${resp.status}`);
      break;
    }

    const data = await resp.json();
    metafields.push(...(data.metafields ?? []));

    const linkHeader = resp.headers.get("Link") ?? "";
    const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^>&"]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch ? nextMatch[1] : null;
  } while (pageInfo);

  return metafields;
}

/**
 * fetch-shopify-products
 *
 * Mode 1 (preview): POST {} — fetch all products from Shopify, return list (no DB write)
 * Mode 2 (import):  POST { import: true, product_ids: string[] } — save selected products to shopify_products table
 *                   Includes all metafields for each imported product.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseKey) return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 400);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Resolve Shopify credentials from shopify_connections
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
      return json({ error: "Shopify credentials not configured. Please connect via OAuth in Settings." }, 400);
    }

    // Parse request body
    let body: { import?: boolean; product_ids?: string[] } = {};
    try { body = await req.json(); } catch { /* no body */ }

    // ── Fetch all products from Shopify ──────────────────────────────────
    const allProducts: Record<string, unknown>[] = [];
    let pageInfo: string | null = null;
    let page = 0;
    const MAX_PAGES = 25; // safety cap: 250 products/page × 25 = 6250

    do {
      page++;
      let url = `https://${shopDomain}/admin/api/2024-01/products.json?limit=250&fields=id,title,body_html,vendor,product_type,handle,status,published_at,images,variants,tags,options,created_at,updated_at`;
      if (pageInfo) url += `&page_info=${pageInfo}`;

      const resp = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": shopifyToken,
          "Content-Type": "application/json",
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[fetch-shopify-products] Shopify API error ${resp.status}:`, errText.slice(0, 300));
        return json({ error: `Shopify API error: ${resp.status}`, detail: errText.slice(0, 200) }, 502);
      }

      const data = await resp.json();
      allProducts.push(...(data.products ?? []));

      // Pagination via Link header
      const linkHeader = resp.headers.get("Link") ?? "";
      const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^>&"]+)[^>]*>;\s*rel="next"/);
      pageInfo = nextMatch ? nextMatch[1] : null;
    } while (pageInfo && page < MAX_PAGES);

    console.log(`[fetch-shopify-products] Fetched ${allProducts.length} products from ${shopDomain}`);

    // ── MODE 1: Preview only — return product list ───────────────────────
    if (!body.import) {
      const preview = allProducts.map((p: Record<string, unknown>) => {
        const variants = (p.variants as any[]) ?? [];
        const minPrice = variants.length
          ? Math.min(...variants.map((v) => parseFloat(v.price ?? "0") || 0))
          : 0;
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
    }

    // ── MODE 2: Import selected products to shopify_products table ───────
    const selectedIds = new Set<string>(body.product_ids ?? []);
    const toImport = selectedIds.size > 0
      ? allProducts.filter((p: Record<string, unknown>) => selectedIds.has(String(p.id)))
      : allProducts;

    if (toImport.length === 0) {
      return json({ error: "No matching products found to import" }, 400);
    }

    // Fetch metafields for each product to import (concurrency limited to 5 at a time)
    console.log(`[fetch-shopify-products] Fetching metafields for ${toImport.length} products...`);
    const metafieldsMap = new Map<string, Record<string, unknown>[]>();

    const CONCURRENCY = 5;
    for (let i = 0; i < toImport.length; i += CONCURRENCY) {
      const batch = toImport.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (p) => {
          const pid = String(p.id);
          const mfs = await fetchProductMetafields(shopDomain, shopifyToken, pid);
          return { pid, mfs };
        })
      );
      for (const { pid, mfs } of results) {
        metafieldsMap.set(pid, mfs);
        if (mfs.length > 0) {
          console.log(`[fetch-shopify-products] Product ${pid}: ${mfs.length} metafields`);
        }
      }
    }

    const rows = toImport.map((p: Record<string, unknown>) => {
      const variants = (p.variants as any[]) ?? [];
      const minPrice = variants.length
        ? Math.min(...variants.map((v) => parseFloat(v.price ?? "0") || 0))
        : 0;
      const compareAt = variants.length
        ? Math.max(...variants.map((v) => parseFloat(v.compare_at_price ?? "0") || 0))
        : 0;
      const img = (p.images as any[])?.[0]?.src ?? null;
      const tags = typeof p.tags === "string"
        ? (p.tags as string).split(",").map((t: string) => t.trim()).filter(Boolean)
        : [];
      const pid = String(p.id);
      const metafields = metafieldsMap.get(pid) ?? [];

      return {
        shopify_product_id: pid,
        title: (p.title as string) ?? "Untitled",
        body_html: (p.body_html as string) ?? null,
        vendor: (p.vendor as string) ?? null,
        product_type: (p.product_type as string) ?? null,
        handle: (p.handle as string) ?? null,
        status: (p.status as string) ?? "active",
        published_at: p.published_at ? new Date(p.published_at as string).toISOString() : null,
        image_url: img,
        images: p.images ?? [],
        variants: variants,
        options: p.options ?? [],
        tags,
        price: minPrice || null,
        compare_at_price: compareAt || null,
        shopify_created_at: p.created_at ? new Date(p.created_at as string).toISOString() : null,
        shopify_updated_at: p.updated_at ? new Date(p.updated_at as string).toISOString() : null,
        imported_at: new Date().toISOString(),
        shop_domain: shopDomain,
        metafields: metafields.length > 0 ? metafields : null,
      };
    });

    // Batch upsert in chunks of 50
    let imported = 0;
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const { error: upsertErr } = await supabase
        .from("shopify_products")
        .upsert(batch, { onConflict: "shopify_product_id" });
      if (upsertErr) {
        console.error(`[fetch-shopify-products] Upsert error batch ${Math.floor(i/CHUNK)+1}:`, upsertErr.message);
      } else {
        imported += batch.length;
      }
    }

    const totalMetafields = [...metafieldsMap.values()].reduce((sum, mfs) => sum + mfs.length, 0);

    return json({
      success: true,
      message: `已導入 ${imported} 件產品至 shopify_products（共 ${totalMetafields} 個 metafield）`,
      imported,
      total_selected: toImport.length,
      total_metafields: totalMetafields,
      shop_domain: shopDomain,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[fetch-shopify-products] Unexpected error:", msg);
    return json({ error: msg }, 500);
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type VariantSpec = {
  size: string;
  price: number | string;
  sku: string;
  /** Mirror / Shopify product id this variant came from */
  shopify_product_id: string;
  /** Existing Shopify variant id when updating the parent row */
  variant_id?: number | string;
};

type MergeBody = {
  parent_shopify_product_id: string;
  parent_sku: string;
  variants: VariantSpec[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

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

    const body = await req.json().catch(() => ({})) as MergeBody;
    const parentId = String(body.parent_shopify_product_id || "").trim();
    const parentSku = String(body.parent_sku || "").trim();
    const specs = Array.isArray(body.variants) ? body.variants : [];

    if (!/^\d+$/.test(parentId) || !parentSku || specs.length < 2) {
      return json({ error: "parent_shopify_product_id, parent_sku, and variants (>=2) are required" }, 400);
    }

    const apiBase = `https://${shopDomain}/admin/api/2024-10`;
    const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken };

    const getResp = await fetch(`${apiBase}/products/${parentId}.json`, { headers });
    if (!getResp.ok) {
      const t = await getResp.text();
      return json({ error: `Shopify GET parent failed (${getResp.status}): ${t.slice(0, 200)}` }, 502);
    }
    const existing = (await getResp.json()).product as Record<string, unknown>;
    const existingVariants = (existing.variants as Record<string, unknown>[]) || [];

    const shopifyVariants = specs.map((spec, index) => {
      const price = Number(spec.price);
      const row: Record<string, unknown> = {
        option1: spec.size,
        price: Number.isFinite(price) ? price.toFixed(2) : "0.00",
        sku: spec.sku,
        inventory_management: "shopify",
        inventory_quantity: 1000,
        requires_shipping: true,
      };
      const isParentRow = String(spec.shopify_product_id) === parentId;
      const vid = isParentRow
        ? (spec.variant_id ?? (index === 0 ? existingVariants[0]?.id : undefined))
        : undefined;
      if (vid != null) row.id = Number(vid);
      return row;
    });

    const childProductIds = [...new Set(
      specs
        .map((s) => String(s.shopify_product_id))
        .filter((id) => id !== parentId && /^\d+$/.test(id)),
    )];

    // Remove duplicate standalone products first so variant SKUs are free store-wide.
    const deletedOnShopify: string[] = [];
    const deleteErrors: { shopify_product_id: string; error: string }[] = [];
    for (const childId of childProductIds) {
      const delResp = await fetch(`${apiBase}/products/${childId}.json`, { method: "DELETE", headers });
      if (delResp.ok) {
        deletedOnShopify.push(childId);
      } else {
        const t = await delResp.text();
        deleteErrors.push({ shopify_product_id: childId, error: t.slice(0, 200) });
      }
    }
    if (deleteErrors.length > 0) {
      return json({ error: "Failed to delete child products before merge", delete_errors: deleteErrors }, 502);
    }

    const putResp = await fetch(`${apiBase}/products/${parentId}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        product: {
          id: Number(parentId),
          options: [{ name: "尺寸(mm)" }],
          variants: shopifyVariants,
        },
      }),
    });
    if (!putResp.ok) {
      const t = await putResp.text();
      return json({ error: `Shopify PUT parent failed (${putResp.status}): ${t.slice(0, 300)}` }, 502);
    }
    const updated = (await putResp.json()).product as Record<string, unknown>;
    const mergedVariants = (updated.variants as Record<string, unknown>[]) || [];
    const prices = mergedVariants.map((v) => parseFloat(String(v.price ?? "0")) || 0);
    const minPrice = prices.length ? Math.min(...prices) : null;

    await supabase
      .from("shopify_products")
      .update({
        variants: mergedVariants,
        options: [{ name: "尺寸(mm)" }],
        sku: parentSku,
        price: minPrice,
        configurable: null,
        shopify_updated_at: String(updated.updated_at || new Date().toISOString()),
      })
      .eq("shopify_product_id", parentId);

    for (const childId of childProductIds) {
      const childSpec = specs.find((s) => String(s.shopify_product_id) === childId);
      await supabase
        .from("shopify_products")
        .update({
          configurable: parentSku,
          status: "archived",
          sku: childSpec?.sku ?? null,
        })
        .eq("shopify_product_id", childId);
    }

    return json({
      success: true,
      parent_shopify_product_id: parentId,
      parent_sku: parentSku,
      variant_count: mergedVariants.length,
      deleted_on_shopify: deletedOnShopify,
      delete_errors: deleteErrors,
      variants: mergedVariants.map((v) => ({ id: v.id, sku: v.sku, option1: v.option1, price: v.price })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[merge-shopify-product-variants]", msg);
    return json({ error: msg }, 500);
  }
});

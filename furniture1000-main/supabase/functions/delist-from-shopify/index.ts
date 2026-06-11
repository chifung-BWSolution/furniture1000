import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders, status: 200 });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body = await req.json() as { shopify_product_ids: string[] };
    const { shopify_product_ids } = body;

    if (!shopify_product_ids || !Array.isArray(shopify_product_ids) || shopify_product_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "Expected { shopify_product_ids: string[] } with at least one ID." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Fetch active Shopify connection
    const { data: conn, error: connErr } = await supabase
      .from("shopify_connections")
      .select("shop_domain, access_token")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connErr || !conn?.access_token) {
      return new Response(
        JSON.stringify({ error: "No active Shopify connection found in shopify_connections table." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const storeHost = conn.shop_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const shopifyApiBase = `https://${storeHost}/admin/api/2024-10`;

    const results: { shopify_product_id: string; success: boolean; error?: string }[] = [];

    for (const shopifyId of shopify_product_ids) {
      try {
        // Archive product in Shopify (status: archived = 下架)
        const res = await fetch(`${shopifyApiBase}/products/${shopifyId}.json`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": conn.access_token,
          },
          body: JSON.stringify({ product: { id: shopifyId, status: "archived" } }),
        });

        const data = await res.json();

        if (!res.ok) {
          console.error(`[delist-from-shopify] ❌ Shopify error for ${shopifyId}:`, JSON.stringify(data));
          results.push({ shopify_product_id: shopifyId, success: false, error: JSON.stringify(data.errors || data) });
          continue;
        }

        // Update shopify_products mirror table
        await supabase
          .from("shopify_products")
          .update({ status: "archived" })
          .eq("shopify_product_id", shopifyId);

        console.log(`[delist-from-shopify] ✅ Archived Shopify product ${shopifyId}`);
        results.push({ shopify_product_id: shopifyId, success: true });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[delist-from-shopify] 💥 Error for ${shopifyId}:`, msg);
        results.push({ shopify_product_id: shopifyId, success: false, error: msg });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return new Response(
      JSON.stringify({ success: true, results, summary: { total: results.length, success: successCount, errors: results.length - successCount } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[delist-from-shopify] Unhandled error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

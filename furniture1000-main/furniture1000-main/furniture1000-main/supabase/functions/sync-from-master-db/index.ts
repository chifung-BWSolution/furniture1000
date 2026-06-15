import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MASTER_SUPABASE_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const masterServiceKey = Deno.env.get("MASTER_SERVICE_ROLE_KEY");
    if (!masterServiceKey) {
      return new Response(
        JSON.stringify({
          error: "MASTER_SERVICE_ROLE_KEY not configured",
          hint: "Add the service role key for project kqwktnplkqucsbasyfjl in Edge Function Secrets",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const masterClient = createClient(MASTER_SUPABASE_URL, masterServiceKey, {
      auth: { persistSession: false },
    });

    // Parse optional filters from request body
    const body = await req.json().catch(() => ({}));
    const { master_ids, factory_id, limit = 500 } = body;

    // Build query
    let query = masterClient
      .from("bwf_product_master")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    // Optional filters
    if (master_ids && Array.isArray(master_ids) && master_ids.length > 0) {
      query = query.in("id", master_ids);
    }
    if (factory_id) {
      query = query.eq("factory_name", factory_id);
    }

    const { data: masterProducts, error: fetchError } = await query;

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch from master: ${fetchError.message}` }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    if (!masterProducts || masterProducts.length === 0) {
      return new Response(
        JSON.stringify({ products: [], count: 0, message: "No products found in master DB" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Map master DB fields to the format the local products table expects
    // bwf_product_master columns: id, title, category, factory_name, image_url, description,
    // material, dimension_l_mm, dimension_w_mm, dimension_h_mm, cost_price, sale_price,
    // shopify_price, shopify_compare_at_price, delivery_days, shopify_id, created_at,
    // images, production_date, shipping_days, shipping_fee, remarks, production_lead_time,
    // total_lead_time, lifestyle_image_url
    const mappedProducts = masterProducts.map((mp: any) => ({
      master_id: mp.id,
      title: mp.title || "",
      description: mp.description || "",
      description_html: mp.description || "",
      tags: mp.category ? [mp.category] : [],
      price: mp.shopify_price ?? mp.sale_price ?? 0,
      compare_at_price: mp.shopify_compare_at_price ?? null,
      collection: mp.category || "",
      image_url: mp.image_url || "",
      images: mp.images || [],
      factory_id: mp.factory_name || "",
      factories_display_name: mp.factory_name || "",
      cost_price: mp.cost_price ?? null,
      production_date: mp.production_lead_time ?? null,
      shipping_days: mp.shipping_days ?? mp.delivery_days ?? null,
      shipping_fee: mp.shipping_fee ?? null,
      total_lead_time: mp.total_lead_time ?? null,
      remarks: mp.remarks || "",
      color: mp.color || "",
      material: mp.material || "",
      dimension_l_mm: mp.dimension_l_mm ?? null,
      dimension_w_mm: mp.dimension_w_mm ?? null,
      dimension_h_mm: mp.dimension_h_mm ?? null,
      lifestyle_image_url: mp.lifestyle_image_url || null,
      delivery_term_id: mp.delivery_term_id || null,
      delivery_term_name: mp.delivery_term_name || null,
      created_at: mp.created_at,
    }));

    return new Response(
      JSON.stringify({
        products: mappedProducts,
        count: mappedProducts.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

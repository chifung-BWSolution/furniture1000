import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    const body = await req.json();
    const { master_id, product } = body;

    if (!master_id) {
      return new Response(
        JSON.stringify({ error: "master_id is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (!product || typeof product !== "object") {
      return new Response(
        JSON.stringify({ error: "product object is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    console.log(
      `[update-master-db] Updating master_id: ${master_id} with product: "${product.title}"`
    );

    // Build the update row — only include fields that are provided
    const row: Record<string, unknown> = {};

    if (product.title !== undefined) row.title = product.title;
    if (product.description !== undefined) row.description = product.description;
    if (product.category !== undefined) row.category = product.category;
    if (product.factory_name !== undefined) row.factory_name = product.factory_name;
    if (product.factory_id !== undefined) row.factory_id = product.factory_id;
    if (product.image_url !== undefined) row.image_url = product.image_url;
    if (product.material !== undefined) row.material = product.material;
    if (product.dimension_l_mm !== undefined) row.dimension_l_mm = product.dimension_l_mm;
    if (product.dimension_w_mm !== undefined) row.dimension_w_mm = product.dimension_w_mm;
    if (product.dimension_h_mm !== undefined) row.dimension_h_mm = product.dimension_h_mm;
    if (product.cost_price !== undefined) row.cost_price = product.cost_price;
    if (product.sale_price !== undefined) row.sale_price = product.sale_price;
    if (product.shopify_price !== undefined) row.shopify_price = product.shopify_price;
    if (product.shopify_compare_at_price !== undefined) row.shopify_compare_at_price = product.shopify_compare_at_price;
    if (product.delivery_days !== undefined) row.delivery_days = product.delivery_days;
    if (product.production_lead_time !== undefined) row.production_lead_time = product.production_lead_time;
    if (product.shipping_days !== undefined) row.shipping_days = product.shipping_days;
    if (product.shipping_fee !== undefined) row.shipping_fee = product.shipping_fee;
    if (product.remarks !== undefined) row.remarks = product.remarks;
    if (product.color !== undefined) row.color = product.color;
    if (product.delivery_term_id !== undefined) row.delivery_term_id = product.delivery_term_id;
    if (product.delivery_term_name !== undefined) row.delivery_term_name = product.delivery_term_name;
    if (product.lifestyle_image_url !== undefined) row.lifestyle_image_url = product.lifestyle_image_url;
    if (product.images !== undefined) row.images = product.images;
    if (product.images !== undefined && Array.isArray(product.images) && product.images.length > 0) {
      row.image_url = product.images[0].src || product.images[0].url || null;
    }

    // Auto-calculate total_lead_time
    const prodLead = product.production_lead_time ?? null;
    const shipDays = product.shipping_days ?? null;
    if (prodLead != null && shipDays != null) {
      row.total_lead_time = prodLead + shipDays;
    } else if (prodLead != null) {
      row.total_lead_time = prodLead;
    } else if (shipDays != null) {
      row.total_lead_time = shipDays;
    }

    if (Object.keys(row).length === 0) {
      return new Response(
        JSON.stringify({ error: "No fields to update" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { data, error } = await masterClient
      .from("bwf_product_master")
      .update(row)
      .eq("id", master_id)
      .select("id")
      .single();

    if (error) {
      console.error(
        `[update-master-db] Error updating "${product.title}":`,
        error.message
      );
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(
      `[update-master-db] Success: "${product.title}" → master ID: ${data?.id}`
    );

    return new Response(
      JSON.stringify({ success: true, master_id: data?.id }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[update-master-db] Fatal error:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

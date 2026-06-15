import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MASTER_SUPABASE_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

// Validate if a string is a proper UUID format
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str
  );
}

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

    let body: any;
    try {
      body = await req.json();
    } catch (parseErr: any) {
      console.error("[upload-to-master-db] Request body parse error:", parseErr.message);
      return new Response(
        JSON.stringify({
          error: "Failed to parse request body — payload may be too large",
          detail: parseErr.message,
          hint: "Try sending fewer products per chunk or reducing image sizes",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const products = body.products;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return new Response(
        JSON.stringify({ error: "No products provided" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    console.log(
      `[upload-to-master-db] Upserting ${products.length} products to bwf_product_master`
    );
    // Log the first product payload for debugging schema mismatches
    if (products.length > 0) {
      console.log(
        `[upload-to-master-db] Sample payload (first item):`,
        JSON.stringify(products[0], null, 2)
      );
    }

    const results: {
      local_id: string;
      success: boolean;
      master_id?: string;
      error?: string;
    }[] = [];

    for (const p of products) {
      try {
        // Validate factory_id: must be a valid UUID or null (never empty string)
        let factoryId: string | null = p.factory_id || null;
        if (factoryId && !isValidUUID(factoryId)) {
          console.warn(
            `[upload-to-master-db] Invalid factory_id "${factoryId}" for "${p.title}" — setting to null`
          );
          factoryId = null;
        }

        // Ensure numeric fields are actually numbers (not strings)
        const toInt = (v: unknown): number | null => {
          if (v === null || v === undefined || v === '') return null;
          const n = typeof v === 'number' ? v : parseInt(String(v), 10);
          return isNaN(n) ? null : n;
        };
        const toFloat = (v: unknown): number | null => {
          if (v === null || v === undefined || v === '') return null;
          const n = typeof v === 'number' ? v : parseFloat(String(v));
          return isNaN(n) ? null : n;
        };

        // Validate and sanitize image_url: must be a valid URL or data URI, max 2MB
        const MAX_IMAGE_TEXT_LEN = 2_000_000; // 2MB max for text column
        const sanitizeImageUrl = (v: unknown): string | null => {
          if (!v || typeof v !== 'string' || v.length === 0) return null;
          // Must start with http or data:image/
          if (!v.startsWith('http://') && !v.startsWith('https://') && !v.startsWith('data:image/')) {
            console.warn(`[upload-to-master-db] Invalid image_url format (first 50 chars): ${v.substring(0, 50)}`);
            return null;
          }
          // Guard against oversized strings
          if (v.length > MAX_IMAGE_TEXT_LEN) {
            console.warn(`[upload-to-master-db] image_url for "${p.title}" is ${Math.round(v.length / 1024)}KB — exceeds limit, discarding`);
            return null;
          }
          return v;
        };

        // Build the row WITHOUT the id field — let Supabase auto-generate UUIDs for new records
        const row: Record<string, unknown> = {
          title: p.title || null,
          category: p.category || p.collection || null,
          factory_name: p.factory_name || null,
          factory_id: factoryId,
          image_url: sanitizeImageUrl(p.image_url),
          description: p.description_html || p.description || null,
          material: p.material || null,
          dimension_l_mm: toInt(p.dimension_l_mm),
          dimension_w_mm: toInt(p.dimension_w_mm),
          dimension_h_mm: toInt(p.dimension_h_mm),
          cost_price: toFloat(p.cost_price),
          sale_price: 0,
          shopify_price: 0,
          shopify_compare_at_price: toFloat(
            p.shopify_compare_at_price ?? p.compare_at_price
          ),
          delivery_days: toInt(p.delivery_days),
          shopify_id: p.shopify_id ?? p.shopify_product_id ?? null,
          production_lead_time: toInt(p.production_lead_time ?? p.production_date),
          shipping_days: toInt(p.shipping_days),
          total_lead_time: toInt(p.total_lead_time) ??
            (toInt(p.production_lead_time ?? p.production_date) != null && toInt(p.shipping_days) != null
              ? (toInt(p.production_lead_time ?? p.production_date) ?? 0) + (toInt(p.shipping_days) ?? 0)
              : null),
          shipping_fee: toFloat(p.shipping_fee),
          remarks: p.remarks ?? null,
          color: p.color ?? null,
          factory_highlight: p.factory_highlight ?? [],
        };

        // delivery_term_id and delivery_term_name — include if present
        if (p.delivery_term_id) {
          row.delivery_term_id = p.delivery_term_id;
        }
        if (p.delivery_term_name) {
          row.delivery_term_name = p.delivery_term_name;
        }

        // lifestyle_image_url — only include if value is valid
        // (column may not exist yet on older schemas; will be stripped on retry if schema cache rejects it)
        const lifestyleUrl = sanitizeImageUrl(p.lifestyle_image_url);
        if (lifestyleUrl) {
          row.lifestyle_image_url = lifestyleUrl;
        }

        // Only include the master DB id if it's a valid UUID (from a previous upload)
        if (p.master_id && isValidUUID(p.master_id)) {
          row.id = p.master_id;
        }

        // Use local_id for tracking results back to the frontend
        const localId = p.local_id || p.id || "unknown";

        console.log(
          `[upload-to-master-db] Upserting product: "${p.title}" (local_id: ${localId}, has valid master_id: ${!!row.id})`
        );
        console.log(
          `[upload-to-master-db] Cleaned row keys:`, Object.keys(row).filter(k => row[k] !== null).join(', ')
        );

        // Helper: perform the DB operation (upsert/update/insert) with a given row payload
        async function performDbOperation(payload: Record<string, unknown>) {
          if (payload.id) {
            return await masterClient
              .from("bwf_product_master")
              .upsert(payload, { onConflict: "id" })
              .select("id")
              .single();
          } else {
            const titleVal = p.title || "";
            const factoryVal = p.factory_name || null;

            let lookupQuery = masterClient
              .from("bwf_product_master")
              .select("id")
              .eq("title", titleVal);

            if (factoryVal) {
              lookupQuery = lookupQuery.eq("factory_name", factoryVal);
            } else {
              lookupQuery = lookupQuery.is("factory_name", null);
            }

            const { data: existingArr } = await lookupQuery.limit(1);
            const existing = existingArr && existingArr.length > 0 ? existingArr[0] : null;

            if (existing?.id) {
              return await masterClient
                .from("bwf_product_master")
                .update(payload)
                .eq("id", existing.id)
                .select("id")
                .single();
            } else {
              return await masterClient
                .from("bwf_product_master")
                .insert(payload)
                .select("id")
                .single();
            }
          }
        }

        // First attempt with full row
        let result = await performDbOperation(row);
        let { data, error } = result;

        // If schema cache error (column not found), strip the problematic column and retry
        if (error && error.message && error.message.includes("schema cache")) {
          const colMatch = error.message.match(/Could not find the '(\w+)' column/);
          if (colMatch) {
            const badCol = colMatch[1];
            console.warn(
              `[upload-to-master-db] Schema cache missing column "${badCol}" — retrying without it`
            );
            const retryRow = { ...row };
            delete retryRow[badCol];
            const retryResult = await performDbOperation(retryRow);
            data = retryResult.data;
            error = retryResult.error;
          }
        }

        if (error) {
          console.error(
            `[upload-to-master-db] Error upserting "${p.title}":`,
            JSON.stringify({ message: error.message, code: error.code, details: error.details, hint: error.hint })
          );
          console.error(`[upload-to-master-db] Row payload for failed item:`, JSON.stringify(row));
          results.push({
            local_id: localId,
            success: false,
            error: `${error.message}${error.details ? ` (${error.details})` : ''}${error.hint ? ` [hint: ${error.hint}]` : ''}`,
          });
        } else {
          console.log(
            `[upload-to-master-db] Success: "${p.title}" → master ID: ${data?.id}`
          );
          results.push({
            local_id: localId,
            success: true,
            master_id: data?.id,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const localId = p.local_id || p.id || "unknown";
        console.error(
          `[upload-to-master-db] Unexpected error for "${p.title}":`,
          errMsg
        );
        results.push({
          local_id: localId,
          success: false,
          error: errMsg,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;

    const summary = {
      total: products.length,
      success: successCount,
      errors: errorCount,
    };

    console.log("[upload-to-master-db] Summary:", JSON.stringify(summary));

    return new Response(
      JSON.stringify({ results, summary }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[upload-to-master-db] Fatal error:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

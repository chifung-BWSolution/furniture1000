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
    const masterIds: string[] = body.master_ids;

    if (!masterIds || !Array.isArray(masterIds) || masterIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "No master_ids provided" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    console.log(
      `[delete-from-master-db] Deleting ${masterIds.length} products from bwf_product_master`
    );

    const results: {
      master_id: string;
      success: boolean;
      error?: string;
    }[] = [];

    for (const masterId of masterIds) {
      try {
        console.log(
          `[delete-from-master-db] Deleting master ID: ${masterId}`
        );

        const { error } = await masterClient
          .from("bwf_product_master")
          .delete()
          .eq("id", masterId);

        if (error) {
          console.error(
            `[delete-from-master-db] Error deleting "${masterId}":`,
            error.message
          );
          results.push({
            master_id: masterId,
            success: false,
            error: error.message,
          });
        } else {
          console.log(
            `[delete-from-master-db] Success: deleted master ID ${masterId}`
          );
          results.push({
            master_id: masterId,
            success: true,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[delete-from-master-db] Unexpected error for "${masterId}":`,
          errMsg
        );
        results.push({
          master_id: masterId,
          success: false,
          error: errMsg,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;

    const summary = {
      total: masterIds.length,
      success: successCount,
      errors: errorCount,
    };

    console.log("[delete-from-master-db] Summary:", JSON.stringify(summary));

    return new Response(
      JSON.stringify({ results, summary }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[delete-from-master-db] Fatal error:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pmsKeyMissingError, pmsProjectUrl, pmsServiceRoleKey } from "../_shared/pmsProject.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const masterServiceKey = pmsServiceRoleKey();
    if (!masterServiceKey) {
      throw new Error(pmsKeyMissingError());
    }

    const masterSupabase = createClient(pmsProjectUrl(), masterServiceKey);

    // Fetch all distinct non-null display values from bwf_products
    const { data, error } = await masterSupabase
      .from("bwf_products")
      .select("display")
      .not("display", "is", null)
      .neq("display", "");

    if (error) {
      throw new Error(`Failed to fetch display categories: ${error.message}`);
    }

    // Extract unique display values and sort alphabetically
    const uniqueCategories = [
      ...new Set(
        (data || [])
          .map((row: { display: string | null }) => row.display?.trim())
          .filter((c): c is string => !!c && c.length > 0)
      ),
    ].sort((a, b) => a.localeCompare(b, 'zh-Hant'));

    return new Response(
      JSON.stringify({ categories: uniqueCategories }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Edge function error:", (error as Error).message);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

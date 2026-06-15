import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// External Supabase project for factories
const FACTORY_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";
const FACTORY_SERVICE_ROLE_KEY = Deno.env.get("FACTORY_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    if (!FACTORY_SERVICE_ROLE_KEY) {
      throw new Error("FACTORY_SERVICE_ROLE_KEY is not configured");
    }

    const factorySupabase = createClient(
      FACTORY_PROJECT_URL,
      FACTORY_SERVICE_ROLE_KEY
    );

    const { data, error } = await factorySupabase
      .from("factories")
      .select("id, display_name, factory_code")
      .order("display_name", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch factories: ${error.message}`);
    }

    const factories = (data || []).map(
      (row: { id: string; display_name: string; factory_code: string | null }) => ({
        display_name: row.display_name,
        factory_id: row.factory_code || row.id,
      })
    );

    // Also return a flat list for backward compatibility
    const factoryNames = factories.map((f: { display_name: string }) => f.display_name);

    return new Response(JSON.stringify({ factories: factoryNames, factoriesWithIds: factories }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

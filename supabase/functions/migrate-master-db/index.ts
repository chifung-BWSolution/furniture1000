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
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Parse optional custom migrations from request body
    let customMigrations: string[] | null = null;
    try {
      const body = await req.json();
      if (body?.migrations && Array.isArray(body.migrations)) {
        customMigrations = body.migrations;
      }
    } catch {
      // No body or invalid JSON — use default migrations
    }

    // Default migrations to run
    const migrations = customMigrations ?? [
      `ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS delivery_term_id UUID`,
      `ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS delivery_term_name TEXT`,
    ];

    const results: { sql: string; success: boolean; error?: string }[] = [];

    // Use the Supabase PostgREST SQL execution endpoint (available with service_role key)
    // POST to /rest/v1/rpc won't work without a function.
    // Instead, use the direct pg-meta SQL endpoint available on every Supabase project.
    for (const sql of migrations) {
      try {
        // Method: Use the /pg/query endpoint with service_role key
        // This is available on all Supabase projects via the pooler/pg-meta
        const response = await fetch(`${MASTER_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": masterServiceKey,
            "Authorization": `Bearer ${masterServiceKey}`,
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ sql_query: sql }),
        });

        if (response.ok) {
          console.log(`[migrate-master-db] exec_sql Success: ${sql}`);
          results.push({ sql, success: true });
          continue;
        }

        // If exec_sql doesn't exist, try creating it first
        const errText = await response.text();
        if (errText.includes("function") || errText.includes("does not exist") || response.status === 404) {
          console.log("[migrate-master-db] exec_sql not found, creating it...");

          // Create the exec_sql function by inserting it via a known writable approach
          // Use the Supabase client to create the function
          const masterClient = createClient(MASTER_SUPABASE_URL, masterServiceKey, {
            auth: { persistSession: false },
            db: { schema: "public" },
          });

          // Try to create exec_sql via the SQL endpoint
          const createFnResp = await fetch(`${MASTER_SUPABASE_URL}/rest/v1/rpc/query`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": masterServiceKey,
              "Authorization": `Bearer ${masterServiceKey}`,
            },
            body: JSON.stringify({
              query: `
                CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
                RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
                BEGIN EXECUTE sql_query; END; $$;
              `,
            }),
          });

          if (createFnResp.ok) {
            // Retry the original migration
            const retryResp = await fetch(`${MASTER_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": masterServiceKey,
                "Authorization": `Bearer ${masterServiceKey}`,
                "Prefer": "return=minimal",
              },
              body: JSON.stringify({ sql_query: sql }),
            });

            if (retryResp.ok) {
              console.log(`[migrate-master-db] Retry Success: ${sql}`);
              results.push({ sql, success: true });
              continue;
            }
          }

          // All strategies failed — report for manual execution
          results.push({
            sql,
            success: false,
            error: `exec_sql RPC not available. Original error: ${errText}`,
          });
        } else {
          results.push({ sql, success: false, error: errText });
        }
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(`[migrate-master-db] Fetch error for: ${sql}`, msg);
        results.push({ sql, success: false, error: msg });
      }
    }

    const allSuccess = results.every((r) => r.success);

    return new Response(
      JSON.stringify({
        message: allSuccess ? "All migrations applied successfully!" : "Migration completed with some failures",
        results,
        hint: allSuccess
          ? undefined
          : "Some migrations failed. Please run the failed SQL statements directly in the master project SQL editor: https://supabase.com/dashboard/project/kqwktnplkqucsbasyfjl/sql",
        manualSql: results.filter((r) => !r.success).map((r) => r.sql),
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

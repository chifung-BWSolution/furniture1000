import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PMS_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 80;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const pmsServiceKey =
    Deno.env.get("FACTORY_SERVICE_ROLE_KEY") ??
    Deno.env.get("PMS_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("MASTER_SERVICE_ROLE_KEY") ??
    "";

  const furnitureUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const furnitureAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!pmsServiceKey) {
    return jsonResponse({ error: "PMS service role key not configured" }, 500);
  }
  if (!furnitureUrl || !furnitureAnonKey) {
    return jsonResponse({ error: "Furniture Supabase not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const furnitureClient = createClient(furnitureUrl, furnitureAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await furnitureClient.auth.getUser();
  if (userError || !userData.user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { search?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const search = (body.search || "").trim();
  const limit = Math.min(
    Math.max(Number(body.limit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  try {
    const pmsAdmin = createClient(PMS_PROJECT_URL, pmsServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = pmsAdmin
      .from("bwf_pitchings")
      .select(
        "id, pitching_code, pitching_name, customer_id, real_customer_display_name, real_customer_name, main_pm_id, pitching_stages, estimated_income, enquiry_date",
      )
      .order("enquiry_date", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (search) {
      const pattern = `%${escapeIlike(search)}%`;
      query = query.or(
        [
          `pitching_code.ilike.${pattern}`,
          `pitching_name.ilike.${pattern}`,
          `real_customer_display_name.ilike.${pattern}`,
          `real_customer_name.ilike.${pattern}`,
        ].join(","),
      );
    }

    const { data: rows, error } = await query;
    if (error) {
      throw new Error(`Pitchings list failed: ${error.message}`);
    }

    const pitchings = rows || [];
    const pmIds = [
      ...new Set(
        pitchings
          .map((r) => r.main_pm_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const pmNameById = new Map<string, string>();
    if (pmIds.length > 0) {
      const { data: staffRows, error: staffError } = await pmsAdmin
        .from("staff")
        .select("id, name")
        .in("id", pmIds);

      if (staffError) {
        console.warn("[fetch-pms-pitchings] staff lookup:", staffError.message);
      } else {
        for (const s of staffRows || []) {
          const name = String(s.name || "").trim();
          if (s.id && name) pmNameById.set(s.id as string, name);
        }
      }
    }

    const items = pitchings.map((r) => {
      const customerName =
        String(r.real_customer_display_name || "").trim() ||
        String(r.real_customer_name || "").trim() ||
        null;
      const pmId = (r.main_pm_id as string | null) || null;
      return {
        id: r.id as string,
        pitching_code: (r.pitching_code as string | null) || null,
        pitching_name: (r.pitching_name as string | null) || null,
        customer_id: (r.customer_id as string | null) || null,
        customer_name: customerName,
        main_pm_id: pmId,
        main_pm_name: pmId ? pmNameById.get(pmId) || null : null,
        pitching_stages: (r.pitching_stages as string | null) || null,
        estimated_income: r.estimated_income ?? null,
        enquiry_date: (r.enquiry_date as string | null) || null,
      };
    });

    return jsonResponse({ items, count: items.length });
  } catch (err) {
    console.error("[fetch-pms-pitchings]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      500,
    );
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PMS_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  let body: { staff_ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const staffIds = Array.from(
    new Set(
      (body.staff_ids ?? [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ).slice(0, 200);

  if (staffIds.length === 0) {
    return jsonResponse({ staff: [] });
  }

  try {
    const pmsAdmin = createClient(PMS_PROJECT_URL, pmsServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: staffRows, error: staffError } = await pmsAdmin
      .from("staff")
      .select("id, name")
      .in("id", staffIds);

    if (staffError) {
      throw new Error(`PMS staff lookup failed: ${staffError.message}`);
    }

    const { data: userRows, error: usersError } = await pmsAdmin
      .from("users")
      .select("member_id, email")
      .in("member_id", staffIds);

    if (usersError) {
      throw new Error(`PMS users lookup failed: ${usersError.message}`);
    }

    const emailByStaffId = new Map<string, string>();
    for (const row of userRows ?? []) {
      const memberId = String(row.member_id ?? "").trim();
      const email = String(row.email ?? "").trim();
      if (memberId && email) emailByStaffId.set(memberId, email);
    }

    const staff = (staffRows ?? []).map((row) => {
      const id = String(row.id ?? "").trim();
      const name = String(row.name ?? "").trim() || null;
      const email = emailByStaffId.get(id) ?? null;
      return {
        id,
        name,
        email,
        display_name: name ?? email,
      };
    });

    return jsonResponse({ staff });
  } catch (err) {
    console.error("[resolve-pms-staff-by-ids]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      500,
    );
  }
});

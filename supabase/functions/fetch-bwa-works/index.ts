import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { pmsKeyMissingError, pmsProjectUrl, pmsServiceRoleKey } from "../_shared/pmsProject.ts";
import { fetchCaseShowcase, CaseAccessError } from "../_shared/caseShowcase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 40;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function pitchingName(row: {
  real_building_name?: string | null;
  real_customer_display_name?: string | null;
  real_customer_co_name?: string | null;
}): string {
  return text(row.real_building_name)
    || text(row.real_customer_display_name)
    || text(row.real_customer_co_name);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const pmsServiceKey = pmsServiceRoleKey();
  const furnitureUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const furnitureAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!pmsServiceKey) return jsonResponse({ error: pmsKeyMissingError() }, 500);
  if (!furnitureUrl || !furnitureAnonKey) {
    return jsonResponse({ error: "Furniture Supabase not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

  const furnitureClient = createClient(furnitureUrl, furnitureAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await furnitureClient.auth.getUser();
  if (userError || !userData.user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  let body: { search?: string; limit?: number; action?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const isCaseQuery = typeof body.action === "string" && body.action.startsWith("cases-");
  const { data: allowed, error: roleError } = await furnitureClient.rpc("bwf_has_role", {
    p_roles: isCaseQuery ? ["pm", "admin", "uploader", "designer"] : ["pm", "admin", "uploader"],
  });
  if (roleError || allowed !== true) return jsonResponse({ error: "Forbidden" }, 403);
  const search = text(body.search).replace(/[,()]/g, " ").slice(0, 80);
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  try {
    const pmsAdmin = createClient(pmsProjectUrl(), pmsServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (isCaseQuery) {
      return jsonResponse({ ...await fetchCaseShowcase(pmsAdmin, userData.user, body.action!), action: body.action });
    }

    // BWA identity only. Do not select estimated_income, estimated_expense,
    // estimated_profit, cost_centre, supplier, or any BWF quote column.
    let projects = pmsAdmin
      .from("bwa_projects")
      .select("id, pitching_id, project_code, project_name, external_project_name, real_customer_display_name")
      .order("modified_date", { ascending: false, nullsFirst: false })
      .limit(limit);
    let pitchings = pmsAdmin
      .from("bwa_pitchings")
      .select("id, pitching_code, real_building_name, real_customer_display_name, real_customer_co_name")
      .order("enquiry_date", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (search) {
      const pattern = `%${escapeIlike(search)}%`;
      projects = projects.or(
        [
          `project_code.ilike.${pattern}`,
          `project_name.ilike.${pattern}`,
          `external_project_name.ilike.${pattern}`,
          `real_customer_display_name.ilike.${pattern}`,
        ].join(","),
      );
      pitchings = pitchings.or(
        [
          `pitching_code.ilike.${pattern}`,
          `real_building_name.ilike.${pattern}`,
          `real_customer_display_name.ilike.${pattern}`,
          `real_customer_co_name.ilike.${pattern}`,
        ].join(","),
      );
    }

    const [projectResult, pitchingResult] = await Promise.all([projects, pitchings]);
    if (projectResult.error) throw new Error(projectResult.error.message);
    if (pitchingResult.error) throw new Error(pitchingResult.error.message);

    const items = [
      ...(projectResult.data || []).map((row) => ({
        kind: "project" as const,
        project_id: row.id as string,
        pitching_id: (row.pitching_id as string | null) || null,
        code: text(row.project_code),
        name: text(row.project_name) || text(row.external_project_name),
        customer_name: text(row.real_customer_display_name) || null,
      })),
      ...(pitchingResult.data || []).map((row) => ({
        kind: "pitching" as const,
        project_id: null,
        pitching_id: row.id as string,
        code: text(row.pitching_code),
        name: pitchingName(row),
        customer_name: text(row.real_customer_display_name) || null,
      })),
    ];

    return jsonResponse({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BWA lookup failed";
    return jsonResponse({ error: message }, error instanceof CaseAccessError ? 403 : 500);
  }
});

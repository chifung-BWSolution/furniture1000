import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PMS_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

/** NOS collection for customer industry / 客戶產業 tags. */
const INDUSTRY_COLLECTION_ID = "4f5de598-2dcb-45a6-a106-9d933e9a8007";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    const s = (v || "").trim();
    if (s) return s;
  }
  return null;
}

function formatBudget(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n));
}

type ResolveIds = {
  pitchingId: string | null;
  projectId: string | null;
  projectCode: string | null;
};

/**
 * Resolve PMS project ↔ pitching linkage.
 * - project_id provided: project must exist; pitching comes from project.bwf_pitching_id
 * - pitching_id provided: find related bwf_projects row if any
 */
async function resolveProjectPitchingIds(
  pmsAdmin: ReturnType<typeof createClient>,
  input: { pitchingId?: string; projectId?: string },
): Promise<ResolveIds> {
  let pitchingId = input.pitchingId || null;
  let projectId = input.projectId || null;
  let projectCode: string | null = null;

  if (projectId) {
    const { data: project, error: projectError } = await pmsAdmin
      .from("bwf_projects")
      .select("id, bwf_pitching_id, project_code")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      throw new Error(`Project lookup failed: ${projectError.message}`);
    }
    if (!project) {
      throw new Error(`bwf_projects not found for id ${projectId}`);
    }

    projectCode = (project.project_code as string | null) || null;
    const linkedPitching = (project.bwf_pitching_id as string | null) || null;
    if (!linkedPitching) {
      throw new Error(`bwf_projects ${projectId} has no related bwf_pitching_id`);
    }
    // Project wins for pitching when both provided and mismatch — project is source of truth.
    pitchingId = linkedPitching;
  } else if (pitchingId) {
    const { data: relatedProject, error: relatedError } = await pmsAdmin
      .from("bwf_projects")
      .select("id, project_code")
      .eq("bwf_pitching_id", pitchingId)
      .order("enquiry_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (relatedError) {
      throw new Error(`Related project lookup failed: ${relatedError.message}`);
    }
    if (relatedProject?.id) {
      projectId = relatedProject.id as string;
      projectCode = (relatedProject.project_code as string | null) || null;
    }
  }

  return { pitchingId, projectId, projectCode };
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

  let body: { pitching_id?: string; project_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawPitchingId = body.pitching_id?.trim() || "";
  const rawProjectId = body.project_id?.trim() || "";

  if (rawPitchingId && !UUID_RE.test(rawPitchingId)) {
    return jsonResponse({ error: "pitching_id must be a uuid" }, 400);
  }
  if (rawProjectId && !UUID_RE.test(rawProjectId)) {
    return jsonResponse({ error: "project_id must be a uuid" }, 400);
  }

  try {
    const pmsAdmin = createClient(PMS_PROJECT_URL, pmsServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: industryRows, error: industryError } = await pmsAdmin
      .from("nos_customer_tags")
      .select("id, display")
      .eq("collection_id", INDUSTRY_COLLECTION_ID)
      .order("display", { ascending: true });

    if (industryError) {
      throw new Error(`Industry tags lookup failed: ${industryError.message}`);
    }

    const industryOptions = (industryRows || [])
      .map((row) => ({
        id: row.id as string,
        display: String(row.display || "").trim(),
      }))
      .filter((row) => row.id && row.display);

    if (!rawPitchingId && !rawProjectId) {
      return jsonResponse({
        pitching_id: null,
        project_id: null,
        pitching_code: null,
        pitching_name: null,
        project_code: null,
        customer_id: null,
        client_name: null,
        client_phone: null,
        client_email: null,
        estimated_income: null,
        budget_min: null,
        budget_max: null,
        industry_options: industryOptions,
        selected_industries: [],
      });
    }

    const resolved = await resolveProjectPitchingIds(pmsAdmin, {
      pitchingId: rawPitchingId || undefined,
      projectId: rawProjectId || undefined,
    });

    const pitchingId = resolved.pitchingId;
    if (!pitchingId) {
      return jsonResponse({
        pitching_id: null,
        project_id: resolved.projectId,
        pitching_code: null,
        pitching_name: null,
        project_code: resolved.projectCode,
        customer_id: null,
        client_name: null,
        client_phone: null,
        client_email: null,
        estimated_income: null,
        budget_min: null,
        budget_max: null,
        industry_options: industryOptions,
        selected_industries: [],
      });
    }

    const { data: pitching, error: pitchingError } = await pmsAdmin
      .from("bwf_pitchings")
      .select("id, pitching_code, pitching_name, customer_id, estimated_income")
      .eq("id", pitchingId)
      .maybeSingle();

    if (pitchingError) {
      throw new Error(`Pitching lookup failed: ${pitchingError.message}`);
    }
    if (!pitching) {
      return jsonResponse({
        pitching_id: pitchingId,
        project_id: resolved.projectId,
        pitching_code: null,
        pitching_name: null,
        project_code: resolved.projectCode,
        customer_id: null,
        client_name: null,
        client_phone: null,
        client_email: null,
        estimated_income: null,
        budget_min: null,
        budget_max: null,
        industry_options: industryOptions,
        selected_industries: [],
      });
    }

    const customerId = (pitching.customer_id as string | null) || null;
    let clientName: string | null = null;
    let clientPhone: string | null = null;
    let clientEmail: string | null = null;
    let selectedIndustries: string[] = [];

    if (customerId) {
      const { data: customer, error: customerError } = await pmsAdmin
        .from("customers")
        .select(
          "company_name, display_name, customer_name, email, phone_display, phone_number_a, phone_number_b",
        )
        .eq("id", customerId)
        .maybeSingle();

      if (customerError) {
        throw new Error(`Customer lookup failed: ${customerError.message}`);
      }

      clientName =
        (customer?.company_name as string | null)?.trim() ||
        (customer?.display_name as string | null)?.trim() ||
        (customer?.customer_name as string | null)?.trim() ||
        null;

      clientPhone = firstNonEmpty(
        customer?.phone_display as string | null,
        customer?.phone_number_a as string | null,
        customer?.phone_number_b as string | null,
      );
      clientEmail = firstNonEmpty(customer?.email as string | null);

      const { data: tagRows, error: tagError } = await pmsAdmin
        .from("customer_tags")
        .select("tag_uuid")
        .eq("customer_uuid", customerId);

      if (tagError) {
        throw new Error(`Customer tags lookup failed: ${tagError.message}`);
      }

      const tagIds = (tagRows || [])
        .map((r) => r.tag_uuid as string | null)
        .filter((id): id is string => Boolean(id));

      if (tagIds.length > 0) {
        const optionById = new Map(industryOptions.map((o) => [o.id, o.display]));
        selectedIndustries = [...new Set(
          tagIds
            .map((id) => optionById.get(id))
            .filter((d): d is string => Boolean(d)),
        )];
      }
    }

    const budget = formatBudget(pitching.estimated_income as number | string | null);

    return jsonResponse({
      pitching_id: pitching.id,
      project_id: resolved.projectId,
      pitching_code: pitching.pitching_code ?? null,
      pitching_name: (pitching.pitching_name as string | null)?.trim() || null,
      project_code: resolved.projectCode,
      customer_id: customerId,
      client_name: clientName,
      client_phone: clientPhone,
      client_email: clientEmail,
      estimated_income: pitching.estimated_income ?? null,
      budget_min: budget,
      budget_max: budget,
      industry_options: industryOptions,
      selected_industries: selectedIndustries,
    });
  } catch (err) {
    console.error("[fetch-pms-pitching-quote-defaults]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      500,
    );
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PMS_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";

/** SLA window used for 剩餘天數 (enquiry_date + 90 days). */
const ENQUIRY_SLA_DAYS = 90;

/** Same industry collection as fetch-pms-pitching-quote-defaults / 客戶產業 *. */
const INDUSTRY_COLLECTION_ID = "4f5de598-2dcb-45a6-a106-9d933e9a8007";

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 150;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function remainingDaysFromEnquiry(enquiryDate: string | null): number | null {
  if (!enquiryDate) return null;
  const start = new Date(enquiryDate);
  if (Number.isNaN(start.getTime())) return null;
  const deadline = new Date(start.getTime());
  deadline.setUTCDate(deadline.getUTCDate() + ENQUIRY_SLA_DAYS);
  const now = new Date();
  const ms = deadline.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
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

  let body: {
    search?: string;
    limit?: number;
    ids?: string[];
    /** Exact pitching_code matches (e.g. BWF-OB26-113). */
    codes?: string[];
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const search = (body.search || "").trim();
  const idList = Array.isArray(body.ids)
    ? [...new Set(body.ids.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  const codeList = Array.isArray(body.codes)
    ? [
        ...new Set(
          body.codes.map((code) => String(code || "").trim()).filter(Boolean),
        ),
      ]
    : [];
  const limit = Math.min(
    Math.max(
      Number(body.limit) ||
        (idList.length > 0 || codeList.length > 0
          ? Math.max(idList.length, codeList.length)
          : DEFAULT_LIMIT),
      1,
    ),
    MAX_LIMIT,
  );

  try {
    const pmsAdmin = createClient(PMS_PROJECT_URL, pmsServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = pmsAdmin
      .from("bwf_pitchings")
      .select(
        "id, pitching_code, pitching_name, customer_id, real_customer_display_name, real_customer_name, main_pm_id, main_designer_id, pitching_stages, estimated_income, estimated_expense, enquiry_date, n_customer_type_id, n_bwf_service_types_id",
      )
      .order("enquiry_date", { ascending: false, nullsFirst: false })
      .limit(
        Math.min(
          Math.max(limit, idList.length || codeList.length || 1),
          MAX_LIMIT,
        ),
      );

    if (idList.length > 0) {
      query = query.in("id", idList.slice(0, MAX_LIMIT));
    } else if (codeList.length > 0) {
      query = query.in("pitching_code", codeList.slice(0, MAX_LIMIT));
    } else if (search) {
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

    const staffIds = [
      ...new Set(
        pitchings
          .flatMap((r) => [
            r.main_pm_id as string | null,
            r.main_designer_id as string | null,
          ])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const customerTypeIds = [
      ...new Set(
        pitchings
          .map((r) => r.n_customer_type_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const serviceTypeIds = [
      ...new Set(
        pitchings
          .map((r) => r.n_bwf_service_types_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const staffNameById = new Map<string, string>();
    if (staffIds.length > 0) {
      const { data: staffRows, error: staffError } = await pmsAdmin
        .from("staff")
        .select("id, name")
        .in("id", staffIds);
      if (staffError) {
        console.warn("[fetch-pms-pitchings] staff lookup:", staffError.message);
      } else {
        for (const s of staffRows || []) {
          const name = String(s.name || "").trim();
          if (s.id && name) staffNameById.set(s.id as string, name);
        }
      }
    }

    const customerTypeById = new Map<string, string>();
    if (customerTypeIds.length > 0) {
      const { data: typeRows, error: typeError } = await pmsAdmin
        .from("client_types")
        .select("id, display, code")
        .in("id", customerTypeIds);
      if (typeError) {
        console.warn("[fetch-pms-pitchings] client_types:", typeError.message);
      } else {
        for (const t of typeRows || []) {
          const display =
            String(t.display || "").trim() ||
            String(t.code || "").trim();
          if (t.id && display) customerTypeById.set(t.id as string, display);
        }
      }
    }

    const serviceTypeById = new Map<string, string>();
    if (serviceTypeIds.length > 0) {
      const { data: svcRows, error: svcError } = await pmsAdmin
        .from("nos_service_type_2")
        .select("id, display, code")
        .in("id", serviceTypeIds);
      if (svcError) {
        console.warn("[fetch-pms-pitchings] service types:", svcError.message);
      } else {
        for (const t of svcRows || []) {
          const display =
            String(t.display || "").trim() ||
            String(t.code || "").trim();
          if (t.id && display) serviceTypeById.set(t.id as string, display);
        }
      }
    }

    // 客戶產業：PMS customer_tags ∩ industry collection (same as quote form prefill)
    const industryDisplayById = new Map<string, string>();
    {
      const { data: industryRows, error: industryError } = await pmsAdmin
        .from("nos_customer_tags")
        .select("id, display")
        .eq("collection_id", INDUSTRY_COLLECTION_ID);
      if (industryError) {
        console.warn(
          "[fetch-pms-pitchings] industry tags:",
          industryError.message,
        );
      } else {
        for (const t of industryRows || []) {
          const display = String(t.display || "").trim();
          if (t.id && display) industryDisplayById.set(t.id as string, display);
        }
      }
    }

    const customerIds = [
      ...new Set(
        pitchings
          .map((r) => r.customer_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const industriesByCustomerId = new Map<string, string[]>();
    if (customerIds.length > 0 && industryDisplayById.size > 0) {
      const { data: tagRows, error: tagError } = await pmsAdmin
        .from("customer_tags")
        .select("customer_uuid, tag_uuid")
        .in("customer_uuid", customerIds);
      if (tagError) {
        console.warn("[fetch-pms-pitchings] customer_tags:", tagError.message);
      } else {
        for (const row of tagRows || []) {
          const customerUuid = row.customer_uuid as string | null;
          const tagUuid = row.tag_uuid as string | null;
          if (!customerUuid || !tagUuid) continue;
          const display = industryDisplayById.get(tagUuid);
          if (!display) continue;
          const list = industriesByCustomerId.get(customerUuid) || [];
          if (!list.includes(display)) list.push(display);
          industriesByCustomerId.set(customerUuid, list);
        }
      }
    }

    const items = pitchings.map((r) => {
      const customerName =
        String(r.real_customer_display_name || "").trim() ||
        String(r.real_customer_name || "").trim() ||
        null;
      const pmId = (r.main_pm_id as string | null) || null;
      const designerId = (r.main_designer_id as string | null) || null;
      const customerTypeId = (r.n_customer_type_id as string | null) || null;
      const serviceTypeId = (r.n_bwf_service_types_id as string | null) || null;
      const enquiryDate = (r.enquiry_date as string | null) || null;
      const income = r.estimated_income ?? null;
      const expense = r.estimated_expense ?? null;
      let estimatedGp: number | null = null;
      if (
        income != null &&
        expense != null &&
        Number.isFinite(Number(income)) &&
        Number.isFinite(Number(expense))
      ) {
        estimatedGp = Number(income) - Number(expense);
      }

      return {
        id: r.id as string,
        pitching_code: (r.pitching_code as string | null) || null,
        pitching_name: (r.pitching_name as string | null) || null,
        customer_id: (r.customer_id as string | null) || null,
        customer_name: customerName,
        main_pm_id: pmId,
        main_pm_name: pmId ? staffNameById.get(pmId) || null : null,
        main_designer_id: designerId,
        main_designer_name: designerId
          ? staffNameById.get(designerId) || null
          : null,
        pitching_stages: (r.pitching_stages as string | null) || null,
        estimated_income: income,
        estimated_expense: expense,
        estimated_gross_profit: estimatedGp,
        enquiry_date: enquiryDate,
        remaining_days: remainingDaysFromEnquiry(enquiryDate),
        customer_type: customerTypeId
          ? customerTypeById.get(customerTypeId) || null
          : null,
        client_industry: (() => {
          const cid = (r.customer_id as string | null) || null;
          if (!cid) return null;
          const labels = industriesByCustomerId.get(cid) || [];
          return labels.length > 0 ? labels.join("、") : null;
        })(),
        service_type: serviceTypeId
          ? serviceTypeById.get(serviceTypeId) || null
          : null,
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

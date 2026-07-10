import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PMS_PROJECT_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";
const BATCH_LIMIT = 200;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type StaffRef = { id?: string | null; name?: string | null };
type UsersStaffRow = {
  auth_user_id?: string | null;
  member_id?: string | null;
  email?: string | null;
  staff?: StaffRef | StaffRef[] | null;
} | null;

function extractStaff(row: UsersStaffRow): {
  staff_id: string | null;
  name: string | null;
  email: string | null;
} {
  const staff = row?.staff;
  const staffRow = Array.isArray(staff) ? staff[0] : staff;
  const staff_id = staffRow?.id?.trim() || row?.member_id?.trim() || null;
  const name = staffRow?.name?.trim() || null;
  const email = row?.email?.trim() || null;
  return { staff_id, name, email };
}

async function lookupStaffByAuthUserIds(
  pmsAdmin: ReturnType<typeof createClient>,
  authUserIds: string[],
): Promise<
  {
    auth_user_id: string;
    staff_id: string | null;
    name: string | null;
    email: string | null;
    display_name: string | null;
  }[]
> {
  if (authUserIds.length === 0) return [];

  const { data, error } = await pmsAdmin
    .from("users")
    .select("auth_user_id, member_id, email, staff!fk_users_member_id(id, name)")
    .in("auth_user_id", authUserIds);

  if (error) {
    throw new Error(`PMS users auth lookup failed: ${error.message}`);
  }

  const byAuthUserId = new Map<string, ReturnType<typeof extractStaff>>();
  for (const row of data ?? []) {
    const authUserId = String(row.auth_user_id ?? "").trim();
    if (!authUserId) continue;
    byAuthUserId.set(authUserId, extractStaff(row as UsersStaffRow));
  }

  return authUserIds.map((authUserId) => {
    const resolved = byAuthUserId.get(authUserId) ?? {
      staff_id: null,
      name: null,
      email: null,
    };
    const display_name = resolved.name ?? resolved.email ?? null;
    return {
      auth_user_id: authUserId,
      staff_id: resolved.staff_id,
      name: resolved.name,
      email: resolved.email,
      display_name,
    };
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

  let body: { staff_ids?: string[]; auth_user_ids?: string[] } = {};
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
  ).slice(0, BATCH_LIMIT);

  const authUserIds = Array.from(
    new Set(
      (body.auth_user_ids ?? [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ).slice(0, BATCH_LIMIT);

  if (staffIds.length === 0 && authUserIds.length === 0) {
    return jsonResponse({ staff: [], auth_users: [] });
  }

  try {
    const pmsAdmin = createClient(PMS_PROJECT_URL, pmsServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const staff: {
      id: string;
      name: string | null;
      email: string | null;
      display_name: string | null;
    }[] = [];

    if (staffIds.length > 0) {
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

      for (const row of staffRows ?? []) {
        const id = String(row.id ?? "").trim();
        const name = String(row.name ?? "").trim() || null;
        const email = emailByStaffId.get(id) ?? null;
        staff.push({
          id,
          name,
          email,
          display_name: name,
        });
      }
    }

    const auth_users = await lookupStaffByAuthUserIds(pmsAdmin, authUserIds);

    return jsonResponse({ staff, auth_users });
  } catch (err) {
    console.error("[resolve-pms-staff-by-ids]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      500,
    );
  }
});

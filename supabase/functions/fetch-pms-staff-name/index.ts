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

type StaffRef = { id?: string | null; name?: string | null };
type UsersStaffRow = {
  member_id?: string | null;
  staff?: StaffRef | StaffRef[] | null;
} | null;

export type PmsStaffLookup = {
  staff_id: string | null;
  name: string | null;
};

function extractStaff(row: UsersStaffRow): PmsStaffLookup {
  const staff = row?.staff;
  const staffRow = Array.isArray(staff) ? staff[0] : staff;
  const fromStaffId = staffRow?.id?.trim() || null;
  const fromMemberId = row?.member_id?.trim() || null;
  // Prefer staff.id; member_id is the same UUID when linked (users.member_id = staff.id).
  const staff_id = fromStaffId || fromMemberId || null;
  const name = staffRow?.name?.trim() || null;
  return { staff_id, name };
}

async function lookupStaff(
  pmsAdmin: ReturnType<typeof createClient>,
  authUserId: string,
  email?: string | null,
): Promise<PmsStaffLookup> {
  const selectCols = "member_id, staff!fk_users_member_id(id, name)";

  const { data, error } = await pmsAdmin
    .from("users")
    .select(selectCols)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`PMS users lookup failed: ${error.message}`);
  }

  const byAuthUserId = extractStaff(data as UsersStaffRow);
  if (byAuthUserId.staff_id || byAuthUserId.name) return byAuthUserId;

  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return { staff_id: null, name: null };

  const { data: byEmail, error: emailError } = await pmsAdmin
    .from("users")
    .select(selectCols)
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (emailError) {
    throw new Error(`PMS users email lookup failed: ${emailError.message}`);
  }

  return extractStaff(byEmail as UsersStaffRow);
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
  const user = userData.user;

  if (userError || !user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const pmsAdmin = createClient(PMS_PROJECT_URL, pmsServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { staff_id, name } = await lookupStaff(pmsAdmin, user.id, user.email);
    return jsonResponse({ staff_id, name });
  } catch (err) {
    console.error("[fetch-pms-staff-name]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      500,
    );
  }
});

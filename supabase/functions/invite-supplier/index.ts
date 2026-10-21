import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !serviceKey) {
    return json({ error: "Missing Supabase env" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user?.email) return json({ error: "Unauthorized" }, 401);

  const { data: caller } = await userClient
    .from("platform_user_profiles")
    .select("role, active")
    .ilike("email", userData.user.email)
    .maybeSingle();
  const callerRole = String(caller?.role ?? "").toLowerCase();
  if (!caller?.active || (callerRole !== "admin" && callerRole !== "uploader")) {
    return json({ error: "只有管理員或上載同事可以邀請廠家" }, 403);
  }

  let body: { email?: string; factory_id?: string; factory_name?: string; display_name?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const factoryId = body.factory_id?.trim() ?? "";
  const factoryName = body.factory_name?.trim() ?? "";
  const displayName = body.display_name?.trim() || factoryName || email.split("@")[0];
  if (!email.includes("@") || email.includes(" ") || !factoryId) {
    return json({ error: "請填電郵和廠家" }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: existing } = await admin
    .from("platform_user_profiles")
    .select("role")
    .eq("email", email)
    .maybeSingle();
  const existingRole = String(existing?.role ?? "").toLowerCase();
  if (existingRole && existingRole !== "supplier") {
    return json({ error: "這電郵已是職員或客戶帳號" }, 409);
  }

  const invited = await admin.auth.admin.inviteUserByEmail(email);
  const alreadyRegistered = Boolean(
    invited.error && /already|registered|exists/i.test(invited.error.message),
  );
  if (invited.error && !alreadyRegistered) {
    return json({ error: invited.error.message }, 500);
  }

  const authUserId = invited.data?.user?.id ?? null;
  const { error: profileError } = await admin.from("platform_user_profiles").upsert(
    {
      email,
      display_name: displayName,
      role: "supplier",
      source: "supplier",
      active: true,
      ...(authUserId ? { auth_user_id: authUserId } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );
  if (profileError) return json({ error: profileError.message }, 500);

  const { error: loginError } = await admin.from("supplier_logins").upsert(
    {
      email,
      factory_id: factoryId,
      factory_name: factoryName,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );
  if (loginError) return json({ error: loginError.message }, 500);

  return json({
    ok: true,
    email,
    invited: !alreadyRegistered,
    already_registered: alreadyRegistered,
  });
});

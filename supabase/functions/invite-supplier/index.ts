import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { pmsProjectUrl, pmsServiceRoleKey } from "../_shared/pmsProject.ts";

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

  let body: { email?: string; factory_id?: string; factory_name?: string; factory_code?: string; display_name?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const factoryId = body.factory_id?.trim() ?? "";
  const factoryName = body.factory_name?.trim() ?? "";
  const factoryCode = body.factory_code?.trim() || null;
  const displayName = body.display_name?.trim() || factoryName || email.split("@")[0];
  if (!email.includes("@") || email.includes(" ") || !factoryId) {
    return json({ error: "請填電郵和廠家" }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // supplier_logins.factory_name must be the real PMS factory name, not the
  // internal directory label (e.g. "1.向氏 QXS"). Code comes from PMS too.
  let storedFactoryName = factoryName;
  let storedFactoryCode = factoryCode;
  const pmsKey = pmsServiceRoleKey();
  if (pmsKey) {
    const pms = createClient(pmsProjectUrl(), pmsKey, { auth: { persistSession: false } });
    const { data: factory } = await pms
      .from("factories")
      .select("factory_name, factory_eng_name, factory_code")
      .eq("id", factoryId)
      .maybeSingle();
    const realName = String(factory?.factory_name ?? "").trim();
    if (realName) storedFactoryName = realName;
    if (!storedFactoryCode) storedFactoryCode = String(factory?.factory_code ?? "").trim() || null;
  }

  const { data: existing } = await admin
    .from("platform_user_profiles")
    .select("role")
    .eq("email", email)
    .maybeSingle();
  const existingRole = String(existing?.role ?? "").toLowerCase();
  if (existingRole && existingRole !== "supplier") {
    return json({ error: "這電郵已是職員或客戶帳號" }, 409);
  }

  // Do not send mail here: the first phase has no authorisation to email real
  // suppliers, and the branch hits "email rate limit exceeded". Generate an
  // invite link instead and return it once for staff to pass on.
  const redirectTo = Deno.env.get("FDS_APP_URL")?.trim() || undefined;
  const options = redirectTo ? { redirectTo } : undefined;
  let alreadyRegistered = false;
  let link = await admin.auth.admin.generateLink({ type: "invite", email, options });
  if (link.error && /already|registered|exists/i.test(link.error.message)) {
    alreadyRegistered = true;
    link = await admin.auth.admin.generateLink({ type: "magiclink", email, options });
  }
  if (link.error) {
    return json({ error: link.error.message }, 500);
  }
  const authUserId = link.data?.user?.id ?? null;
  const actionLink = link.data?.properties?.action_link ?? null;
  const { error: profileError } = await admin.from("platform_user_profiles").upsert(
    {
      email,
      display_name: storedFactoryName || displayName,
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
      factory_name: storedFactoryName,
      factory_code: storedFactoryCode,
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
    email_sent: false,
    action_link: actionLink,
  });
});

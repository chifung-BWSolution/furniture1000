import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BWF_URL_DEFAULT = "https://riaubhtruisbwdlwjzur.supabase.co";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function listAllAuthUsers(
  admin: ReturnType<typeof createClient>,
): Promise<User[]> {
  const users: User[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    users.push(...(data.users ?? []));
    if (!data.users?.length || data.users.length < perPage) break;
    page += 1;
  }

  return users;
}

async function upsertUserToBwf(
  bwfAdmin: ReturnType<typeof createClient>,
  source: User,
): Promise<"created" | "updated" | "unchanged"> {
  const email = source.email?.trim().toLowerCase();
  if (!email) return "unchanged";

  const { data: existing, error: getError } = await bwfAdmin.auth.admin.getUserById(
    source.id,
  );
  if (getError && !getError.message.toLowerCase().includes("not found")) {
    throw new Error(`getUserById failed: ${getError.message}`);
  }

  if (existing?.user) {
    const needsUpdate =
      existing.user.email?.toLowerCase() !== email ||
      JSON.stringify(existing.user.user_metadata ?? {}) !==
        JSON.stringify(source.user_metadata ?? {});

    if (!needsUpdate) return "unchanged";

    const { error: updateError } = await bwfAdmin.auth.admin.updateUserById(source.id, {
      email,
      user_metadata: source.user_metadata ?? {},
      app_metadata: source.app_metadata ?? {},
    });
    if (updateError) throw new Error(`updateUserById failed: ${updateError.message}`);
    return "updated";
  }

  const { error: createError } = await bwfAdmin.auth.admin.createUser({
    id: source.id,
    email,
    email_confirm: true,
    user_metadata: source.user_metadata ?? {},
    app_metadata: source.app_metadata ?? {},
  });
  if (createError) throw new Error(`createUser failed: ${createError.message}`);
  return "created";
}

async function syncUsers(
  pmsAdmin: ReturnType<typeof createClient>,
  bwfAdmin: ReturnType<typeof createClient>,
  userId?: string,
) {
  const users = userId
    ? [await pmsAdmin.auth.admin.getUserById(userId).then((r) => {
        if (r.error || !r.data.user) throw new Error("PMS user not found");
        return r.data.user;
      })]
    : await listAllAuthUsers(pmsAdmin);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const errors: { id: string; email: string | undefined; error: string }[] = [];

  for (const user of users) {
    try {
      const result = await upsertUserToBwf(bwfAdmin, user);
      if (result === "created") created += 1;
      else if (result === "updated") updated += 1;
      else unchanged += 1;
    } catch (err) {
      errors.push({
        id: user.id,
        email: user.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    scanned: users.length,
    created,
    updated,
    unchanged,
    errors,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const pmsUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const pmsServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bwfUrl = Deno.env.get("BWF_SUPABASE_URL") ?? BWF_URL_DEFAULT;
  const bwfServiceKey = Deno.env.get("BWF_SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const syncSecret = Deno.env.get("PMS_AUTH_SYNC_SECRET") ?? Deno.env.get("PMS_SSO_SHARED_SECRET") ?? "";

  if (!pmsUrl || !pmsServiceKey || !bwfServiceKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const provided =
    req.headers.get("x-sync-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!syncSecret || !provided || provided !== syncSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { action?: string; user_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const pmsAdmin = createClient(pmsUrl, pmsServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bwfAdmin = createClient(bwfUrl, bwfServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = body.action?.trim() || "sync";
  if (action !== "sync" && action !== "sync_one") {
    return jsonResponse({ error: 'Invalid action. Use "sync" or "sync_one".' }, 400);
  }

  if (action === "sync_one" && !body.user_id?.trim()) {
    return jsonResponse({ error: "user_id is required for sync_one" }, 400);
  }

  try {
    const result = await syncUsers(pmsAdmin, bwfAdmin, body.user_id?.trim());
    return jsonResponse({
      ok: true,
      action,
      ...result,
    });
  } catch (err) {
    console.error("[sync-pms-auth-to-bwf]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Sync failed" },
      500,
    );
  }
});

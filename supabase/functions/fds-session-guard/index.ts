import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";
import {
  evaluateSessionState,
  extractClientIp,
  isSameAuthSignIn,
  isSessionExpired,
  normalizeIp,
} from "../_shared/sessionGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveDisplayName(
  admin: SupabaseClient,
  user: User,
  explicitName?: string | null,
): Promise<string | null> {
  const explicit = explicitName?.trim();
  if (explicit) return explicit;

  const { data: byId } = await admin
    .from("platform_user_profiles")
    .select("display_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const idName = (byId as { display_name?: string | null } | null)?.display_name?.trim();
  if (idName) return idName;

  if (user.email) {
    const { data: byEmail } = await admin
      .from("platform_user_profiles")
      .select("display_name")
      .eq("email", user.email.toLowerCase())
      .maybeSingle();
    const emailName = (byEmail as { display_name?: string | null } | null)?.display_name?.trim();
    if (emailName) return emailName;
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = String(meta.full_name ?? meta.name ?? "").trim();
  return metaName || null;
}

async function insertForcedLogoutOnce(
  admin: SupabaseClient,
  args: {
    user: User;
    userName: string | null;
    event: "forced_logout_ip_mismatch" | "forced_logout_session_expired";
    loginMethod: "password" | "sso";
    ipAddress: string | null;
    userAgent: string | null;
    sessionId: string | null;
  },
): Promise<void> {
  const cutoffIso = new Date(Date.now() - 60_000).toISOString();
  const { data: recent } = await admin
    .from("login_log")
    .select("id, ip_address")
    .eq("user_id", args.user.id)
    .eq("event", args.event)
    .gte("logged_at", cutoffIso)
    .limit(5);

  const alreadyLogged = (recent ?? []).some(
    (row) => normalizeIp((row as { ip_address?: string | null }).ip_address) === args.ipAddress,
  );
  if (alreadyLogged) return;

  const { error } = await admin.from("login_log").insert({
    user_id: args.user.id,
    user_email: args.user.email ?? null,
    user_name: args.userName,
    event: args.event,
    login_method: args.loginMethod,
    ip_address: args.ipAddress,
    user_agent: args.userAgent,
    session_id: args.sessionId,
    auth_last_sign_in_at: args.user.last_sign_in_at ?? null,
    logged_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("[fds-session-guard] forced_logout insert failed:", error.message);
  }
}

async function handleRecordLogin(
  admin: SupabaseClient,
  user: User,
  req: Request,
  body: Record<string, unknown>,
) {
  const clientIp = extractClientIp(req.headers);
  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  const loginMethod = body.login_method === "sso" ? "sso" : "password";
  const authLastSignInAt = user.last_sign_in_at ?? null;
  const userName = await resolveDisplayName(
    admin,
    user,
    typeof body.user_name === "string" ? body.user_name : null,
  );

  if (isSessionExpired(authLastSignInAt)) {
    await insertForcedLogoutOnce(admin, {
      user,
      userName,
      event: "forced_logout_session_expired",
      loginMethod,
      ipAddress: clientIp,
      userAgent,
      sessionId: typeof body.session_id === "string" ? body.session_id : null,
    });
    return jsonResponse({
      ok: false,
      expired: true,
      reason: "session_expired",
      boundIp: clientIp,
    });
  }

  const { data: existingActive } = await admin
    .from("fds_active_sessions")
    .select("session_id, bound_ip, session_started_at")
    .eq("user_id", user.id)
    .maybeSingle();

  let hasMatchingLoginRow = false;
  if (authLastSignInAt) {
    let logQuery = admin
      .from("login_log")
      .select("id")
      .eq("user_id", user.id)
      .eq("event", "login")
      .eq("auth_last_sign_in_at", authLastSignInAt)
      .limit(1);
    logQuery = clientIp ? logQuery.eq("ip_address", clientIp) : logQuery.is("ip_address", null);
    const { data: existingLogs } = await logQuery;
    hasMatchingLoginRow = (existingLogs ?? []).length > 0;
  }

  const nowIso = new Date().toISOString();
  const active = existingActive as
    | { session_id: string; bound_ip: string | null; session_started_at: string }
    | null;

  const sameSignIn = Boolean(
    active &&
      isSameAuthSignIn(active.session_started_at, authLastSignInAt) &&
      !isSessionExpired(active.session_started_at),
  );

  if (sameSignIn && active) {
    const ipChanged = Boolean(clientIp) && normalizeIp(active.bound_ip) !== clientIp;
    if (ipChanged && !hasMatchingLoginRow) {
      const { error: logErr } = await admin.from("login_log").insert({
        user_id: user.id,
        user_email: user.email ?? null,
        user_name: userName,
        event: "login",
        login_method: loginMethod,
        ip_address: clientIp,
        user_agent: userAgent,
        session_id: active.session_id,
        auth_last_sign_in_at: authLastSignInAt,
        logged_at: nowIso,
      });
      if (logErr) {
        console.warn("[fds-session-guard] login_log insert failed:", logErr.message);
      }
    }

    await admin
      .from("fds_active_sessions")
      .update({
        ...(ipChanged ? { bound_ip: clientIp, user_agent: userAgent } : {}),
        last_verified_at: nowIso,
        updated_at: nowIso,
      })
      .eq("user_id", user.id);

    return jsonResponse({
      ok: true,
      deduplicated: !ipChanged,
      sessionId: active.session_id,
      boundIp: ipChanged ? clientIp : active.bound_ip,
      sessionStartedAt: active.session_started_at,
    });
  }

  const sessionId = crypto.randomUUID();
  const sessionStartedAt = authLastSignInAt ?? nowIso;

  if (!hasMatchingLoginRow) {
    const { error: logErr } = await admin.from("login_log").insert({
      user_id: user.id,
      user_email: user.email ?? null,
      user_name: userName,
      event: "login",
      login_method: loginMethod,
      ip_address: clientIp,
      user_agent: userAgent,
      session_id: sessionId,
      auth_last_sign_in_at: authLastSignInAt,
      logged_at: nowIso,
    });
    if (logErr) {
      console.warn("[fds-session-guard] login_log insert failed:", logErr.message);
    }
  }

  const { error: upsertErr } = await admin.from("fds_active_sessions").upsert(
    {
      user_id: user.id,
      session_id: sessionId,
      bound_ip: clientIp,
      user_agent: userAgent,
      session_started_at: sessionStartedAt,
      last_verified_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );
  if (upsertErr) {
    console.warn("[fds-session-guard] active_session upsert failed:", upsertErr.message);
  }

  return jsonResponse({
    ok: true,
    deduplicated: false,
    sessionId,
    boundIp: clientIp,
    sessionStartedAt,
  });
}

async function handleVerifySession(
  admin: SupabaseClient,
  user: User,
  req: Request,
  body: Record<string, unknown>,
) {
  const clientIp = extractClientIp(req.headers);
  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  const requestSessionId =
    typeof body.session_id === "string" ? body.session_id.trim() || null : null;
  const loginMethod = body.login_method === "sso" ? "sso" : "password";

  const { data: activeRow } = await admin
    .from("fds_active_sessions")
    .select("session_id, bound_ip, session_started_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const activeSession = activeRow as
    | { session_id: string; bound_ip: string | null; session_started_at: string }
    | null;

  const verdict = evaluateSessionState({
    activeSession,
    requestSessionId,
    requestIp: clientIp,
    authLastSignInAt: user.last_sign_in_at ?? null,
  });

  const nowIso = new Date().toISOString();

  if (!verdict.valid) {
    const userName = await resolveDisplayName(admin, user);
    const event =
      verdict.reason === "session_expired"
        ? "forced_logout_session_expired"
        : "forced_logout_ip_mismatch";

    await insertForcedLogoutOnce(admin, {
      user,
      userName,
      event,
      loginMethod,
      ipAddress: clientIp,
      userAgent,
      sessionId: requestSessionId ?? activeSession?.session_id ?? null,
    });

    if (activeSession && verdict.reason === "session_expired") {
      await admin
        .from("fds_active_sessions")
        .delete()
        .eq("user_id", user.id)
        .eq("session_id", activeSession.session_id);
    }

    return jsonResponse({
      valid: false,
      reason: verdict.reason,
      currentIp: clientIp,
      boundIp: activeSession?.bound_ip ?? null,
    });
  }

  const boundIp = normalizeIp(activeSession?.bound_ip);
  const ipChanged = Boolean(activeSession && clientIp && boundIp !== clientIp);

  if (activeSession && ipChanged) {
    const authLastSignInAt = user.last_sign_in_at ?? null;
    let alreadyLogged = false;
    if (authLastSignInAt) {
      const { data: existingLogs } = await admin
        .from("login_log")
        .select("id")
        .eq("user_id", user.id)
        .eq("event", "login")
        .eq("auth_last_sign_in_at", authLastSignInAt)
        .eq("ip_address", clientIp)
        .limit(1);
      alreadyLogged = (existingLogs ?? []).length > 0;
    }
    if (!alreadyLogged) {
      const userName = await resolveDisplayName(admin, user);
      const { error: logErr } = await admin.from("login_log").insert({
        user_id: user.id,
        user_email: user.email ?? null,
        user_name: userName,
        event: "login",
        login_method: loginMethod,
        ip_address: clientIp,
        user_agent: userAgent,
        session_id: activeSession.session_id,
        auth_last_sign_in_at: authLastSignInAt,
        logged_at: nowIso,
      });
      if (logErr) {
        console.warn("[fds-session-guard] login_log insert failed:", logErr.message);
      }
    }
  }

  if (activeSession) {
    await admin
      .from("fds_active_sessions")
      .update({
        ...(ipChanged ? { bound_ip: clientIp, user_agent: userAgent } : {}),
        last_verified_at: nowIso,
        updated_at: nowIso,
      })
      .eq("user_id", user.id);
  }

  return jsonResponse({
    valid: true,
    sessionId: activeSession?.session_id ?? null,
    boundIp: ipChanged ? clientIp : activeSession?.bound_ip ?? clientIp,
    sessionStartedAt:
      activeSession?.session_started_at ?? user.last_sign_in_at ?? nowIso,
  });
}

async function handleRecordLogout(
  admin: SupabaseClient,
  user: User,
  req: Request,
  body: Record<string, unknown>,
) {
  const clientIp = extractClientIp(req.headers);
  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  const requestSessionId =
    typeof body.session_id === "string" ? body.session_id.trim() || null : null;
  const loginMethod = body.login_method === "sso" ? "sso" : "password";
  const userName = await resolveDisplayName(
    admin,
    user,
    typeof body.user_name === "string" ? body.user_name : null,
  );

  const { error: logErr } = await admin.from("login_log").insert({
    user_id: user.id,
    user_email: user.email ?? null,
    user_name: userName,
    event: "logout",
    login_method: loginMethod,
    ip_address: clientIp,
    user_agent: userAgent,
    session_id: requestSessionId,
    auth_last_sign_in_at: user.last_sign_in_at ?? null,
    logged_at: new Date().toISOString(),
  });
  if (logErr) {
    console.warn("[fds-session-guard] logout insert failed:", logErr.message);
  }

  const deleteQuery = admin.from("fds_active_sessions").delete().eq("user_id", user.id);
  if (requestSessionId) {
    await deleteQuery.eq("session_id", requestSessionId);
  } else {
    await deleteQuery;
  }

  return jsonResponse({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
  if (!jwt) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = typeof body.action === "string" ? body.action.trim() : "";

  if (action === "record_login") {
    return handleRecordLogin(admin, userData.user, req, body);
  }
  if (action === "verify_session") {
    return handleVerifySession(admin, userData.user, req, body);
  }
  if (action === "record_logout") {
    return handleRecordLogout(admin, userData.user, req, body);
  }

  return jsonResponse(
    { error: 'Invalid action. Use "record_login", "verify_session", or "record_logout".' },
    400,
  );
});

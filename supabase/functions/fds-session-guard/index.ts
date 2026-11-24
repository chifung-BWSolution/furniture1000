import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractClientIp(headers: Headers): string | null {
  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp.slice(0, 128);
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = headers.get("x-real-ip")?.trim();
  return realIp ? realIp.slice(0, 128) : null;
}

function authSessionIdFromAccessToken(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    const sessionId = payload?.session_id;
    if (typeof sessionId === "string" && UUID_RE.test(sessionId)) return sessionId;
  } catch {
    return null;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  // Cached clients from the morning IP-binding build send record_login /
  // verify_session without this marker. Answer valid and do not write, so
  // they cannot mint a new id or kick a tab.
  if (body.protocol !== "auth-session") {
    return jsonResponse({ ok: true, valid: true, deduplicated: true });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!["register_session", "verify_session", "clear_session"].includes(action)) {
    return jsonResponse({ error: "invalid_session_action" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "session_guard_failed" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authorization = req.headers.get("Authorization")?.trim() || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return jsonResponse({ error: "authentication_required" }, 401);
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ error: "authentication_required" }, 401);
  }

  const authSessionId = authSessionIdFromAccessToken(token);
  if (!authSessionId) {
    return jsonResponse({ error: "authentication_required" }, 401);
  }

  const loginMethod = body.login_method === "sso" ? "sso" : "password";
  const userName = typeof body.user_name === "string" ? body.user_name.slice(0, 200) : null;

  const { data, error } = await admin.rpc("fds_check_login_session", {
    p_user_id: userData.user.id,
    p_auth_session_id: authSessionId,
    p_action: action,
    p_ip: extractClientIp(req.headers),
    p_user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
    p_email: userData.user.email ?? null,
    p_user_name: userName,
    p_login_method: loginMethod,
    p_record_login: body.record_login === true,
  });

  if (error) {
    console.warn("[fds-session-guard] rpc failed:", error.message);
    return jsonResponse({ error: "session_guard_failed" }, 500);
  }

  return jsonResponse(data ?? { ok: true, valid: true });
});

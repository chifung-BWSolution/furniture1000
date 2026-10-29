import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * FDS-12 Asana OAuth（對齊 QMS 的每用戶授權模型）。
 *
 * - start：回傳 Asana authorize URL（state 以 service key HMAC 簽名，含 auth uid + 10 分鐘期限）
 * - callback：用 code 換 access/refresh token，查 /users/me，寫入 fds_asana_oauth_tokens
 * - status：回傳目前用戶是否已連接
 * - disconnect：刪除目前用戶的 token
 *
 * Token 只在 edge 與 service_role 之間流動；瀏覽器只拿到 authorize URL。
 * Edge secrets：ASANA_CLIENT_ID、ASANA_CLIENT_SECRET、FDS_ASANA_REDIRECT_URI。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["admin", "uploader", "pm"];
const TOKEN_URL = "https://app.asana.com/-/oauth_token";
const AUTHORIZE_URL = "https://app.asana.com/-/oauth_authorize";
const STATE_TTL_MS = 10 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}

function redirectUri(): string {
  return (Deno.env.get("FDS_ASANA_REDIRECT_URI") ?? "").trim()
    || "https://www.bwteam-furniture.com/fds/asana/callback";
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Asana redirects the browser here with ?code&state (no Authorization header).
  // The signed state carries the FDS auth uid, so it can be trusted for this one exchange.
  if (req.method === "GET") {
    const requestUrl = new URL(req.url);
    const code = (requestUrl.searchParams.get("code") ?? "").trim();
    const state = (requestUrl.searchParams.get("state") ?? "").trim();
    const appUrl = (Deno.env.get("FDS_APP_URL") ?? "").trim().replace(/\/+$/, "");
    const back = (status: string) => `${appUrl || ""}/fds/factories?asana=${status}`;
    try {
      const clientId = Deno.env.get("ASANA_CLIENT_ID") ?? "";
      const clientSecret = Deno.env.get("ASANA_CLIENT_SECRET") ?? "";
      const stateSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const [encoded, signature] = state.split(".");
      const payload = encoded
        ? new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))
        : "";
      const [uid, expText] = payload.split(".");
      if (!code || !uid || !signature || (await hmac(stateSecret, payload)) !== signature || Number(expText) < Date.now()) {
        return Response.redirect(back("error"), 302);
      }
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri(),
          code,
        }).toString(),
      });
      const token = await tokenRes.json().catch(() => null);
      if (!tokenRes.ok || !token?.access_token) return Response.redirect(back("error"), 302);
      let profile: { data?: { gid?: string; name?: string } } = {};
      try {
        const me = await fetch("https://app.asana.com/api/1.0/users/me?opt_fields=name", {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        profile = await me.json();
      } catch {
        profile = {};
      }
      const admin = adminClient();
      const { error: saveError } = await admin.rpc("fds_asana_oauth_save", {
        p_auth_user_id: uid,
        p_access_token: token.access_token,
        p_refresh_token: token.refresh_token ?? null,
        p_expires_at: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null,
        p_asana_user_gid: profile.data?.gid ?? null,
        p_asana_user_name: profile.data?.name ?? null,
      });
      if (saveError) return Response.redirect(back("error"), 302);
      return Response.redirect(back("connected"), 302);
    } catch {
      return Response.redirect(back("error"), 302);
    }
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !authHeader) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { data: allowed } = await userClient.rpc("bwf_has_role", { p_roles: ROLES });
  if (allowed !== true) return json({ error: "permission_denied" }, 403);

  const clientId = Deno.env.get("ASANA_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("ASANA_CLIENT_SECRET") ?? "";
  const stateSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!clientId || !clientSecret || !stateSecret) return json({ error: "asana_not_configured" }, 503);

  let body: { action?: string; code?: string; state?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const admin = adminClient();

  if (body.action === "start") {
    const exp = Date.now() + STATE_TTL_MS;
    const payload = `${userId}.${exp}`;
    const state = `${b64url(new TextEncoder().encode(payload))}.${await hmac(stateSecret, payload)}`;
    const authorize = `${AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri())}&state=${encodeURIComponent(state)}`;
    return json({ authorize_url: authorize, redirect_uri: redirectUri() });
  }

  if (body.action === "callback") {
    const [encoded, signature] = String(body.state ?? "").split(".");
    if (!encoded || !signature) return json({ error: "invalid_state" }, 400);
    let payload = "";
    try {
      payload = new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
    } catch {
      return json({ error: "invalid_state" }, 400);
    }
    const [stateUid, expText] = payload.split(".");
    if (stateUid !== userId) return json({ error: "invalid_state" }, 403);
    if (!expText || Number(expText) < Date.now()) return json({ error: "state_expired" }, 400);
    if ((await hmac(stateSecret, payload)) !== signature) return json({ error: "invalid_state" }, 403);
    const code = String(body.code ?? "").trim();
    if (!code) return json({ error: "missing_code" }, 400);

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      code,
    });
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const token = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !token?.access_token) {
      return json({ error: "token_exchange_failed", detail: token?.error ?? null }, 400);
    }
    let profile: { data?: { gid?: string; name?: string } } = {};
    try {
      const me = await fetch("https://app.asana.com/api/1.0/users/me?opt_fields=name", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      profile = await me.json();
    } catch {
      profile = {};
    }
    const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
    const { error: saveError } = await admin.rpc("fds_asana_oauth_save", {
      p_auth_user_id: userId,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token ?? null,
      p_expires_at: expiresAt,
      p_asana_user_gid: profile.data?.gid ?? null,
      p_asana_user_name: profile.data?.name ?? null,
    });
    if (saveError) return json({ error: saveError.message }, 500);
    return json({ ok: true, asana_user_name: profile.data?.name ?? null });
  }

  if (body.action === "disconnect") {
    const { error } = await admin.from("fds_asana_oauth_tokens").delete().eq("auth_user_id", userId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // default: status
  const { data: row, error } = await admin
    .from("fds_asana_oauth_tokens")
    .select("asana_user_name,asana_user_gid,expires_at,connected_at")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  return json({ connected: Boolean(row), ...(row ?? {}) });
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-pms-sso-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CODE_TTL_SECONDS = 300; // 5 minutes

function extractClientIp(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp.slice(0, 128);
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp ? realIp.slice(0, 128) : null;
}

function authSessionIdFromAccessToken(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    const sessionId = payload?.session_id;
    if (
      typeof sessionId === "string" &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)
    ) {
      return sessionId;
    }
  } catch {
    return null;
  }
  return null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function handleMint(
  admin: ReturnType<typeof createClient>,
  body: { user_id?: string; email?: string; redirect_to?: string },
  furnitureAppUrl: string,
) {
  const userId = body.user_id?.trim();
  const email = body.email?.trim()?.toLowerCase();

  if (!userId || !email) {
    return jsonResponse({ error: "user_id and email are required" }, 400);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(
    userId,
  );
  if (userError || !userData.user) {
    return jsonResponse(
      {
        error: "User not found in Furniture auth.users",
        hint: "Run scripts/sync-pms-auth-to-bwf.mjs to sync PMS users first.",
      },
      404,
    );
  }

  if (userData.user.email?.toLowerCase() !== email) {
    return jsonResponse({ error: "email does not match synced user record" }, 400);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

  const { error: insertError } = await admin.from("pms_sso_codes").insert({
    code,
    user_id: userId,
    email,
    expires_at: expiresAt,
  });

  if (insertError) {
    console.error("[pms-sso] insert failed:", insertError.message);
    return jsonResponse({ error: "Failed to create SSO code" }, 500);
  }

  const baseUrl = furnitureAppUrl.replace(/\/+$/, "");
  const callbackPath = `${baseUrl}/auth/pms/callback`;
  const rawRedirect = body.redirect_to?.trim() || "";

  // Accept either:
  // 1) Full callback URL (optionally already carrying nested redirect_to)
  // 2) Final in-app path+query (e.g. /quote/quick?pmsPitchingId=...) — wrap into callback
  let redirectTo = callbackPath;
  if (rawRedirect) {
    if (
      rawRedirect.startsWith(callbackPath) ||
      rawRedirect.includes("/auth/pms/callback")
    ) {
      redirectTo = rawRedirect;
    } else if (rawRedirect.startsWith("/")) {
      redirectTo = `${callbackPath}?redirect_to=${encodeURIComponent(rawRedirect)}`;
    } else {
      // Absolute Furniture URL → extract path+search if same app, else keep as callback nest
      try {
        const u = new URL(rawRedirect);
        const furnitureHost = new URL(baseUrl).host;
        if (u.host === furnitureHost) {
          if (u.pathname.includes("/auth/pms/callback")) {
            redirectTo = rawRedirect;
          } else {
            const finalPath = `${u.pathname}${u.search}`;
            redirectTo = `${callbackPath}?redirect_to=${encodeURIComponent(finalPath)}`;
          }
        } else {
          redirectTo = `${callbackPath}?redirect_to=${encodeURIComponent(rawRedirect)}`;
        }
      } catch {
        redirectTo = callbackPath;
      }
    }
  }

  const exchangeUrl = `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`;

  return jsonResponse({
    code,
    exchange_url: exchangeUrl,
    expires_at: expiresAt,
    expires_in: CODE_TTL_SECONDS,
  });
}

async function handleExchange(
  admin: ReturnType<typeof createClient>,
  body: { code?: string },
  req: Request,
) {
  const code = body.code?.trim();
  if (!code) {
    return jsonResponse({ error: "code is required" }, 400);
  }

  const { data: row, error: fetchError } = await admin
    .from("pms_sso_codes")
    .select("id, user_id, email, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();

  if (fetchError || !row) {
    return jsonResponse({ error: "Invalid or expired SSO code" }, 401);
  }

  if (row.used_at) {
    return jsonResponse({ error: "SSO code already used" }, 401);
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return jsonResponse({ error: "SSO code expired" }, 401);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: row.email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("[pms-sso] generateLink failed:", linkError?.message);
    return jsonResponse({ error: "Failed to create session" }, 500);
  }

  const { data: sessionData, error: verifyError } = await admin.auth.verifyOtp({
    type: "email",
    token_hash: linkData.properties.hashed_token,
  });

  if (verifyError || !sessionData.session) {
    console.error("[pms-sso] verifyOtp failed:", verifyError?.message);
    return jsonResponse({ error: "Failed to verify session" }, 500);
  }

  const { error: markError } = await admin
    .from("pms_sso_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null);

  if (markError) {
    console.error("[pms-sso] mark used failed:", markError.message);
  }

  const session = sessionData.session;
  const authSessionId = authSessionIdFromAccessToken(session.access_token);
  if (authSessionId) {
    const { error: sessionError } = await admin.rpc("fds_check_login_session", {
      p_user_id: row.user_id,
      p_auth_session_id: authSessionId,
      p_action: "register_session",
      p_ip: extractClientIp(req),
      p_user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
      p_email: row.email,
      p_user_name: null,
      p_login_method: "sso",
      p_record_login: true,
    });
    if (sessionError) {
      console.warn("[pms-sso] session register failed:", sessionError.message);
    }
  }
  const user = sessionData.user;

  return jsonResponse({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: {
      id: user?.id,
      email: user?.email,
      user_metadata: user?.user_metadata ?? {},
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const sharedSecret = Deno.env.get("PMS_SSO_SHARED_SECRET") ?? "";
  const furnitureAppUrl =
    Deno.env.get("FURNITURE_APP_URL") ?? "https://www.bwteam-furniture.com";

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  let body: { action?: string; user_id?: string; email?: string; code?: string; redirect_to?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = body.action?.trim();

  if (action === "mint") {
    if (!sharedSecret) {
      return jsonResponse({ error: "PMS_SSO_SHARED_SECRET not configured" }, 500);
    }
    const provided =
      req.headers.get("x-pms-sso-secret") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    if (!provided || provided !== sharedSecret) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    return handleMint(admin, body, furnitureAppUrl);
  }

  if (action === "exchange") {
    return handleExchange(admin, body, req);
  }

  return jsonResponse(
    { error: 'Invalid action. Use "mint" (PMS server) or "exchange" (Furniture client).' },
    400,
  );
});

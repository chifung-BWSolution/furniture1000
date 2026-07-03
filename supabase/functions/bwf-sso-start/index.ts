import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BWF_URL_DEFAULT = "https://riaubhtruisbwdlwjzur.supabase.co";
const FURNITURE_APP_DEFAULT = "https://www.bwteam-furniture.com";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function syncOneUserToBwf(userId: string, pmsUrl: string, syncSecret: string) {
  const res = await fetch(
    `${pmsUrl}/functions/v1/supabase-functions-sync-pms-auth-to-bwf`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": syncSecret,
      },
      body: JSON.stringify({ action: "sync_one", user_id: userId }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn("[bwf-sso-start] sync_one failed:", data?.error || res.status);
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const pmsUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const pmsAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const bwfUrl = Deno.env.get("BWF_SUPABASE_URL") ?? BWF_URL_DEFAULT;
  const sharedSecret = Deno.env.get("PMS_SSO_SHARED_SECRET") ?? "";
  const furnitureAppUrl =
    Deno.env.get("FURNITURE_APP_URL") ?? FURNITURE_APP_DEFAULT;

  if (!pmsUrl || !pmsAnonKey || !sharedSecret) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const pmsClient = createClient(pmsUrl, pmsAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await pmsClient.auth.getUser();
  const user = userData.user;
  if (userError || !user?.id || !user.email) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  await syncOneUserToBwf(user.id, pmsUrl, sharedSecret);

  const redirectTo =
    `${furnitureAppUrl.replace(/\/+$/, "")}/auth/pms/callback`;

  const mintRes = await fetch(`${bwfUrl}/functions/v1/supabase-functions-pms-sso`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pms-sso-secret": sharedSecret,
    },
    body: JSON.stringify({
      action: "mint",
      user_id: user.id,
      email: user.email,
      redirect_to: redirectTo,
    }),
  });

  const mintData = await mintRes.json().catch(() => ({}));
  if (!mintRes.ok) {
    return jsonResponse(
      { error: mintData?.error || "Failed to mint SSO code", details: mintData },
      mintRes.status,
    );
  }

  return jsonResponse({
    exchange_url: mintData.exchange_url,
    expires_at: mintData.expires_at,
    expires_in: mintData.expires_in,
  });
});

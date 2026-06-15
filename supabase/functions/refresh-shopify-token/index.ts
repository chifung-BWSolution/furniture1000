import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * refresh-shopify-token (v12 — client_credentials primary)
 *
 * Every hour pg_cron calls this function via net.http_post.
 * It fetches a fresh access_token from Shopify using client_credentials
 * (or refresh_token if one is stored), then:
 *   1. Writes the new access_token to shopify_connections.access_token
 *   2. Updates the SHOPIFY_ACCESS_TOKEN Edge Function secret
 *   3. Verifies the new token works against the Shopify API
 *
 * client_id / client_secret are read from shopify_connections DB row first,
 * then fall back to SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET env secrets.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const startTime = Date.now();
  console.log("[refresh-shopify-token] === Starting token refresh ===");
  console.log("[refresh-shopify-token] Timestamp:", new Date().toISOString());

  try {
    // ── 1. Load env secrets ────────────────────────────────────────────
    const envClientId     = Deno.env.get("SHOPIFY_CLIENT_ID");
    const envClientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
    const envStoreUrl     = Deno.env.get("SHOPIFY_STORE_URL") || "office-works-360.myshopify.com";
    const supabaseUrl     = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(
        { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY secrets" },
        400
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── 2. Load connection row from DB ────────────────────────────────
    const { data: connRow, error: connErr } = await supabase
      .from("shopify_connections")
      .select("shop_domain, client_id, client_secret, refresh_token, scope, refresh_attempt_count")
      .eq("is_active", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .single();

    if (connErr || !connRow) {
      console.error("[refresh-shopify-token] No active shopify_connections row found:", connErr?.message);
      return jsonResponse(
        {
          error: "No active Shopify connection found in shopify_connections table",
          hint: "Insert a row with shop_domain, client_id, client_secret, is_active=true",
        },
        404
      );
    }

    // client_id/secret: DB row takes precedence over env secrets
    const clientId     = connRow.client_id     || envClientId;
    const clientSecret = connRow.client_secret || envClientSecret;
    const storeDomain  = (connRow.shop_domain  || envStoreUrl)
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");

    console.log("[refresh-shopify-token] shop_domain:", storeDomain);
    console.log("[refresh-shopify-token] client_id:", clientId ? `${clientId.substring(0, 8)}...` : "⚠️ NOT SET");
    console.log("[refresh-shopify-token] client_secret:", clientSecret ? "SET (hidden)" : "⚠️ NOT SET");

    if (!clientId || !clientSecret) {
      return jsonResponse(
        {
          error: "Missing client_id or client_secret",
          hint: "Set them in shopify_connections row or as SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET Edge Function secrets",
        },
        400
      );
    }

    const storedRefreshToken = connRow.refresh_token || null;
    const currentScope       = connRow.scope || "";
    const attemptCount       = connRow.refresh_attempt_count || 0;

    // Extract project ref for Management API secret update
    const projectRef = supabaseUrl
      .replace(/^https?:\/\//, "")
      .split(".")[0];

    // ── 3. Fetch new token from Shopify with retry ─────────────────────
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[refresh-shopify-token] Attempt ${attempt}/${MAX_RETRIES} → ${storeDomain}`);

      try {
        const tokenUrl  = `https://${storeDomain}/admin/oauth/access_token`;
        const grantType = storedRefreshToken ? "refresh_token" : "client_credentials";
        console.log(`[refresh-shopify-token] grant_type: ${grantType}`);

        const tokenParams: Record<string, string> = {
          grant_type:    grantType,
          client_id:     clientId,
          client_secret: clientSecret,
        };
        if (storedRefreshToken) tokenParams.refresh_token = storedRefreshToken;

        const tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams(tokenParams).toString(),
        });

        const responseText = await tokenResponse.text();
        console.log("[refresh-shopify-token] Shopify status:", tokenResponse.status);

        if (!tokenResponse.ok) {
          lastError = `Shopify ${tokenResponse.status}: ${responseText.substring(0, 300)}`;
          console.error(`[refresh-shopify-token] ❌ Attempt ${attempt}: ${lastError}`);

          await supabase.from("shopify_connections").update({
            last_refresh_error:   `[Attempt ${attempt}] ${lastError}`,
            refresh_attempt_count: attemptCount + attempt,
            updated_at:           new Date().toISOString(),
          }).eq("shop_domain", storeDomain);

          if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); continue; }
          return jsonResponse({ error: lastError, retries_exhausted: true, grant_type: grantType }, 502);
        }

        let tokenData: Record<string, unknown>;
        try {
          tokenData = JSON.parse(responseText);
        } catch {
          lastError = "Non-JSON response from Shopify";
          if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); continue; }
          return jsonResponse({ error: lastError, raw_preview: responseText.substring(0, 500) }, 502);
        }

        const newAccessToken        = tokenData.access_token as string;
        const newRefreshToken       = (tokenData.refresh_token as string) || null;
        const expiresIn             = (tokenData.expires_in as number) || null;
        const refreshTokenExpiresIn = (tokenData.refresh_token_expires_in as number) || null;
        const scope                 = (tokenData.scope as string) || currentScope;

        if (!newAccessToken) {
          lastError = "No access_token in Shopify response";
          if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); continue; }
          return jsonResponse({ error: lastError }, 400);
        }

        console.log("[refresh-shopify-token] ✅ New access_token:", newAccessToken.substring(0, 12) + "...");

        // ── 4. Write new token to shopify_connections ──────────────────
        const now = new Date();
        const upsertPayload: Record<string, unknown> = {
          shop_domain:          storeDomain,
          access_token:         newAccessToken,
          scope,
          connected_at:         now.toISOString(),
          updated_at:           now.toISOString(),
          is_active:            true,
          last_refresh_error:   null,
          refresh_attempt_count: 0,
          client_id:            clientId,
          client_secret:        clientSecret,
        };

        if (newRefreshToken)       upsertPayload.refresh_token          = newRefreshToken;
        if (expiresIn)             upsertPayload.token_expires_at        = new Date(now.getTime() + expiresIn * 1000).toISOString();
        if (refreshTokenExpiresIn) upsertPayload.refresh_token_expires_at = new Date(now.getTime() + refreshTokenExpiresIn * 1000).toISOString();

        const { error: upsertError } = await supabase
          .from("shopify_connections")
          .upsert(upsertPayload, { onConflict: "shop_domain" });

        if (upsertError) {
          console.error("[refresh-shopify-token] ❌ DB upsert error:", JSON.stringify(upsertError));
        } else {
          console.log("[refresh-shopify-token] ✅ access_token saved to shopify_connections for:", storeDomain);
        }

        // ── 5. Update SHOPIFY_ACCESS_TOKEN Edge Function secret ────────
        let secretUpdateResult: Record<string, unknown> = { updated: false };
        try {
          const mgmtRes = await fetch(
            `https://api.supabase.com/v1/projects/${projectRef}/secrets`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify([{ name: "SHOPIFY_ACCESS_TOKEN", value: newAccessToken }]),
            }
          );
          if (mgmtRes.ok) {
            console.log("[refresh-shopify-token] ✅ SHOPIFY_ACCESS_TOKEN secret updated");
            secretUpdateResult = { updated: true };
          } else {
            const errText = await mgmtRes.text();
            console.warn("[refresh-shopify-token] ⚠️ Management API:", mgmtRes.status, errText.substring(0, 200));
            secretUpdateResult = { updated: false, status: mgmtRes.status };
          }
        } catch (e) {
          secretUpdateResult = { updated: false, error: e instanceof Error ? e.message : String(e) };
        }

        // ── 6. Verify new token works ──────────────────────────────────
        let verificationResult: Record<string, unknown> = { verified: false };
        try {
          const shopRes = await fetch(
            `https://${storeDomain}/admin/api/2024-10/shop.json`,
            { headers: { "X-Shopify-Access-Token": newAccessToken } }
          );
          if (shopRes.ok) {
            const shopData = await shopRes.json();
            verificationResult = { verified: true, shop_name: shopData.shop?.name };
            console.log("[refresh-shopify-token] ✅ Token verified — shop:", shopData.shop?.name);
          } else {
            console.warn("[refresh-shopify-token] ⚠️ Verification status:", shopRes.status);
            verificationResult = { verified: false, status: shopRes.status };
          }
        } catch (e) {
          verificationResult = { verified: false, error: e instanceof Error ? e.message : String(e) };
        }

        const elapsed = Date.now() - startTime;
        console.log(`[refresh-shopify-token] === Complete in ${elapsed}ms ===`);

        return jsonResponse({
          success:                  true,
          message:                  "Shopify access_token refreshed and stored in shopify_connections",
          grant_type:               grantType,
          shop_domain:              storeDomain,
          scope,
          token_prefix:             newAccessToken.substring(0, 12) + "...",
          new_refresh_token:        newRefreshToken ? "rotated" : "not_provided",
          token_expires_at:         upsertPayload.token_expires_at || null,
          secret_update:            secretUpdateResult,
          verification:             verificationResult,
          elapsed_ms:               elapsed,
          refreshed_at:             now.toISOString(),
          attempt,
          next_refresh:             "Scheduled every 1 hour via pg_cron (shopify-token-hourly-refresh)",
        });

      } catch (fetchError) {
        lastError = fetchError instanceof Error ? fetchError.message : String(fetchError);
        console.error(`[refresh-shopify-token] ❌ Attempt ${attempt} exception: ${lastError}`);

        await supabase.from("shopify_connections").update({
          last_refresh_error:   `[Attempt ${attempt}] Exception: ${lastError}`,
          refresh_attempt_count: attemptCount + attempt,
          updated_at:           new Date().toISOString(),
        }).eq("shop_domain", storeDomain);

        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS); }
      }
    }

    console.error(`[refresh-shopify-token] ❌ ALL RETRIES EXHAUSTED. Last error: ${lastError}`);
    return jsonResponse(
      { error: `All ${MAX_RETRIES} attempts failed. Last error: ${lastError}`, retries_exhausted: true },
      502
    );

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[refresh-shopify-token] 💥 FATAL:", msg);
    return jsonResponse({ error: `Fatal error: ${msg}` }, 500);
  }
});

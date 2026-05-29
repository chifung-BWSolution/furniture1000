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
 * refresh-shopify-token (v11 — singular, manual trigger)
 *
 * Uses the Shopify "Refresh Token" grant flow to obtain a fresh
 * access_token + refresh_token for a SINGLE store, and:
 *   1. Stores both tokens in the shopify_connections table
 *   2. Updates the SHOPIFY_ACCESS_TOKEN Edge Function secret via Management API
 *   3. Verifies the new token works
 *
 * Falls back to client_credentials if no refresh_token is stored.
 * Includes retry logic (2 attempts) with error logging to DB.
 *
 * Required Edge Function Secrets:
 *   - SHOPIFY_CLIENT_ID
 *   - SHOPIFY_CLIENT_SECRET
 *   - SHOPIFY_STORE_URL          (e.g. office-works-360.myshopify.com)
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const startTime = Date.now();
  console.log("[refresh-shopify-token] === Starting token refresh (refresh_token flow) ===");
  console.log("[refresh-shopify-token] Timestamp:", new Date().toISOString());

  try {
    // ─── 1. Load secrets ──────────────────────────────────────────────
    const clientId = Deno.env.get("SHOPIFY_CLIENT_ID");
    const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
    const storeUrl = Deno.env.get("SHOPIFY_STORE_URL") || "office-works-360.myshopify.com";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("[refresh-shopify-token] SHOPIFY_CLIENT_ID:", clientId ? `set (${clientId.substring(0, 8)}...)` : "⚠️ NOT SET");
    console.log("[refresh-shopify-token] SHOPIFY_CLIENT_SECRET:", clientSecret ? "SET (hidden)" : "⚠️ NOT SET");
    console.log("[refresh-shopify-token] SHOPIFY_STORE_URL:", storeUrl);
    console.log("[refresh-shopify-token] SUPABASE_URL:", supabaseUrl ? "SET" : "⚠️ NOT SET");
    console.log("[refresh-shopify-token] SUPABASE_SERVICE_ROLE_KEY:", supabaseServiceKey ? "SET" : "⚠️ NOT SET");

    // Validate required secrets
    const missingSecrets: string[] = [];
    if (!clientId) missingSecrets.push("SHOPIFY_CLIENT_ID");
    if (!clientSecret) missingSecrets.push("SHOPIFY_CLIENT_SECRET");
    if (!supabaseUrl) missingSecrets.push("SUPABASE_URL");
    if (!supabaseServiceKey) missingSecrets.push("SUPABASE_SERVICE_ROLE_KEY");

    if (missingSecrets.length > 0) {
      console.error("[refresh-shopify-token] ❌ Missing secrets:", missingSecrets.join(", "));
      return jsonResponse(
        {
          error: "Missing required Edge Function secrets",
          missing_secrets: missingSecrets,
          hint: "Go to Supabase Dashboard → Edge Functions → Secrets and set: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_URL",
        },
        400
      );
    }

    // ─── 2. Clean the store domain ────────────────────────────────────
    const storeDomain = storeUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");

    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    // Extract project ref for Management API
    const projectRef = supabaseUrl!
      .replace(/^https?:\/\//, "")
      .split(".")[0];

    // ─── 3. Check if we have a refresh_token in DB ────────────────────
    const { data: connRow } = await supabase
      .from("shopify_connections")
      .select("refresh_token, scope, refresh_attempt_count")
      .eq("shop_domain", storeDomain)
      .eq("is_active", true)
      .single();

    const storedRefreshToken = connRow?.refresh_token;
    const currentScope = connRow?.scope || "";
    const attemptCount = connRow?.refresh_attempt_count || 0;

    // ─── 4. Attempt token refresh with retry ──────────────────────────
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[refresh-shopify-token] Attempt ${attempt}/${MAX_RETRIES} for ${storeDomain}...`);

      try {
        const tokenUrl = `https://${storeDomain}/admin/oauth/access_token`;

        // Use refresh_token grant if available, otherwise fall back to client_credentials
        const grantType = storedRefreshToken ? "refresh_token" : "client_credentials";
        console.log(`[refresh-shopify-token] Using grant_type: ${grantType}`);

        const tokenParams: Record<string, string> = {
          grant_type: grantType,
          client_id: clientId!,
          client_secret: clientSecret!,
        };

        if (storedRefreshToken) {
          tokenParams.refresh_token = storedRefreshToken;
        }

        const tokenPayload = new URLSearchParams(tokenParams);

        const tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: tokenPayload.toString(),
        });

        const responseText = await tokenResponse.text();
        console.log("[refresh-shopify-token] Shopify response status:", tokenResponse.status);

        if (!tokenResponse.ok) {
          lastError = `Shopify returned ${tokenResponse.status}: ${responseText.substring(0, 300)}`;
          console.error(`[refresh-shopify-token] ❌ Attempt ${attempt} failed: ${lastError}`);

          // Log to DB
          await supabase
            .from("shopify_connections")
            .update({
              last_refresh_error: `[Attempt ${attempt}] ${lastError}`,
              refresh_attempt_count: attemptCount + attempt,
              updated_at: new Date().toISOString(),
            })
            .eq("shop_domain", storeDomain);

          if (attempt < MAX_RETRIES) {
            console.log(`[refresh-shopify-token] Retrying in ${RETRY_DELAY_MS}ms...`);
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          return jsonResponse(
            {
              error: `All ${MAX_RETRIES} attempts failed. Last error: ${lastError}`,
              retries_exhausted: true,
              grant_type: grantType,
            },
            502
          );
        }

        let tokenData: Record<string, unknown>;
        try {
          tokenData = JSON.parse(responseText);
        } catch {
          lastError = "Shopify returned non-JSON response";
          console.error(`[refresh-shopify-token] ❌ ${lastError}`);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          return jsonResponse({ error: lastError, raw_preview: responseText.substring(0, 500) }, 502);
        }

        const newAccessToken = tokenData.access_token as string;
        const newRefreshToken = (tokenData.refresh_token as string) || null;
        const expiresIn = (tokenData.expires_in as number) || null;
        const refreshTokenExpiresIn = (tokenData.refresh_token_expires_in as number) || null;
        const scope = (tokenData.scope as string) || currentScope;

        if (!newAccessToken) {
          lastError = "No access_token in Shopify response";
          console.error(`[refresh-shopify-token] ❌ ${lastError}`);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          return jsonResponse({ error: lastError }, 400);
        }

        console.log("[refresh-shopify-token] ✅ New access_token:", newAccessToken.substring(0, 12) + "...");
        console.log("[refresh-shopify-token] ✅ New refresh_token:", newRefreshToken ? "rotated" : "not provided");
        console.log("[refresh-shopify-token] ✅ expires_in:", expiresIn, "refresh_token_expires_in:", refreshTokenExpiresIn);

        // ─── 5. Store both tokens in DB ──────────────────────────────
        const now = new Date();
        const upsertPayload: Record<string, unknown> = {
          shop_domain: storeDomain,
          access_token: newAccessToken,
          scope,
          connected_at: now.toISOString(),
          updated_at: now.toISOString(),
          is_active: true,
          last_refresh_error: null,
          refresh_attempt_count: 0,
        };

        if (newRefreshToken) {
          upsertPayload.refresh_token = newRefreshToken;
        }
        if (expiresIn) {
          upsertPayload.token_expires_at = new Date(now.getTime() + expiresIn * 1000).toISOString();
        }
        if (refreshTokenExpiresIn) {
          upsertPayload.refresh_token_expires_at = new Date(now.getTime() + refreshTokenExpiresIn * 1000).toISOString();
        }

        const { error: upsertError } = await supabase
          .from("shopify_connections")
          .upsert(upsertPayload, { onConflict: "shop_domain" });

        if (upsertError) {
          console.error("[refresh-shopify-token] ❌ DB upsert error:", JSON.stringify(upsertError));
        } else {
          console.log("[refresh-shopify-token] ✅ Tokens saved to DB for:", storeDomain);
        }

        // ─── 6. Update SHOPIFY_ACCESS_TOKEN secret via Management API ──
        let secretUpdateResult: Record<string, unknown> = { updated: false };
        try {
          const mgmtResponse = await fetch(
            `https://api.supabase.com/v1/projects/${projectRef}/secrets`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify([
                { name: "SHOPIFY_ACCESS_TOKEN", value: newAccessToken },
              ]),
            }
          );

          if (mgmtResponse.ok) {
            console.log("[refresh-shopify-token] ✅ SHOPIFY_ACCESS_TOKEN secret updated");
            secretUpdateResult = { updated: true };
          } else {
            const mgmtErrText = await mgmtResponse.text();
            console.warn("[refresh-shopify-token] ⚠️ Management API failed:", mgmtResponse.status, mgmtErrText.substring(0, 300));
            secretUpdateResult = { updated: false, status: mgmtResponse.status, error: mgmtErrText.substring(0, 300) };
          }
        } catch (secretErr) {
          const msg = secretErr instanceof Error ? secretErr.message : String(secretErr);
          console.warn("[refresh-shopify-token] ⚠️ Secret update error:", msg);
          secretUpdateResult = { updated: false, error: msg };
        }

        // ─── 7. Verify the new token works ─────────────────────────────
        let verificationResult: Record<string, unknown> = { verified: false };
        try {
          const shopInfoRes = await fetch(
            `https://${storeDomain}/admin/api/2024-10/shop.json`,
            { headers: { "X-Shopify-Access-Token": newAccessToken } }
          );
          if (shopInfoRes.ok) {
            const shopData = await shopInfoRes.json();
            verificationResult = {
              verified: true,
              shop_name: shopData.shop?.name,
              shop_domain: shopData.shop?.domain,
            };
            console.log("[refresh-shopify-token] ✅ Token verified — shop:", shopData.shop?.name);
          } else {
            console.warn("[refresh-shopify-token] ⚠️ Verification status:", shopInfoRes.status);
            verificationResult = { verified: false, status: shopInfoRes.status };
          }
        } catch (verifyErr) {
          const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
          verificationResult = { verified: false, error: msg };
        }

        const elapsed = Date.now() - startTime;
        console.log(`[refresh-shopify-token] === Complete in ${elapsed}ms ===`);

        return jsonResponse({
          success: true,
          message: "Shopify tokens refreshed and stored successfully",
          grant_type: grantType,
          shop_domain: storeDomain,
          scope,
          token_prefix: newAccessToken.substring(0, 12) + "...",
          new_refresh_token: newRefreshToken ? "rotated" : "not_provided",
          token_expires_at: upsertPayload.token_expires_at || null,
          refresh_token_expires_at: upsertPayload.refresh_token_expires_at || null,
          secret_update: secretUpdateResult,
          verification: verificationResult,
          elapsed_ms: elapsed,
          refreshed_at: now.toISOString(),
          attempt,
          next_refresh: "Scheduled every 1 hour via pg_cron",
        });
      } catch (fetchError) {
        lastError = fetchError instanceof Error ? fetchError.message : String(fetchError);
        console.error(`[refresh-shopify-token] ❌ Attempt ${attempt} exception: ${lastError}`);

        // Log to DB
        await supabase
          .from("shopify_connections")
          .update({
            last_refresh_error: `[Attempt ${attempt}] Exception: ${lastError}`,
            refresh_attempt_count: attemptCount + attempt,
            updated_at: new Date().toISOString(),
          })
          .eq("shop_domain", storeDomain);

        if (attempt < MAX_RETRIES) {
          console.log(`[refresh-shopify-token] Retrying in ${RETRY_DELAY_MS}ms...`);
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    // All retries exhausted
    console.error(`[refresh-shopify-token] ❌ ALL RETRIES EXHAUSTED. Last error: ${lastError}`);
    return jsonResponse(
      {
        error: `All ${MAX_RETRIES} attempts failed. Last error: ${lastError}`,
        retries_exhausted: true,
        hint: "Check Edge Function logs for full details.",
      },
      502
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    console.error("[refresh-shopify-token] 💥 FATAL ERROR:", errMsg);
    if (errStack) console.error("[refresh-shopify-token] Stack:", errStack);
    return jsonResponse(
      {
        error: `Fatal error: ${errMsg}`,
        stack: errStack,
        hint: "Check Edge Function logs for full details.",
      },
      500
    );
  }
});

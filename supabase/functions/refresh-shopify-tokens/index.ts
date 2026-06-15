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
 * refresh-shopify-tokens (v4 — cron-triggered, refresh_token flow)
 *
 * Uses the Shopify "Refresh Token" grant flow (per Shopify docs) to exchange
 * the stored refresh_token for a new access_token AND a new refresh_token.
 *
 * Shopify tokens expire after ~1 hour. Refresh tokens expire after 90 days.
 * This function runs hourly via pg_cron.
 *
 * Flow per connection:
 *   1. Read refresh_token from shopify_connections DB
 *   2. POST to https://{shop}/admin/oauth/access_token with grant_type=refresh_token
 *   3. Shopify returns { access_token, refresh_token, expires_in, refresh_token_expires_in, scope }
 *   4. Store BOTH the new access_token and new refresh_token back to DB
 *   5. Update SHOPIFY_ACCESS_TOKEN secret via Management API
 *   6. Verify the new token works
 *
 * Required Edge Function Secrets:
 *   - SHOPIFY_CLIENT_ID
 *   - SHOPIFY_CLIENT_SECRET
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (for Supabase client / DB access)
 *   - SERVICE_ROLE_KEY (for Supabase Management API calls)
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const startTime = Date.now();
  // Allow caller to force client_credentials grant (e.g. cron job passes {"grant_type":"client_credentials"})
  let forceClientCredentials = false;
  try {
    if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      if (body?.grant_type === "client_credentials") {
        forceClientCredentials = true;
      }
    }
  } catch { /* ignore parse errors */ }

  console.log("[refresh-shopify-tokens] === Starting token refresh ===");
  console.log("[refresh-shopify-tokens] Grant mode:", forceClientCredentials ? "client_credentials (forced)" : "refresh_token (preferred) + client_credentials (fallback)");
  console.log("[refresh-shopify-tokens] Timestamp:", new Date().toISOString());

  try {
    // ─── 1. Load environment ──────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseKey) {
      console.error("[refresh-shopify-tokens] ❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return jsonResponse(
        {
          error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
          hint: "Set these as Edge Function secrets.",
        },
        400
      );
    }

    if (!serviceRoleKey) {
      console.error("[refresh-shopify-tokens] ❌ Missing SERVICE_ROLE_KEY for Management API calls");
      return jsonResponse(
        {
          error: "Missing SERVICE_ROLE_KEY",
          hint: "Set SERVICE_ROLE_KEY as an Edge Function secret for Management API access.",
        },
        400
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── 2. Get ALL active shopify_connections rows ──────────────────
    const { data: connections, error: connErr } = await supabase
      .from("shopify_connections")
      .select("shop_domain, access_token, refresh_token, scope, updated_at, token_expires_at, refresh_attempt_count")
      .eq("is_active", true);

    if (connErr) {
      console.error("[refresh-shopify-tokens] ❌ DB query error:", connErr.message);
      return jsonResponse({ error: `DB error: ${connErr.message}` }, 500);
    }

    if (!connections || connections.length === 0) {
      console.log("[refresh-shopify-tokens] No active connections found.");
      return jsonResponse({
        success: true,
        message: "No active Shopify connections to refresh.",
        refreshed: 0,
      });
    }

    console.log(`[refresh-shopify-tokens] Found ${connections.length} active connection(s)`);

    // ─── 3. Resolve client_id / client_secret from env secrets ───────
    const shopifyClientId = Deno.env.get("SHOPIFY_CLIENT_ID");
    const shopifyClientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");

    if (!shopifyClientId || !shopifyClientSecret) {
      console.error("[refresh-shopify-tokens] ❌ Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
      return jsonResponse(
        {
          error: "Missing Shopify Client ID or Secret in environment variables",
          hint: "Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET as Edge Function secrets.",
          missing_secrets: [
            ...(!shopifyClientId ? ["SHOPIFY_CLIENT_ID"] : []),
            ...(!shopifyClientSecret ? ["SHOPIFY_CLIENT_SECRET"] : []),
          ],
        },
        400
      );
    }

    console.log(`[refresh-shopify-tokens] SHOPIFY_CLIENT_ID: ${shopifyClientId.substring(0, 8)}...`);

    // Extract project ref for Management API calls
    const projectRef = supabaseUrl
      .replace(/^https?:\/\//, "")
      .split(".")[0];

    // ─── 4. Refresh each connection using refresh_token flow ─────────
    const results: Record<string, unknown>[] = [];

    for (const conn of connections) {
      const storeDomain = conn.shop_domain
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "");

      console.log(`[refresh-shopify-tokens] ─── Processing ${storeDomain} ───`);

      // Use client_credentials if forced by caller OR if no refresh_token is stored
      if (forceClientCredentials || !conn.refresh_token) {
        const reason = forceClientCredentials ? "grant_type=client_credentials requested by caller" : "no refresh_token stored";
        console.log(`[refresh-shopify-tokens] Using client_credentials for ${storeDomain} (${reason})`);
        const ccResult = await attemptClientCredentialsGrant(
          storeDomain, shopifyClientId, shopifyClientSecret, supabase, projectRef, serviceRoleKey
        );
        results.push({ shop_domain: storeDomain, ...ccResult, grant_type: "client_credentials" });
        continue;
      }

      // ─── 4a. Attempt refresh_token exchange with retry ─────────────
      let lastError = "";
      let success = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[refresh-shopify-tokens] Attempt ${attempt}/${MAX_RETRIES} for ${storeDomain}...`);

        try {
          const tokenUrl = `https://${storeDomain}/admin/oauth/access_token`;
          const tokenPayload = new URLSearchParams({
            grant_type: "refresh_token",
            client_id: shopifyClientId,
            client_secret: shopifyClientSecret,
            refresh_token: conn.refresh_token,
          });

          const tokenResponse = await fetch(tokenUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: tokenPayload.toString(),
          });

          const responseText = await tokenResponse.text();
          console.log(`[refresh-shopify-tokens] Shopify response status: ${tokenResponse.status}`);

          if (!tokenResponse.ok) {
            lastError = `Shopify returned ${tokenResponse.status}: ${responseText.substring(0, 300)}`;
            console.error(`[refresh-shopify-tokens] ❌ Attempt ${attempt} failed for ${storeDomain}: ${lastError}`);

            // Log to DB for inspection in Supabase Logs
            await supabase
              .from("shopify_connections")
              .update({
                last_refresh_error: `[Attempt ${attempt}] ${lastError}`,
                refresh_attempt_count: (conn.refresh_attempt_count || 0) + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("shop_domain", storeDomain);

            if (attempt < MAX_RETRIES) {
              console.log(`[refresh-shopify-tokens] Retrying in ${RETRY_DELAY_MS}ms...`);
              await sleep(RETRY_DELAY_MS);
              continue;
            }
            break;
          }

          // Parse the response
          let tokenData: Record<string, unknown>;
          try {
            tokenData = JSON.parse(responseText);
          } catch {
            lastError = "Shopify returned non-JSON response";
            console.error(`[refresh-shopify-tokens] ❌ ${lastError} for ${storeDomain}`);
            if (attempt < MAX_RETRIES) {
              await sleep(RETRY_DELAY_MS);
              continue;
            }
            break;
          }

          const newAccessToken = tokenData.access_token as string;
          const newRefreshToken = tokenData.refresh_token as string;
          const expiresIn = tokenData.expires_in as number;
          const refreshTokenExpiresIn = tokenData.refresh_token_expires_in as number;
          const scope = (tokenData.scope as string) || conn.scope || "";

          if (!newAccessToken) {
            lastError = "No access_token in Shopify response";
            console.error(`[refresh-shopify-tokens] ❌ ${lastError} for ${storeDomain}`);
            if (attempt < MAX_RETRIES) {
              await sleep(RETRY_DELAY_MS);
              continue;
            }
            break;
          }

          console.log(`[refresh-shopify-tokens] ✅ New access_token: ${newAccessToken.substring(0, 12)}...`);
          console.log(`[refresh-shopify-tokens] ✅ New refresh_token: ${newRefreshToken ? newRefreshToken.substring(0, 12) + "..." : "NOT PROVIDED"}`);
          console.log(`[refresh-shopify-tokens] ✅ expires_in: ${expiresIn}s, refresh_token_expires_in: ${refreshTokenExpiresIn}s`);

          // ─── 4b. Save BOTH tokens back to DB ─────────────────────────
          const now = new Date();
          const tokenExpiresAt = expiresIn
            ? new Date(now.getTime() + expiresIn * 1000).toISOString()
            : null;
          const refreshTokenExpiresAt = refreshTokenExpiresIn
            ? new Date(now.getTime() + refreshTokenExpiresIn * 1000).toISOString()
            : null;

          const updatePayload: Record<string, unknown> = {
            access_token: newAccessToken,
            scope: scope,
            updated_at: now.toISOString(),
            last_refresh_error: null, // Clear any previous error
            refresh_attempt_count: 0, // Reset counter on success
            token_expires_at: tokenExpiresAt,
          };

          // CRITICAL: Store the NEW refresh_token (it changes each time per Shopify docs)
          if (newRefreshToken) {
            updatePayload.refresh_token = newRefreshToken;
            updatePayload.refresh_token_expires_at = refreshTokenExpiresAt;
          }

          const { error: dbError } = await supabase
            .from("shopify_connections")
            .update(updatePayload)
            .eq("shop_domain", storeDomain);

          if (dbError) {
            lastError = `Token obtained but DB update failed: ${dbError.message}`;
            console.error(`[refresh-shopify-tokens] ❌ ${lastError}`);
            // Still attempt to update secret even if DB fails
          } else {
            console.log(`[refresh-shopify-tokens] ✅ Both tokens saved to DB for ${storeDomain}`);
          }

          // ─── 4c. Update SHOPIFY_ACCESS_TOKEN secret via Management API ──
          let secretUpdated = false;
          try {
            const mgmtResponse = await fetch(
              `https://api.supabase.com/v1/projects/${projectRef}/secrets`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify([
                  {
                    name: "SHOPIFY_ACCESS_TOKEN",
                    value: newAccessToken,
                  },
                ]),
              }
            );

            if (mgmtResponse.ok) {
              secretUpdated = true;
              console.log(`[refresh-shopify-tokens] ✅ SHOPIFY_ACCESS_TOKEN secret updated via Management API`);
            } else {
              const mgmtErrText = await mgmtResponse.text();
              console.warn(`[refresh-shopify-tokens] ⚠️ Management API secret update failed (${mgmtResponse.status}): ${mgmtErrText.substring(0, 300)}`);
            }
          } catch (secretErr) {
            const secretErrMsg = secretErr instanceof Error ? secretErr.message : String(secretErr);
            console.warn(`[refresh-shopify-tokens] ⚠️ Secret update error: ${secretErrMsg}`);
          }

          // ─── 4d. Verify the new token works ─────────────────────────
          let verified = false;
          try {
            const verifyRes = await fetch(
              `https://${storeDomain}/admin/api/2024-10/shop.json`,
              { headers: { "X-Shopify-Access-Token": newAccessToken } }
            );
            verified = verifyRes.ok;
            if (!verified) {
              console.warn(`[refresh-shopify-tokens] ⚠️ Token verification failed (${verifyRes.status}) for ${storeDomain}`);
            } else {
              console.log(`[refresh-shopify-tokens] ✅ Token verified for ${storeDomain}`);
            }
          } catch (verifyErr) {
            console.warn(`[refresh-shopify-tokens] ⚠️ Token verification network error:`, verifyErr);
          }

          results.push({
            shop_domain: storeDomain,
            success: true,
            grant_type: "refresh_token",
            verified,
            secret_updated: secretUpdated,
            token_prefix: newAccessToken.substring(0, 12) + "...",
            new_refresh_token: newRefreshToken ? "rotated" : "not_provided",
            token_expires_at: tokenExpiresAt,
            refresh_token_expires_at: refreshTokenExpiresAt,
            scope,
            attempt,
          });

          success = true;
          break; // Exit retry loop on success
        } catch (shopErr) {
          lastError = shopErr instanceof Error ? shopErr.message : String(shopErr);
          console.error(`[refresh-shopify-tokens] ❌ Attempt ${attempt} exception for ${storeDomain}: ${lastError}`);

          // Log error to DB
          await supabase
            .from("shopify_connections")
            .update({
              last_refresh_error: `[Attempt ${attempt}] Exception: ${lastError}`,
              refresh_attempt_count: (conn.refresh_attempt_count || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("shop_domain", storeDomain);

          if (attempt < MAX_RETRIES) {
            console.log(`[refresh-shopify-tokens] Retrying in ${RETRY_DELAY_MS}ms...`);
            await sleep(RETRY_DELAY_MS);
          }
        }
      }

      if (!success) {
        // All retries exhausted — log final error to DB for Logs inspection
        console.error(`[refresh-shopify-tokens] ❌ ALL RETRIES EXHAUSTED for ${storeDomain}. Last error: ${lastError}`);
        await supabase
          .from("shopify_connections")
          .update({
            last_refresh_error: `[FINAL] All ${MAX_RETRIES} attempts failed. Last error: ${lastError}`,
            refresh_attempt_count: (conn.refresh_attempt_count || 0) + MAX_RETRIES,
            updated_at: new Date().toISOString(),
          })
          .eq("shop_domain", storeDomain);

        results.push({
          shop_domain: storeDomain,
          success: false,
          grant_type: "refresh_token",
          error: lastError,
          retries_exhausted: true,
          total_attempts: MAX_RETRIES,
        });
      }
    }

    const elapsed = Date.now() - startTime;
    const successCount = results.filter((r) => r.success).length;

    console.log(`[refresh-shopify-tokens] === Complete in ${elapsed}ms: ${successCount}/${results.length} refreshed ===`);

    return jsonResponse({
      success: true,
      message: `Refreshed ${successCount}/${results.length} Shopify token(s) via refresh_token flow`,
      results,
      elapsed_ms: elapsed,
      refreshed_at: new Date().toISOString(),
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    console.error("[refresh-shopify-tokens] 💥 FATAL:", errMsg);
    if (errStack) console.error("[refresh-shopify-tokens] Stack:", errStack);
    return jsonResponse({ error: `Fatal error: ${errMsg}`, stack: errStack }, 500);
  }
});

/**
 * Fallback: Client Credentials Grant for connections without a stored refresh_token.
 * This is a legacy path for connections that were created before the refresh_token flow.
 */
async function attemptClientCredentialsGrant(
  storeDomain: string,
  clientId: string,
  clientSecret: string,
  supabase: ReturnType<typeof createClient>,
  projectRef: string,
  serviceRoleKey: string
): Promise<Record<string, unknown>> {
  console.log(`[refresh-shopify-tokens] Fallback: client_credentials grant for ${storeDomain}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tokenUrl = `https://${storeDomain}/admin/oauth/access_token`;
      const tokenPayload = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });

      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenPayload.toString(),
      });

      const responseText = await tokenResponse.text();

      if (!tokenResponse.ok) {
        console.error(`[refresh-shopify-tokens] ❌ client_credentials attempt ${attempt} failed for ${storeDomain}: ${tokenResponse.status}`);
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return {
          success: false,
          error: `Shopify returned ${tokenResponse.status}: ${responseText.substring(0, 300)}`,
          retries_exhausted: true,
        };
      }

      const tokenData = JSON.parse(responseText);
      const newAccessToken = tokenData.access_token as string;
      const scope = (tokenData.scope as string) || "";

      if (!newAccessToken) {
        return { success: false, error: "No access_token in response" };
      }

      // Save to DB
      await supabase
        .from("shopify_connections")
        .update({
          access_token: newAccessToken,
          scope,
          updated_at: new Date().toISOString(),
          last_refresh_error: null,
          refresh_attempt_count: 0,
        })
        .eq("shop_domain", storeDomain);

      // Update secret
      let secretUpdated = false;
      try {
        const mgmtRes = await fetch(
          `https://api.supabase.com/v1/projects/${projectRef}/secrets`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify([{ name: "SHOPIFY_ACCESS_TOKEN", value: newAccessToken }]),
          }
        );
        secretUpdated = mgmtRes.ok;
      } catch {
        // Non-critical
      }

      return {
        success: true,
        token_prefix: newAccessToken.substring(0, 12) + "...",
        secret_updated: secretUpdated,
        scope,
        note: "Used client_credentials fallback — no refresh_token stored. Re-authenticate via OAuth to enable refresh_token flow.",
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[refresh-shopify-tokens] ❌ client_credentials attempt ${attempt} exception: ${errMsg}`);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      } else {
        return { success: false, error: errMsg, retries_exhausted: true };
      }
    }
  }

  return { success: false, error: "All retry attempts exhausted" };
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PRODUCTION_URL =
  "https://tempo-deployment-26c0258f-253c-4e4e.vercel.app";
const CALLBACK_URL =
  "https://kqwktnplkqucsbasyfjl.supabase.co/functions/v1/supabase-functions-shopify-oauth-callback";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    // Log the incoming request details for debugging
    const url = new URL(req.url);
    console.log("[shopify-oauth-callback] === INCOMING REQUEST ===");
    console.log("[shopify-oauth-callback] Method:", req.method);
    console.log("[shopify-oauth-callback] URL:", req.url);
    console.log("[shopify-oauth-callback] Search params:", url.searchParams.toString());
    console.log("[shopify-oauth-callback] Headers:", JSON.stringify(Object.fromEntries(req.headers.entries())));

    let code: string | null = null;
    let shop: string | null = null;
    let redirect_uri: string | null = null;

    // === HANDLE BOTH GET (browser redirect from Shopify) AND POST (frontend invocation) ===
    if (req.method === "GET") {
      // Shopify redirects the browser here with query parameters:
      // ?code=xxx&shop=xxx&hmac=xxx&state=xxx&timestamp=xxx
      code = url.searchParams.get("code");
      shop = url.searchParams.get("shop");
      const state = url.searchParams.get("state");
      const hmac = url.searchParams.get("hmac");
      console.log("[shopify-oauth-callback] GET params - code:", code ? `${code.substring(0, 8)}...` : "MISSING");
      console.log("[shopify-oauth-callback] GET params - shop:", shop);
      console.log("[shopify-oauth-callback] GET params - state:", state);
      console.log("[shopify-oauth-callback] GET params - hmac:", hmac ? "present" : "MISSING");
    } else if (req.method === "POST") {
      // Frontend invocation via supabase.functions.invoke()
      let rawBody = "";
      try {
        rawBody = await req.text();
        console.log("[shopify-oauth-callback] Raw POST body:", rawBody);
        console.log("[shopify-oauth-callback] Raw body length:", rawBody.length);

        if (!rawBody || rawBody.trim().length === 0) {
          return new Response(
            JSON.stringify({
              error: "Empty request body. The POST body must contain JSON with {code, shop}.",
              hint: "If Shopify is redirecting to this URL, it uses GET with query parameters, not POST.",
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        const body = JSON.parse(rawBody);
        code = body.code || null;
        shop = body.shop || null;
        redirect_uri = body.redirect_uri || null;
        console.log("[shopify-oauth-callback] Parsed POST body - code:", code ? `${code.substring(0, 8)}...` : "MISSING");
        console.log("[shopify-oauth-callback] Parsed POST body - shop:", shop);
      } catch (parseError) {
        const parseMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error("[shopify-oauth-callback] JSON parse error:", parseMsg);
        console.error("[shopify-oauth-callback] Raw body was:", rawBody);
        return new Response(
          JSON.stringify({
            error: `Failed to parse request body as JSON: ${parseMsg}`,
            raw_body_preview: rawBody.substring(0, 500),
            hint: "Ensure the request sends a valid JSON body with {code, shop}.",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported method: ${req.method}` }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 405,
        }
      );
    }

    // Validate required params
    if (!code || !shop) {
      const errorResponse = {
        error: "Missing required OAuth parameters: code, shop",
        received: { code: code ? "present" : "MISSING", shop: shop || "MISSING" },
        method: req.method,
        hint: req.method === "GET"
          ? "Shopify should include ?code=xxx&shop=xxx in the redirect URL"
          : "POST body must include {code: '...', shop: '...'}",
      };
      console.error("[shopify-oauth-callback] Missing params:", JSON.stringify(errorResponse));
      return new Response(
        JSON.stringify(errorResponse),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Retrieve the Shopify app credentials from Edge Function Secrets
    const shopifyApiKey = Deno.env.get("SHOPIFY_API_KEY");
    const shopifyApiSecret = Deno.env.get("SHOPIFY_API_SECRET");

    console.log("[shopify-oauth-callback] SHOPIFY_API_KEY loaded:", shopifyApiKey ? `${shopifyApiKey.substring(0, 6)}...` : "NOT SET");
    console.log("[shopify-oauth-callback] SHOPIFY_API_SECRET loaded:", shopifyApiSecret ? "SET (hidden)" : "NOT SET");

    if (!shopifyApiKey || !shopifyApiSecret) {
      return new Response(
        JSON.stringify({
          error:
            "SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be configured as Edge Function secrets.",
          shopify_api_key_set: !!shopifyApiKey,
          shopify_api_secret_set: !!shopifyApiSecret,
          hint: "Go to Supabase Dashboard → Settings → Edge Functions → Secrets.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Clean the shop domain
    const shopDomain = shop
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");

    console.log(`[shopify-oauth-callback] Exchanging code for access token on shop: ${shopDomain}`);

    // Build the token exchange payload
    const tokenPayload = {
      client_id: shopifyApiKey,
      client_secret: shopifyApiSecret,
      code,
    };

    const tokenUrl = `https://${shopDomain}/admin/oauth/access_token`;
    const tokenBody = JSON.stringify(tokenPayload);

    console.log("[shopify-oauth-callback] Token exchange URL:", tokenUrl);
    console.log("[shopify-oauth-callback] Token exchange payload (without secret):", JSON.stringify({
      client_id: shopifyApiKey,
      client_secret: "***HIDDEN***",
      code: code.substring(0, 8) + "...",
    }));

    // Exchange the authorization code for a permanent access token
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: tokenBody,
      });
    } catch (fetchError) {
      const fetchMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error("[shopify-oauth-callback] Fetch to Shopify failed:", fetchMsg);
      return new Response(
        JSON.stringify({
          error: `Network error calling Shopify token endpoint: ${fetchMsg}`,
          token_url: tokenUrl,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        }
      );
    }

    // Read the raw response first for debugging
    const tokenResponseText = await tokenResponse.text();
    console.log("[shopify-oauth-callback] Token response status:", tokenResponse.status);
    console.log("[shopify-oauth-callback] Token response headers:", JSON.stringify(Object.fromEntries(tokenResponse.headers.entries())));
    console.log("[shopify-oauth-callback] Token response body:", tokenResponseText);

    let tokenData: Record<string, unknown>;
    try {
      tokenData = JSON.parse(tokenResponseText);
    } catch (_jsonError) {
      console.error("[shopify-oauth-callback] Failed to parse token response as JSON");
      return new Response(
        JSON.stringify({
          error: "Shopify returned non-JSON response during token exchange",
          status: tokenResponse.status,
          raw_response: tokenResponseText.substring(0, 1000),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        }
      );
    }

    if (!tokenResponse.ok || !tokenData.access_token) {
      const errorMsg = (tokenData.error_description || tokenData.error || "Token exchange failed") as string;
      console.error("[shopify-oauth-callback] Token exchange failed:", errorMsg);
      console.error("[shopify-oauth-callback] Full token response:", JSON.stringify(tokenData));
      return new Response(
        JSON.stringify({
          success: false,
          error: errorMsg,
          shopify_status: tokenResponse.status,
          shopify_response: tokenData,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const accessToken = tokenData.access_token as string;
    const refreshToken = (tokenData.refresh_token as string) || null;
    const expiresIn = (tokenData.expires_in as number) || null;
    const refreshTokenExpiresIn = (tokenData.refresh_token_expires_in as number) || null;
    const scope = tokenData.scope as string;

    console.log(`[shopify-oauth-callback] ✅ Successfully obtained access token. Scope: ${scope}`);
    console.log(`[shopify-oauth-callback] refresh_token: ${refreshToken ? "present" : "NOT present"}`);
    console.log(`[shopify-oauth-callback] expires_in: ${expiresIn}, refresh_token_expires_in: ${refreshTokenExpiresIn}`);

    // Store the access token and shop URL as a record in Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Upsert the shop credentials into a shopify_connections table
    const now = new Date();
    const upsertPayload: Record<string, unknown> = {
      shop_domain: shopDomain,
      access_token: accessToken,
      scope: scope,
      connected_at: now.toISOString(),
      updated_at: now.toISOString(),
      is_active: true,
      last_refresh_error: null,
      refresh_attempt_count: 0,
    };

    // Store refresh_token and computed expiration timestamps if provided
    if (refreshToken) {
      upsertPayload.refresh_token = refreshToken;
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
      console.error(
        "[shopify-oauth-callback] DB upsert error:",
        JSON.stringify(upsertError)
      );
    } else {
      console.log("[shopify-oauth-callback] ✅ Token saved to shopify_connections for shop:", shopDomain);
    }

    // Verify the token works by fetching shop info
    let shopInfo = null;
    try {
      const shopInfoRes = await fetch(
        `https://${shopDomain}/admin/api/2024-10/shop.json`,
        {
          headers: { "X-Shopify-Access-Token": accessToken },
        }
      );

      if (shopInfoRes.ok) {
        const shopData = await shopInfoRes.json();
        shopInfo = {
          name: shopData.shop?.name,
          domain: shopData.shop?.domain,
          plan: shopData.shop?.plan_name,
        };
        console.log(`[shopify-oauth-callback] ✅ Verified connection to shop: ${shopInfo.name}`);
      } else {
        console.warn("[shopify-oauth-callback] Shop info fetch returned status:", shopInfoRes.status);
      }
    } catch (shopInfoErr) {
      console.warn("[shopify-oauth-callback] Could not verify shop info:", shopInfoErr);
    }

    const successPayload = {
      success: true,
      shop_domain: shopDomain,
      scope,
      access_token: accessToken,
      shop_info: shopInfo,
      message: "OAuth complete. Access token stored. You can now publish products to Shopify.",
    };

    // If this was a GET request (browser redirect from Shopify),
    // redirect the user back to the app with the token info
    if (req.method === "GET") {
      const appCallbackUrl = new URL("/auth/callback", PRODUCTION_URL);
      appCallbackUrl.searchParams.set("shop", shopDomain);
      appCallbackUrl.searchParams.set("scope", scope || "");
      appCallbackUrl.searchParams.set("access_token", accessToken);
      if (shopInfo?.name) {
        appCallbackUrl.searchParams.set("shop_name", shopInfo.name);
      }

      console.log("[shopify-oauth-callback] Redirecting browser to:", appCallbackUrl.toString());

      // Return an HTML page that stores the token and redirects
      const html = `<!DOCTYPE html>
<html>
<head><title>Shopify OAuth Complete</title></head>
<body>
<h1>Shopify Connected!</h1>
<p>Shop: ${shopDomain}</p>
<p>Storing credentials and redirecting...</p>
<script>
  if (window.opener) {
    window.opener.postMessage(${JSON.stringify(successPayload)}, "*");
    window.close();
  } else {
    window.location.href = ${JSON.stringify(appCallbackUrl.toString())};
  }
</script>
</body>
</html>`;

      return new Response(html, {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
        status: 200,
      });
    }

    // POST response (frontend invocation)
    return new Response(
      JSON.stringify(successPayload),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "No stack trace";
    console.error("[shopify-oauth-callback] === FATAL ERROR ===");
    console.error("[shopify-oauth-callback] Message:", errorMsg);
    console.error("[shopify-oauth-callback] Stack:", errorStack);
    console.error("[shopify-oauth-callback] Type:", typeof error);

    return new Response(
      JSON.stringify({
        error: errorMsg,
        stack: errorStack,
        timestamp: new Date().toISOString(),
        hint: "Check Supabase Edge Function logs for full details.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

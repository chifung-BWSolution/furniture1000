import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    // Get the Gemini API key from Edge Function secrets
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          error:
            "GEMINI_API_KEY is not configured in Edge Function secrets. Please add it in Supabase Dashboard → Edge Functions → Secrets.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Parse the incoming request body with size guard
    let body: any;
    try {
      const rawBody = await req.text();
      const bodySizeBytes = rawBody.length;
      const bodySizeMB = (bodySizeBytes / (1024 * 1024)).toFixed(1);
      console.log(`[gemini-proxy] Request body size: ${bodySizeMB}MB (${bodySizeBytes} bytes)`);

      // Guard against extremely large payloads
      if (bodySizeBytes > 30 * 1024 * 1024) {
        console.error(`[gemini-proxy] Request body too large: ${bodySizeMB}MB`);
        return new Response(
          JSON.stringify({
            error: `Request body too large (${bodySizeMB}MB). Maximum is 30MB.`,
            hint: "Try sending smaller or fewer images. Resize images before sending.",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 413,
          }
        );
      }

      body = JSON.parse(rawBody);
    } catch (parseErr: any) {
      console.error("[gemini-proxy] Body parse error:", parseErr?.message || parseErr);
      return new Response(
        JSON.stringify({
          error: `Failed to parse request body: ${parseErr?.message || "Unknown parse error"}`,
          hint: "Request body may be malformed JSON or too large for available memory.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { model, contents } = body;

    if (!contents || !Array.isArray(contents)) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid request body. Expected { model?: string, contents: [...] }",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const modelName = model || "gemini-2.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;

    console.log(
      `[gemini-proxy] Forwarding request to Gemini model: ${modelName}`
    );

    // Forward the request to the Gemini API
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error(
        `[gemini-proxy] Gemini API error (${geminiResponse.status}):`,
        JSON.stringify(geminiData).substring(0, 500)
      );
      return new Response(JSON.stringify(geminiData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: geminiResponse.status,
      });
    }

    console.log("[gemini-proxy] Successfully got response from Gemini API");

    return new Response(JSON.stringify(geminiData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("[gemini-proxy] Unhandled error:", error?.message || error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        hint: "An unexpected error occurred in the gemini-proxy edge function.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

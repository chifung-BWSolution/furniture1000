import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { geminiThinkingConfig, resolveGeminiModel } from "../_shared/geminiModel.ts";
import { decodeJwtUser, logAiUsage } from "../_shared/usageLog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Gemini 3.x 偶發 UNAVAILABLE（503 高需求）或 429 時，改由 xAI Grok 完成同一個請求，
 * 讓白底辨別、平面圖辨識之類的使用者流程不用等供應方恢復。
 * 只換供應方，不改呼叫端契約：回傳仍是 Gemini 的 { candidates, usageMetadata } 形狀。
 */
const XAI_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_XAI_CHAT_MODEL = "grok-4.7";
/** 兩段加起來低於 Edge gateway 的 ~150s 上限。 */
const GEMINI_TIMEOUT_MS = 75_000;
const XAI_TIMEOUT_MS = 65_000;
/** 供應方容量問題才值得換模型；400/401/403 是請求本身的問題，換了也一樣。 */
const FALLBACK_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
/** 這些 feature 的呼叫端會 JSON.parse 回覆，要求 Grok 用 JSON 模式。 */
const JSON_FEATURES = new Set([
  "presentation_copy",
  "upload_category",
  "quote_product_reference_selection",
  "quote_floor_plan_zones",
  "excel_ai_naming",
]);

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
};

/** Gemini contents → xAI chat messages；inlineData base64 圖片轉成 data URL。 */
function toXaiMessages(contents: unknown) {
  if (!Array.isArray(contents)) return [];
  return contents.map((entry: any) => {
    const parts: GeminiPart[] = Array.isArray(entry?.parts) ? entry.parts : [];
    const content = parts.flatMap((part) => {
      if (typeof part?.text === "string" && part.text) {
        return [{ type: "text", text: part.text }];
      }
      const data = part?.inlineData?.data;
      if (typeof data !== "string" || !data) return [];
      const mimeType = part?.inlineData?.mimeType || "image/jpeg";
      return [{
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${data}`, detail: "high" },
      }];
    });
    return { role: entry?.role === "model" ? "assistant" : "user", content };
  });
}

async function askXai(apiKey: string, contents: unknown, feature: string | null) {
  const model = (Deno.env.get("XAI_CHAT_MODEL") ?? "").trim() ||
    DEFAULT_XAI_CHAT_MODEL;
  const response = await fetch(XAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: "low",
      messages: toXaiMessages(contents),
      ...(feature && JSON_FEATURES.has(feature)
        ? { response_format: { type: "json_object" } }
        : {}),
    }),
    signal: AbortSignal.timeout(XAI_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(`xAI ${response.status}`), {
      status: response.status,
      data,
    });
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw Object.assign(new Error("xAI returned no content"), {
      status: 502,
      data,
    });
  }
  return { model, text, usage: data?.usage };
}

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

    const modelName = resolveGeminiModel(model);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
    const feature = typeof body.feature === "string" ? body.feature : null;

    console.log(
      `[gemini-proxy] Forwarding request to Gemini model: ${modelName}`
    );

    // Forward the request to the Gemini API. A timeout is treated like an
    // availability error so the xAI fallback below still gets a chance.
    let geminiResponse: Response;
    try {
      geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...(feature === 'presentation_copy' || Object.keys(geminiThinkingConfig(modelName)).length
            ? { generationConfig: {
              ...geminiThinkingConfig(modelName),
              ...(feature === 'presentation_copy' ? {
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: 'OBJECT',
                  properties: { description: { type: 'STRING' }, sellingPoints: { type: 'STRING' } },
                  required: ['description', 'sellingPoints'],
                },
              } : {}),
            } }
            : {}),
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[gemini-proxy] Gemini request failed: ${message}`);
      geminiResponse = new Response(
        JSON.stringify({
          error: { code: 504, message: `Gemini request failed: ${message}`, status: "UNAVAILABLE" },
        }),
        { status: 504, headers: { "Content-Type": "application/json" } },
      );
    }

    const geminiData = await geminiResponse.json().catch(() => null);

    if (!geminiResponse.ok) {
      console.error(
        `[gemini-proxy] Gemini API error (${geminiResponse.status}):`,
        JSON.stringify(geminiData).substring(0, 500)
      );

      // 供應方容量問題：改用 xAI Grok 完成同一個請求（有設 XAI_API_KEY 才啟用）。
      const xaiApiKey = (Deno.env.get("XAI_API_KEY") ?? "").trim();
      if (FALLBACK_STATUSES.has(geminiResponse.status) && xaiApiKey) {
        try {
          const fallback = await askXai(xaiApiKey, contents, feature);
          console.log(
            `[gemini-proxy] Gemini ${geminiResponse.status}; answered by ${fallback.model}`
          );
          await logAiUsage({
            source: "gemini-proxy",
            feature,
            model: fallback.model,
            ...decodeJwtUser(req),
            promptTokens: fallback.usage?.prompt_tokens,
            outputTokens: fallback.usage?.completion_tokens,
            totalTokens: fallback.usage?.total_tokens,
            meta: { fallback: "xai", geminiStatus: geminiResponse.status, geminiModel: modelName },
          });
          return new Response(JSON.stringify({
            candidates: [{
              content: { parts: [{ text: fallback.text }], role: "model" },
              finishReason: "STOP",
            }],
            usageMetadata: {
              promptTokenCount: fallback.usage?.prompt_tokens ?? 0,
              candidatesTokenCount: fallback.usage?.completion_tokens ?? 0,
              totalTokens: fallback.usage?.total_tokens ?? 0,
            },
            model: fallback.model,
            provider: "xai",
            fallbackFrom: modelName,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        } catch (error) {
          console.error(
            "[gemini-proxy] xAI fallback failed:",
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      return new Response(JSON.stringify(geminiData ?? {
        error: { code: geminiResponse.status, message: "Gemini returned no JSON body" },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: geminiResponse.status,
      });
    }

    console.log("[gemini-proxy] Successfully got response from Gemini API");

    // 用量記錄（best-effort，失敗不影響回應）
    const usageMeta = (geminiData as any)?.usageMetadata ?? {};
    await logAiUsage({
      source: "gemini-proxy",
      feature,
      model: modelName,
      ...decodeJwtUser(req),
      promptTokens: usageMeta.promptTokenCount,
      outputTokens: usageMeta.candidatesTokenCount,
      totalTokens: usageMeta.totalTokenCount,
    });

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

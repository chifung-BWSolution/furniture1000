import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Classifies a furniture photo into one of the four Day 8 kinds and estimates
 * overall size. The browser builds the parametric parts and the GLB.
 * Sofas, chairs, and curved furniture are refused.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "gemini-2.5-flash";
const MAX_BYTES = 1_500_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user?.id) return json({ error: "Unauthorized" }, 401);
  const { data: allowed } = await userClient.rpc("bwf_has_role", {
    p_roles: ["admin", "uploader", "pm", "designer"],
  });
  if (allowed !== true) return json({ error: "permission_denied" }, 403);
  if (!apiKey) return json({ error: "GEMINI_API_KEY 未設定" }, 500);

  let body: { image_base64?: string; mime_type?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const mime = body.mime_type === "image/png" || body.mime_type === "image/webp" ? body.mime_type : "image/jpeg";
  const raw = String(body.image_base64 ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) return json({ error: "image_required" }, 400);
  if (Math.floor(raw.length * 0.75) > MAX_BYTES) return json({ error: "image_too_large" }, 400);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "Classify the furniture. Only desk, conference table, bookshelf, or storage cabinet are supported. Sofas, chairs, and curved furniture are unsupported. Estimate overall width, depth, and height in millimetres. If the photo has no scale, still estimate and that is acceptable.",
          }],
        },
        contents: [{
          parts: [
            { inline_data: { mime_type: mime, data: raw } },
            { text: "Return the furniture kind and overall size." },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["desk", "conference", "shelf", "cabinet", "unsupported"] },
              width_mm: { type: "number" },
              depth_mm: { type: "number" },
              height_mm: { type: "number" },
              reason: { type: "string" },
            },
            required: ["kind"],
          },
        },
      }),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: payload?.error?.message || `gemini HTTP ${res.status}` }, 502);
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") ?? "";
  let parsed: { kind?: string; width_mm?: number; depth_mm?: number; height_mm?: number; reason?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: "模型沒有回傳可讀的結構" }, 502);
  }
  if (parsed.kind === "unsupported" || !parsed.kind) {
    return json({
      supported: false,
      reason: parsed.reason || "首版只做辦公桌、會議桌、書架和儲物櫃",
    });
  }
  return json({
    supported: true,
    kind: parsed.kind,
    width_mm: parsed.width_mm ?? null,
    depth_mm: parsed.depth_mm ?? null,
    height_mm: parsed.height_mm ?? null,
    estimated: true,
  });
});

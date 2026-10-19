import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Image search (F-AI-006). Embeds the uploaded picture with gemini-embedding-2
 * at 1536 dimensions, then returns the nearest catalog products.
 * Every hit is relation=similar. Cosine similarity is not treated as the same product.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "gemini-embedding-2";
const DIM = 1536;
const MAX_BYTES = 1_500_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function embedImage(apiKey: string, base64: string, mime: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        content: { parts: [{ inline_data: { mime_type: mime, data: base64 } }] },
        output_dimensionality: DIM,
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || `embed HTTP ${res.status}`);
  }
  const values = body?.embedding?.values;
  if (!Array.isArray(values) || values.length !== DIM) {
    throw new Error(`embedding_dimension ${values?.length ?? 0}`);
  }
  return values;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !authHeader) return json({ error: "Unauthorized" }, 401);
  if (!apiKey) return json({ error: "GEMINI_API_KEY 未設定" }, 500);

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

  let body: { image_base64?: string; mime_type?: string; filters?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const mime = body.mime_type === "image/png" || body.mime_type === "image/webp" ? body.mime_type : "image/jpeg";
  const raw = String(body.image_base64 ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) return json({ error: "image_required" }, 400);
  if (Math.floor(raw.length * 0.75) > MAX_BYTES) return json({ error: "image_too_large" }, 400);

  let values: number[];
  try {
    values = await embedImage(apiKey, raw, mime);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }

  const f = body.filters ?? {};
  const { data, error } = await userClient.rpc("fds_match_product_images", {
    p_values: values,
    p_factory: f.factory || null,
    p_level1: f.level1 || null,
    p_level2: f.level2 || null,
    p_colors: Array.isArray(f.colors) && f.colors.length ? f.colors : null,
    p_materials: Array.isArray(f.materials) && f.materials.length ? f.materials : null,
    p_price_min: f.price_min ?? null,
    p_price_max: f.price_max ?? null,
    p_l_min: f.l_min ?? null,
    p_l_max: f.l_max ?? null,
    p_w_min: f.w_min ?? null,
    p_w_max: f.w_max ?? null,
    p_h_min: f.h_min ?? null,
    p_h_max: f.h_max ?? null,
    p_in_stock: f.in_stock ?? null,
    p_scope: f.scope || "all",
    p_limit: 5,
  });
  if (error) return json({ error: error.message }, 400);
  return json(data);
});

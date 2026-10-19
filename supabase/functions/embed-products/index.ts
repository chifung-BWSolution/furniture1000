import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Indexes product photos (and a short text description) into search_embeddings.
 * One request handles a small batch, then chains itself so a full catalog
 * does not have to finish inside one Edge invocation.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "gemini-embedding-2";
const DIM = 1536;
const BATCH = 4;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function thumbUrl(url: string): string {
  const marker = "/storage/v1/object/public/";
  const at = url.indexOf(marker);
  if (at < 0) return url;
  const rewritten = `${url.slice(0, at)}/storage/v1/render/image/public/${url.slice(at + marker.length)}`;
  const join = rewritten.includes("?") ? "&" : "?";
  return `${rewritten}${join}width=512&quality=70`;
}

async function embed(apiKey: string, parts: unknown[]): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ content: { parts }, output_dimensionality: DIM }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `embed HTTP ${res.status}`);
  const values = body?.embedding?.values;
  if (!Array.isArray(values) || values.length !== DIM) {
    throw new Error(`embedding_dimension ${values?.length ?? 0}`);
  }
  return values;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadImage(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const attempts = url.includes("/storage/v1/object/public/") ? [thumbUrl(url), url] : [url];
  let last = "image HTTP";
  for (const candidate of attempts) {
    const res = await fetch(candidate);
    if (!res.ok) {
      last = `image HTTP ${res.status}`;
      continue;
    }
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: mime || "image/jpeg" };
  }
  throw new Error(last);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function isAuthorized(
  req: Request,
  url: string,
  anonKey: string,
  serviceKey: string,
): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return false;
  if (authHeader === `Bearer ${serviceKey}`) return true;
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user?.id) return false;
  const { data } = await userClient.rpc("bwf_has_role", { p_roles: ["admin", "uploader"] });
  return data === true;
}

async function indexOne(admin: SupabaseClient, apiKey: string, row: {
  id: string;
  image_url: string;
  title?: string;
  model?: string | null;
  material?: string | null;
  color?: string | null;
}): Promise<void> {
  const loaded = await loadImage(row.image_url);
  const bytes = loaded.bytes;
  if (bytes.byteLength < 32 || bytes.byteLength > 2_000_000) throw new Error("image_size");
  const hash = await sha256Hex(bytes);
  const imageValues = await embed(apiKey, [{
    inline_data: { mime_type: loaded.mime, data: bytesToBase64(bytes) },
  }]);
  const { error: imageErr } = await admin.rpc("fds_upsert_embedding", {
    p_entity_id: row.id,
    p_modality: "image",
    p_values: imageValues,
    p_model: MODEL,
    p_content_hash: hash,
  });
  if (imageErr) throw new Error(imageErr.message);

  const text = [row.title, row.model, row.material, row.color].filter(Boolean).join(" ").slice(0, 500);
  if (text) {
    const textValues = await embed(apiKey, [{ text }]);
    const { error: textErr } = await admin.rpc("fds_upsert_embedding", {
      p_entity_id: row.id,
      p_modality: "text",
      p_values: textValues,
      p_model: MODEL,
      p_content_hash: null,
    });
    if (textErr) throw new Error(textErr.message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return json({ error: "Supabase not configured" }, 500);
  if (!(await isAuthorized(req, url, anonKey, serviceKey))) return json({ error: "Unauthorized" }, 401);
  if (!apiKey) return json({ error: "GEMINI_API_KEY 未設定" }, 500);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("fds_products_missing_image_embedding", { p_limit: BATCH });
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Array<{
    id: string;
    image_url: string;
    title?: string;
    model?: string | null;
    material?: string | null;
    color?: string | null;
  }>;

  let indexed = 0;
  const failed: { id: string; error: string }[] = [];
  for (const row of rows) {
    try {
      await indexOne(admin, apiKey, row);
      indexed += 1;
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
      // A broken image must not block the queue forever.
      if (String(err).includes("image HTTP") || String(err).includes("image_size")) {
        await admin.rpc("fds_upsert_embedding", {
          p_entity_id: row.id,
          p_modality: "image",
          p_values: new Array(DIM).fill(0),
          p_model: "skipped",
          p_content_hash: "unreadable",
        }).then(() => undefined, () => undefined);
      }
    }
  }

  return json({ indexed, failed, remaining: rows.length === BATCH });
});

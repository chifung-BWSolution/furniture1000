import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const BUCKET = "product-images";

function parseBase64(str: string): { mimeType: string; data: string } | null {
  if (!str || typeof str !== "string") return null;
  const trimmed = str.trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/s);
  if (match) return { mimeType: match[1], data: match[2] };
  // Raw base64 without data URI prefix
  if (trimmed.length > 100 && !trimmed.startsWith("http")) {
    let mimeType = "image/jpeg";
    if (trimmed.startsWith("iVBOR")) mimeType = "image/png";
    else if (trimmed.startsWith("R0lGOD")) mimeType = "image/gif";
    else if (trimmed.startsWith("UklGR")) mimeType = "image/webp";
    return { mimeType, data: trimmed };
  }
  return null;
}

function getExt(mime: string): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }[mime] || "jpg";
}

async function uploadBase64(
  supabase: ReturnType<typeof createClient>,
  base64: string,
  productId: string,
  suffix: string
): Promise<string | null> {
  const parsed = parseBase64(base64);
  if (!parsed) return null;
  const ext = getExt(parsed.mimeType);
  const filePath = `products/${productId}_${suffix}_${Date.now()}.${ext}`;
  try {
    const binaryStr = atob(parsed.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, bytes, { contentType: parsed.mimeType, upsert: true });
    if (error) { console.error(`Upload error ${filePath}:`, error.message); return null; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    return data.publicUrl || null;
  } catch (e) {
    console.error(`Upload exception ${filePath}:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * migrate-rts-images
 * Converts base64 image_url and images[] entries in ready_to_shopify to
 * Supabase Storage HTTP URLs. Processes in batches to avoid timeout.
 *
 * POST { batch_size?: number, offset?: number } — run one batch
 * Returns { processed, converted, skipped, next_offset, done }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseKey) return json({ error: "Missing env vars" }, 400);
    const supabase = createClient(supabaseUrl, supabaseKey);

    let body: { batch_size?: number; offset?: number } = {};
    try { body = await req.json(); } catch { /* no body */ }

    const batchSize = Math.min(body.batch_size ?? 5, 10);
    const offset = body.offset ?? 0;

    // Fetch rows with base64 images
    // Use separate queries and merge to avoid jsonb operator issues
    const { data: rows, error: fetchErr } = await supabase
      .from("ready_to_shopify")
      .select("product_id, image_url, images")
      .like("image_url", "data:%")
      .range(offset, offset + batchSize - 1)
      .order("product_id");

    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!rows || rows.length === 0) return json({ processed: 0, converted: 0, skipped: 0, done: true });

    let converted = 0;
    let skipped = 0;

    for (const row of rows) {
      const pid = row.product_id;
      const updates: Record<string, unknown> = {};

      // Convert primary image
      if (row.image_url && row.image_url.startsWith("data:")) {
        console.log(`[migrate] Converting primary image for ${pid}...`);
        const url = await uploadBase64(supabase, row.image_url, pid, "primary");
        if (url) {
          updates.image_url = url;
          console.log(`[migrate] ✅ Primary → ${url.slice(0, 80)}`);
        } else {
          console.warn(`[migrate] ⚠️ Primary upload failed for ${pid}`);
          skipped++;
        }
      }

      // Convert extra images
      if (Array.isArray(row.images)) {
        const hasBase64 = row.images.some((img: any) => {
          const src: string = img?.src || img?.url || (typeof img === "string" ? img : "");
          return src.startsWith("data:");
        });
        if (hasBase64) {
          console.log(`[migrate] Converting ${row.images.length} extra images for ${pid}...`);
          const resolved = await Promise.all(
            row.images.map(async (img: any, idx: number) => {
              const src: string = img?.src || img?.url || (typeof img === "string" ? img : "");
              if (!src.startsWith("data:")) return img; // already URL
              const url = await uploadBase64(supabase, src, pid, `extra${idx}`);
              if (url) {
                console.log(`[migrate] ✅ Extra[${idx}] → ${url.slice(0, 80)}`);
                return { ...img, src: url };
              }
              console.warn(`[migrate] ⚠️ Extra[${idx}] upload failed for ${pid}`);
              return img; // keep original on failure
            })
          );
          updates.images = resolved;
        }
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateErr } = await supabase
          .from("ready_to_shopify")
          .update(updates)
          .eq("product_id", pid);
        if (updateErr) {
          console.error(`[migrate] DB update error for ${pid}:`, updateErr.message);
          skipped++;
        } else {
          converted++;
        }
      }
    }

    // Check if more rows remain
    const { count } = await supabase
      .from("ready_to_shopify")
      .select("product_id", { count: "exact", head: true })
      .like("image_url", "data:%");

    const remaining = (count ?? 0) - (offset + rows.length);
    const done = remaining <= 0;

    return json({
      processed: rows.length,
      converted,
      skipped,
      next_offset: done ? null : offset + rows.length,
      remaining: Math.max(0, remaining),
      done,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[migrate-rts-images] Error:", msg);
    return json({ error: msg }, 500);
  }
});

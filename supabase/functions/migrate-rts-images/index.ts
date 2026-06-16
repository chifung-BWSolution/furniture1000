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

function rowNeedsMigration(row: { image_url: string | null; images: any }): boolean {
  if (row.image_url && row.image_url.startsWith("data:")) return true;
  if (Array.isArray(row.images)) {
    return row.images.some((img: any) => {
      const src: string = img?.src || img?.url || (typeof img === "string" ? img : "");
      return src.startsWith("data:");
    });
  }
  return false;
}

/**
 * migrate-rts-images
 * Converts base64 image_url AND images[] entries in ready_to_shopify to
 * Supabase Storage HTTP URLs. Scans all rows each call (no offset needed
 * since converted rows drop out of the filter naturally).
 *
 * POST { batch_size?: number } — process one batch of rows needing migration
 * Returns { processed, converted, skipped, remaining, done }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseKey) return json({ error: "Missing env vars" }, 400);
    const supabase = createClient(supabaseUrl, supabaseKey);

    let body: { batch_size?: number } = {};
    try { body = await req.json(); } catch { /* no body */ }

    const batchSize = Math.min(body.batch_size ?? 5, 10);

    // Fetch all rows (images JSONB can't use LIKE in PostgREST easily,
    // so we fetch up to 200 rows and filter in JS, then take first batchSize needing work).
    const { data: allRows, error: fetchErr } = await supabase
      .from("ready_to_shopify")
      .select("product_id, image_url, images")
      .order("product_id")
      .limit(200);

    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!allRows || allRows.length === 0) return json({ processed: 0, converted: 0, skipped: 0, remaining: 0, done: true });

    // Filter to only rows needing migration, then take batchSize
    const pending = allRows.filter(rowNeedsMigration);
    const totalRemaining = pending.length;

    if (totalRemaining === 0) {
      return json({ processed: 0, converted: 0, skipped: 0, remaining: 0, done: true });
    }

    const batch = pending.slice(0, batchSize);

    let converted = 0;
    let skipped = 0;

    for (const row of batch) {
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

      // Convert extra images in images[] array
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
              if (!src.startsWith("data:")) return img; // already URL, keep as-is
              const url = await uploadBase64(supabase, src, pid, `extra${idx}`);
              if (url) {
                console.log(`[migrate] ✅ Extra[${idx}] → ${url.slice(0, 80)}`);
                return typeof img === "string" ? url : { ...img, src: url };
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

    const remaining = totalRemaining - batch.length;
    const done = remaining <= 0;

    return json({
      processed: batch.length,
      converted,
      skipped,
      remaining: Math.max(0, remaining),
      done,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[migrate-rts-images] Error:", msg);
    return json({ error: msg }, 500);
  }
});

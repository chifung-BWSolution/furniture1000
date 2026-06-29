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
  suffix: string,
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

function isSvgPlaceholder(src: string): boolean {
  return src.startsWith("data:image/svg+xml");
}

function isBase64(src: unknown): src is string {
  if (typeof src !== "string") return false;
  if (isSvgPlaceholder(src)) return false;
  return src.startsWith("data:") || (src.length > 100 && !src.startsWith("http"));
}

function isSvgField(src: unknown): src is string {
  return typeof src === "string" && isSvgPlaceholder(src);
}

function imagesNeedMigration(images: unknown): boolean {
  if (!Array.isArray(images)) return false;
  return images.some((img: any) => isBase64(img?.src || img?.url || (typeof img === "string" ? img : "")));
}

/**
 * migrate-products-images
 * Non-destructively converts base64 image columns on the `products` table
 * (image_url, image_url_2, image_url_3, images[]) into Supabase Storage HTTP
 * URLs. A row is updated ONLY if every needed upload succeeds for that column;
 * a failed upload keeps the original base64 (no data loss).
 *
 * Cursor-based: pass the `next_cursor` from the previous response back as
 * `after_id` to continue. This avoids re-scanning and avoids loading the heavy
 * `images` column for the whole table at once.
 *
 * POST { batch_size?: number (<=10), after_id?: string }
 * Returns { processed, converted, skipped, scanned, next_cursor, done }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseKey) return json({ error: "Missing env vars" }, 400);
    const supabase = createClient(supabaseUrl, supabaseKey);

    let body: { batch_size?: number; after_id?: string } = {};
    try { body = await req.json(); } catch { /* no body */ }

    const batchSize = Math.min(body.batch_size ?? 5, 10);
    const afterId = body.after_id ?? "";

    // Scan a window of rows ordered by id. Only the columns we touch are
    // selected (still includes `images`, but the window is small: SCAN_WINDOW).
    const SCAN_WINDOW = 50;
    let q = supabase
      .from("products")
      .select("id, image_url, image_url_2, image_url_3, images")
      .order("id", { ascending: true })
      .limit(SCAN_WINDOW);
    if (afterId) q = q.gt("id", afterId);

    const { data: rows, error: fetchErr } = await q;
    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!rows || rows.length === 0) {
      return json({ processed: 0, converted: 0, skipped: 0, scanned: 0, next_cursor: null, done: true });
    }

    // Cursor advances to the last row we scanned (whether or not it needed work).
    const lastScannedId = rows[rows.length - 1].id as string;

    // Rows that actually need migration, capped at batchSize.
    const pending = rows.filter((r: any) =>
      isBase64(r.image_url) || isBase64(r.image_url_2) || isBase64(r.image_url_3)
      || isSvgField(r.image_url) || isSvgField(r.image_url_2) || isSvgField(r.image_url_3)
      || imagesNeedMigration(r.images)
      || (Array.isArray(r.images) && r.images.some((img: any) => {
        const src: string = img?.src || img?.url || (typeof img === "string" ? img : "");
        return isSvgPlaceholder(src);
      }))
    ).slice(0, batchSize);

    let converted = 0;
    let skipped = 0;

    for (const row of pending) {
      const pid = row.id as string;
      const updates: Record<string, unknown> = {};

      if (isSvgField(row.image_url)) {
        updates.image_url = "";
      } else if (isBase64(row.image_url)) {
        const url = await uploadBase64(supabase, row.image_url, pid, "primary");
        if (url) updates.image_url = url; else skipped++;
      }
      if (isSvgField(row.image_url_2)) {
        updates.image_url_2 = null;
      } else if (isBase64(row.image_url_2)) {
        const url = await uploadBase64(supabase, row.image_url_2, pid, "extra0");
        if (url) updates.image_url_2 = url; else skipped++;
      }
      if (isSvgField(row.image_url_3)) {
        updates.image_url_3 = null;
      } else if (isBase64(row.image_url_3)) {
        const url = await uploadBase64(supabase, row.image_url_3, pid, "extra1");
        if (url) updates.image_url_3 = url; else skipped++;
      }
      if (Array.isArray(row.images)) {
        const resolved = await Promise.all(
          (row.images as any[]).map(async (img: any, idx: number) => {
            const src: string = img?.src || img?.url || (typeof img === "string" ? img : "");
            if (isSvgPlaceholder(src)) return null;
            if (!isBase64(src)) return img;
            const url = await uploadBase64(supabase, src, pid, `img${idx}`);
            if (url) return typeof img === "string" ? url : { ...img, src: url };
            return img;
          })
        );
        const filtered = resolved.filter((x) => x !== null);
        if (filtered.length !== row.images.length || resolved.some((x) => x === null)) {
          updates.images = filtered;
        } else if (imagesNeedMigration(row.images)) {
          updates.images = resolved;
        }
      }

      if (Object.keys(updates).length > 0) {
        const { error: updErr } = await supabase.from("products").update(updates).eq("id", pid);
        if (updErr) { console.error(`[migrate-products] update error ${pid}:`, updErr.message); skipped++; }
        else converted++;
      }
    }

    // done only when this scan window returned fewer rows than the window size
    // (i.e. we've reached the end of the table).
    const done = rows.length < SCAN_WINDOW;

    return json({
      processed: pending.length,
      converted,
      skipped,
      scanned: rows.length,
      next_cursor: done ? null : lastScannedId,
      done,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[migrate-products-images] Error:", msg);
    return json({ error: msg }, 500);
  }
});

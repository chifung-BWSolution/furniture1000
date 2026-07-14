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

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"));
}

function isBase64Image(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  if (isHttpUrl(value)) return false;
  return value.startsWith("data:image") || (value.length > 100 && !value.startsWith("http"));
}

function parseBase64(str: string): { mimeType: string; data: string } | null {
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
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[mime] || "jpg";
}

async function uploadBase64(
  supabase: ReturnType<typeof createClient>,
  base64: string,
  storageId: string,
  suffix: string,
): Promise<string | null> {
  if (isHttpUrl(base64)) return base64;
  const parsed = parseBase64(base64);
  if (!parsed) return null;
  const ext = getExt(parsed.mimeType);
  const filePath = `quotes/${storageId}_${suffix}_${Date.now()}.${ext}`;
  try {
    const binaryStr = atob(parsed.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, bytes, { contentType: parsed.mimeType, upsert: true });
    if (error) {
      console.error(`Upload error ${filePath}:`, error.message);
      return null;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    return data.publicUrl || null;
  } catch (e) {
    console.error(`Upload exception ${filePath}:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

type RemarksBlock =
  | { type: "text"; content: string; id: string }
  | { type: "image"; src: string; id: string };

function parseRemarksContent(remarks?: string, legacyImage?: string): RemarksBlock[] {
  const trimmed = (remarks || "").trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as RemarksBlock[];
      }
    } catch {
      // fall through
    }
  }
  const blocks: RemarksBlock[] = [{ type: "text", content: trimmed, id: "t0" }];
  if (legacyImage) blocks.push({ type: "image", src: legacyImage, id: "i0" });
  return blocks;
}

function serializeRemarksContent(blocks: RemarksBlock[]): string {
  const onlyEmpty =
    blocks.length === 1 &&
    blocks[0].type === "text" &&
    !blocks[0].content.trim() &&
    !blocks.some((b) => b.type === "image");
  if (onlyEmpty) return "";
  return JSON.stringify(blocks);
}

async function resolveRemarksField(
  supabase: ReturnType<typeof createClient>,
  remarks: unknown,
  legacyImage: unknown,
  storageId: string,
): Promise<string> {
  const blocks = parseRemarksContent(
    typeof remarks === "string" ? remarks : undefined,
    typeof legacyImage === "string" ? legacyImage : undefined,
  );
  let imageIdx = 0;
  const resolved: RemarksBlock[] = [];
  for (const block of blocks) {
    if (block.type === "image") {
      const url = await uploadBase64(supabase, block.src, storageId, `remarks${imageIdx}`);
      imageIdx += 1;
      if (url && isHttpUrl(url)) resolved.push({ ...block, src: url });
      else if (isHttpUrl(block.src)) resolved.push(block);
    } else {
      resolved.push(block);
    }
  }
  return serializeRemarksContent(resolved);
}

function itemHasBase64(row: Record<string, unknown>): boolean {
  if (isBase64Image(row.image)) return true;
  if (isBase64Image(row.reference_image)) return true;
  if (isBase64Image(row.remarks_image)) return true;
  if (typeof row.remarks === "string") {
    const blocks = parseRemarksContent(row.remarks, row.remarks_image as string | undefined);
    return blocks.some((b) => b.type === "image" && isBase64Image(b.src));
  }
  return false;
}

/**
 * migrate-quote-images
 * Converts base64 images inside bwf_quote_item to Supabase Storage URLs.
 *
 * POST { batch_size?: number, after_id?: string }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 10, 1), 50);
    const afterId = typeof body.after_id === "string" ? body.after_id : "";

    let query = supabase
      .from("bwf_quote_item")
      .select("id, quote_uuid, image, reference_image, remarks_image, remarks")
      .order("id", { ascending: true })
      .limit(batchSize * 5);

    if (afterId) query = query.gt("id", afterId);

    const { data: rows, error: fetchError } = await query;
    if (fetchError) return json({ error: fetchError.message }, 500);

    let processed = 0;
    let converted = 0;
    let skipped = 0;
    let lastId = afterId;

    for (const row of rows || []) {
      if (processed >= batchSize) break;
      lastId = row.id as string;
      processed += 1;

      const record = row as Record<string, unknown>;
      if (!itemHasBase64(record)) {
        skipped += 1;
        continue;
      }

      const storageId = `${String(row.quote_uuid).slice(0, 8)}_${String(row.id).slice(0, 8)}`;
      const [image, referenceImage, remarks] = await Promise.all([
        typeof row.image === "string" && row.image.trim()
          ? uploadBase64(supabase, row.image, storageId, "product")
          : Promise.resolve(null),
        typeof row.reference_image === "string" && row.reference_image.trim()
          ? uploadBase64(supabase, row.reference_image, storageId, "reference")
          : Promise.resolve(null),
        resolveRemarksField(supabase, row.remarks, row.remarks_image, storageId),
      ]);

      const patch: Record<string, unknown> = {
        remarks,
        remarks_image: null,
        updated_at: new Date().toISOString(),
      };
      if (image && isHttpUrl(image)) patch.image = image;
      else if (!isHttpUrl(row.image)) patch.image = "";
      if (referenceImage && isHttpUrl(referenceImage)) patch.reference_image = referenceImage;
      else if (!isHttpUrl(row.reference_image)) patch.reference_image = null;

      const { error: updateError } = await supabase
        .from("bwf_quote_item")
        .update(patch)
        .eq("id", row.id);

      if (updateError) {
        console.error(`Update failed ${row.id}:`, updateError.message);
        skipped += 1;
      } else {
        converted += 1;
      }
    }

    const { count } = await supabase
      .from("bwf_quote_item")
      .select("*", { count: "exact", head: true });
    const done = processed < batchSize || (rows?.length || 0) === 0;

    return json({
      processed,
      converted,
      skipped,
      last_id: lastId,
      total_items: count ?? null,
      done,
      hint: done ? null : `Call again with after_id: "${lastId}"`,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

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

function projectDataHasBase64(projectData: unknown): boolean {
  if (!projectData || typeof projectData !== "object") return false;
  const items = (projectData as { items?: unknown }).items;
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const o = item as Record<string, unknown>;
    if (isBase64Image(o.image)) return true;
    if (isBase64Image(o.referenceImage)) return true;
    if (isBase64Image(o.remarksImage)) return true;
    if (typeof o.remarks === "string") {
      const blocks = parseRemarksContent(o.remarks, o.remarksImage as string | undefined);
      return blocks.some((b) => b.type === "image" && isBase64Image(b.src));
    }
    return false;
  });
}

async function resolveProjectDataImages(
  supabase: ReturnType<typeof createClient>,
  projectData: Record<string, unknown>,
  quoteId: string,
): Promise<Record<string, unknown>> {
  const items = projectData.items;
  if (!Array.isArray(items)) return projectData;

  const resolvedItems = await Promise.all(
    items.map(async (item, index) => {
      if (!item || typeof item !== "object") return item;
      const row = item as Record<string, unknown>;
      const storageId = `${quoteId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${index}`;

      const [image, referenceImage, remarks] = await Promise.all([
        typeof row.image === "string" && row.image.trim()
          ? uploadBase64(supabase, row.image, storageId, "product")
          : Promise.resolve(null),
        typeof row.referenceImage === "string" && row.referenceImage.trim()
          ? uploadBase64(supabase, row.referenceImage, storageId, "reference")
          : Promise.resolve(null),
        resolveRemarksField(supabase, row.remarks, row.remarksImage, storageId),
      ]);

      const next = { ...row, remarks, remarksImage: undefined };
      if (image && isHttpUrl(image)) next.image = image;
      else if (!isHttpUrl(row.image)) next.image = isHttpUrl(row.image) ? row.image : "";
      if (referenceImage && isHttpUrl(referenceImage)) next.referenceImage = referenceImage;
      else if (typeof row.referenceImage === "string" && isHttpUrl(row.referenceImage)) {
        next.referenceImage = row.referenceImage;
      } else {
        delete next.referenceImage;
      }
      return next;
    }),
  );

  return { ...projectData, items: resolvedItems };
}

/**
 * migrate-quote-images
 * Converts base64 images inside bwf_quote.project_data.items to Supabase Storage URLs.
 *
 * POST { batch_size?: number, after_quote_id?: string }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 5, 1), 20);
    const afterQuoteId = typeof body.after_quote_id === "string" ? body.after_quote_id : "";

    let query = supabase
      .from("bwf_quote")
      .select("quote_id, project_data")
      .order("quote_id", { ascending: true })
      .limit(batchSize * 3);

    if (afterQuoteId) query = query.gt("quote_id", afterQuoteId);

    const { data: rows, error: fetchError } = await query;
    if (fetchError) return json({ error: fetchError.message }, 500);

    let processed = 0;
    let converted = 0;
    let skipped = 0;
    let lastQuoteId = afterQuoteId;

    for (const row of rows || []) {
      if (processed >= batchSize) break;
      lastQuoteId = row.quote_id as string;
      processed += 1;

      const projectData = row.project_data as Record<string, unknown> | null;
      if (!projectData || !projectDataHasBase64(projectData)) {
        skipped += 1;
        continue;
      }

      const resolved = await resolveProjectDataImages(supabase, projectData, row.quote_id as string);
      const { error: updateError } = await supabase
        .from("bwf_quote")
        .update({ project_data: resolved })
        .eq("quote_id", row.quote_id);

      if (updateError) {
        console.error(`Update failed ${row.quote_id}:`, updateError.message);
        skipped += 1;
      } else {
        converted += 1;
      }
    }

    const { count } = await supabase.from("bwf_quote").select("*", { count: "exact", head: true });
    const done = processed < batchSize || (rows?.length || 0) === 0;

    return json({
      processed,
      converted,
      skipped,
      last_quote_id: lastQuoteId,
      total_quotes: count ?? null,
      done,
      hint: done ? null : `Call again with after_quote_id: "${lastQuoteId}"`,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

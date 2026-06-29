import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MASTER_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";
const BUCKET = "product-images";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function extFromMime(mime: string): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[mime] || "jpg";
}

function bytesFromBase64(data: string): Uint8Array {
  const binaryStr = atob(data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

/** PDF catalog SVG wrappers embed a real JPEG/PNG inside xlink:href. */
function extractEmbeddedFromSvgDataUrl(svgDataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  if (!svgDataUrl.startsWith("data:image/svg+xml")) return null;
  const outerB64 = svgDataUrl.split(",")[1];
  if (!outerB64) return null;
  let svgText: string;
  try {
    svgText = atob(outerB64);
  } catch {
    return null;
  }
  const match = svgText.match(/(?:xlink:)?href=["'](data:image\/(?:jpeg|png|webp|gif)[^"']+)["']/i);
  if (!match) return null;
  const inner = match[1];
  const m = inner.match(/^data:(image\/[a-z+]+);base64,(.+)$/s);
  if (!m) return null;
  try {
    return { mimeType: m[1], bytes: bytesFromBase64(m[2]) };
  } catch {
    return null;
  }
}

function parseDirectBase64(src: string): { mimeType: string; bytes: Uint8Array } | null {
  const m = src.trim().match(/^data:(image\/[a-z+]+);base64,(.+)$/s);
  if (!m || m[1] === "image/svg+xml") return null;
  try {
    return { mimeType: m[1], bytes: bytesFromBase64(m[2]) };
  } catch {
    return null;
  }
}

function resolveImageBytes(src: string): { mimeType: string; bytes: Uint8Array } | null {
  if (!src || src.startsWith("http")) return null;
  return extractEmbeddedFromSvgDataUrl(src) || parseDirectBase64(src);
}

function collectSources(row: { image_url?: string | null; images?: unknown }): string[] {
  const out: string[] = [];
  if (row.image_url) out.push(row.image_url);
  if (Array.isArray(row.images)) {
    for (const img of row.images) {
      const src = typeof img === "string" ? img : (img as { src?: string; url?: string })?.src || (img as { url?: string })?.url;
      if (src) out.push(src);
    }
  }
  return out;
}

async function uploadBytes(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  productId: string,
  mimeType: string,
  bytes: Uint8Array,
  suffix: string,
): Promise<string | null> {
  const ext = extFromMime(mimeType);
  const filePath = `products/${productId}_${suffix}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(filePath, bytes, { contentType: mimeType, upsert: true });
  if (error) {
    console.error(`[backfill-images] upload failed ${filePath}:`, error.message);
    return null;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return data.publicUrl || `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filePath}`;
}

/**
 * Backfill products.image_url from bwf_product_master (Master DB).
 * Extracts real photos embedded inside PDF-catalog SVG placeholders.
 * Also syncs ready_to_shopify when a row exists for the product.
 *
 * POST { product_ids?: string[], dry_run?: boolean }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const masterKey = Deno.env.get("MASTER_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !masterKey) {
      return json({ error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or MASTER_SERVICE_ROLE_KEY" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const master = createClient(MASTER_URL, masterKey);

    const body = await req.json().catch(() => ({})) as { product_ids?: string[]; dry_run?: boolean };
    const dryRun = !!body.dry_run;

    let prodQuery = supabase
      .from("products")
      .select("id, sku, bwf_master_id, image_url, images")
      .eq("image_url", "")
      .not("bwf_master_id", "is", null);

    if (body.product_ids?.length) {
      prodQuery = supabase
        .from("products")
        .select("id, sku, bwf_master_id, image_url, images")
        .in("id", body.product_ids);
    }

    const { data: products, error: prodErr } = await prodQuery;
    if (prodErr) return json({ error: prodErr.message }, 500);
    if (!products?.length) return json({ processed: 0, updated: 0, skipped: 0, results: [] });

    const masterIds = [...new Set(products.map((p) => p.bwf_master_id).filter(Boolean))] as string[];
    const { data: masterRows, error: masterErr } = await master
      .from("bwf_product_master")
      .select("id, image_url, images")
      .in("id", masterIds);
    if (masterErr) return json({ error: masterErr.message }, 500);

    const masterById = new Map((masterRows ?? []).map((r) => [r.id as string, r]));
    const results: Record<string, unknown>[] = [];
    let updated = 0;
    let skipped = 0;

    for (const product of products) {
      const masterRow = masterById.get(product.bwf_master_id as string);
      if (!masterRow) {
        skipped++;
        results.push({ id: product.id, sku: product.sku, status: "no_master_row" });
        continue;
      }

      const sources = collectSources(masterRow);
      let publicUrl: string | null = null;
      const resolvedImages: { src: string; alt?: string }[] = [];

      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (src.startsWith("http")) {
          publicUrl = src;
          resolvedImages.push({ src });
          break;
        }
        const parsed = resolveImageBytes(src);
        if (!parsed) continue;
        if (dryRun) {
          publicUrl = `dry-run://${product.id}_${i}.${extFromMime(parsed.mimeType)}`;
          resolvedImages.push({ src: publicUrl });
          break;
        }
        const url = await uploadBytes(supabase, supabaseUrl, product.id as string, parsed.mimeType, parsed.bytes, i === 0 ? "primary" : `img${i}`);
        if (url) {
          publicUrl = url;
          resolvedImages.push({ src: url });
          break;
        }
      }

      if (!publicUrl) {
        skipped++;
        results.push({ id: product.id, sku: product.sku, status: "no_extractable_image", source_count: sources.length });
        continue;
      }

      if (!dryRun) {
        const imagesJson = resolvedImages.length ? resolvedImages : [{ src: publicUrl }];
        const { error: updErr } = await supabase
          .from("products")
          .update({ image_url: publicUrl, images: imagesJson })
          .eq("id", product.id);
        if (updErr) {
          skipped++;
          results.push({ id: product.id, sku: product.sku, status: "update_failed", error: updErr.message });
          continue;
        }

        // Sync to ready_to_shopify when row exists (user-facing publish pipeline images).
        await supabase
          .from("ready_to_shopify")
          .update({ image_url: publicUrl, images: imagesJson })
          .eq("product_id", product.id);

        // Update master DB so future syncs use Storage URL, not SVG placeholder.
        await master
          .from("bwf_product_master")
          .update({ image_url: publicUrl, images: imagesJson })
          .eq("id", product.bwf_master_id);
      }

      updated++;
      results.push({ id: product.id, sku: product.sku, status: "ok", image_url: publicUrl });
    }

    return json({ processed: products.length, updated, skipped, dry_run: dryRun, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill-products-images-from-master]", msg);
    return json({ error: msg }, 500);
  }
});

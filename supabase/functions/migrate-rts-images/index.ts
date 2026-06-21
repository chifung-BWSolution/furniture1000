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

    let body: { batch_size?: number; ddl?: string } = {};
    try { body = await req.json(); } catch { /* no body */ }

    // DDL mode: add furniture_group_checked column via pg driver
    if (body.ddl === "add_furniture_group_checked") {
      try {
        const { Client } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
        const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
        if (!dbUrl) return json({ error: "SUPABASE_DB_URL not set" }, 400);
        const client = new Client(dbUrl);
        await client.connect();
        await client.queryObject("ALTER TABLE public.ready_to_shopify ADD COLUMN IF NOT EXISTS furniture_group_checked boolean DEFAULT null");
        await client.end();
        return json({ ok: true, message: "Column furniture_group_checked added" });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    // DDL mode: reseed bwf_product_categories from 0617 Shopify category list
    if (body.ddl === "reseed_shopify_categories") {
      try {
        const { Client } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
        const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
        if (!dbUrl) return json({ error: "SUPABASE_DB_URL not set" }, 400);
        const client = new Client(dbUrl);
        await client.connect();

        await client.queryObject("DELETE FROM public.bwf_product_categories");

        // Insert L1 categories and capture their IDs
        const l1s: { name: string; sort: number }[] = [
          { name: "3-7天送貨", sort: 1 }, { name: "辦公枱",   sort: 2 }, { name: "工作枱",   sort: 3 },
          { name: "辦公座椅", sort: 4 }, { name: "餐廳傢俬", sort: 5 }, { name: "儲物櫃",   sort: 6 },
          { name: "休閒家具", sort: 7 }, { name: "接待家具", sort: 8 }, { name: "靜音倉",   sort: 9 },
          { name: "學校傢俬", sort: 10 }, { name: "醫療科學", sort: 11 }, { name: "行業傢俬", sort: 12 },
        ];
        const idMap: Record<string, string> = {};
        for (const l1 of l1s) {
          const res = await client.queryObject<{ id: string }>(
            "INSERT INTO public.bwf_product_categories (name, parent_id, level, sort_order) VALUES ($1, NULL, 1, $2) RETURNING id",
            [l1.name, l1.sort]
          );
          idMap[l1.name] = res.rows[0].id;
        }

        const l2s: { l1: string; children: string[] }[] = [
          { l1: "3-7天送貨", children: ["3-7天送貨"] },
          { l1: "辦公枱",   children: ["辦公枱","工作枱","行政枱","升降枱","會議枱","培訓枱","前台接待櫃枱"] },
          { l1: "工作枱",   children: ["開放工作枱","屏風枱"] },
          { l1: "辦公座椅", children: ["辦公座椅","辦公椅","大班椅","會客椅","培訓椅","吧椅","禮堂椅","疊椅","電競椅","設計師椅"] },
          { l1: "餐廳傢俬", children: ["餐廳傢俬","餐枱","餐椅","餐廳卡座","電動餐枱"] },
          { l1: "儲物櫃",   children: ["儲物櫃","文件木櫃","文件鋼櫃","櫃桶","層架"] },
          { l1: "休閒家具", children: ["休閒家具","接待家具","戶外傢俬","茶枱","休閒椅","裝飾傢俬","新中式家具"] },
          { l1: "接待家具", children: ["茶几","梳化"] },
          { l1: "靜音倉",   children: ["靜音倉"] },
          { l1: "學校傢俬", children: ["學校傢俬","幼兒園","中小學","圖書館","學生枱椅","學校辦公","學生宿舍床"] },
          { l1: "醫療科學", children: ["實驗理化枱","護理床","急救車"] },
          { l1: "行業傢俬", children: ["行業傢俬","政府及 NGO","酒店傢俬","安老院","零售店傢俬","醫療診所","實驗室","寵物傢俬","美容院","設計樓"] },
        ];
        for (const group of l2s) {
          const parentId = idMap[group.l1];
          if (!parentId) continue;
          for (let i = 0; i < group.children.length; i++) {
            await client.queryObject(
              "INSERT INTO public.bwf_product_categories (name, parent_id, level, sort_order) VALUES ($1, $2, 2, $3)",
              [group.children[i], parentId, i + 1]
            );
          }
        }

        await client.end();
        return json({ ok: true, message: "bwf_product_categories reseeded with 0617 Shopify category list" });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

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

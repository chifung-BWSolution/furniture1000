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

// "namespace.key" → Shopify metafield type. Mirrors the columns on shopify_products.
const METAFIELD_DEFS: Record<string, string> = {
  "my_fields.recommend_size": "multi_line_text_field",
  "my_fields.normal_size": "multi_line_text_field",
  "my_fields.materials": "multi_line_text_field",
  "my_fields.production_time": "multi_line_text_field",
  "my_fields.more_recommend_size": "multi_line_text_field",
  "my_fields.image_alt": "multi_line_text_field",
  "my_fields.image_link": "url",
  "my_fields.video_link": "url",
  "custom.more_image_link_1": "url",
  "custom.more_image_alt_1": "multi_line_text_field",
  "custom.more_image_link_2": "url",
  "custom.more_image_alt_2": "multi_line_text_field",
  "custom.more_image_link_3": "url",
  "custom.more_image_alt_3": "multi_line_text_field",
  "custom.more_image_link_4": "url",
  "custom.more_image_alt_4": "multi_line_text_field",
};

type PushPayload = {
  source_product_id?: string | null;
  title?: string;
  body_html?: string;
  price?: number | null;
  compare_at_price?: number | null;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  images?: string[];
  variants?: { id?: string | number; index?: number; sku?: string | null }[];
  sku?: string | null;
  metafields?: Record<string, string>;
  handle?: string;
  seo_title?: string;
  seo_description?: string;
};

/** RTS / mirror shopify_url may be "products/slug" — Shopify handle wants "slug". */
function normalizeShopifyHandle(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  let h = raw.trim().replace(/^\/+/, "");
  if (h.startsWith("products/")) h = h.slice("products/".length);
  return h || null;
}

/** Update handle + SEO via GraphQL (REST product PUT does not expose seo fields). */
async function updateSeoAndHandle(
  shopDomain: string,
  token: string,
  shopifyId: string,
  opts: { handle?: string; seoTitle?: string; seoDescription?: string },
): Promise<{ ok: boolean; error?: string }> {
  const input: Record<string, unknown> = { id: `gid://shopify/Product/${shopifyId}` };
  const hasHandle = typeof opts.handle === "string" && opts.handle.trim();
  if (hasHandle) input.handle = opts.handle!.trim();
  if (opts.seoTitle !== undefined || opts.seoDescription !== undefined) {
    input.seo = {
      title: opts.seoTitle ?? "",
      description: opts.seoDescription ?? "",
    };
  }
  if (!hasHandle && input.seo === undefined) return { ok: true };

  const resp = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id handle seo { title description } }
          userErrors { field message }
        }
      }`,
      variables: { input },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return { ok: false, error: `GraphQL SEO update failed (${resp.status}): ${t.slice(0, 200)}` };
  }
  const j = await resp.json();
  const errors = j?.data?.productUpdate?.userErrors;
  if (Array.isArray(errors) && errors.length > 0) {
    return { ok: false, error: errors.map((e: { message: string }) => e.message).join("; ") };
  }
  if (j?.errors?.length) {
    return { ok: false, error: j.errors.map((e: { message: string }) => e.message).join("; ") };
  }
  return { ok: true };
}

/** Build Shopify-format metafields from a {"namespace.key": value} map. */
function buildMetafields(mf: Record<string, string> | undefined) {
  if (!mf) return [];
  const out: { namespace: string; key: string; type: string; value: string }[] = [];
  for (const [col, raw] of Object.entries(mf)) {
    const val = raw != null ? String(raw).trim() : "";
    if (!val) continue;
    const dot = col.indexOf(".");
    if (dot < 0) continue;
    const namespace = col.slice(0, dot);
    const key = col.slice(dot + 1);
    if (namespace === "shopify") continue;
    out.push({ namespace, key, type: METAFIELD_DEFS[col] || "single_line_text_field", value: val });
  }
  return out;
}

function firstSkuFromVariants(variants: Record<string, unknown>[]): string | null {
  for (const variant of variants) {
    const sku = typeof variant.sku === "string" ? variant.sku.trim() : "";
    if (sku) return sku;
  }
  return null;
}

function mirrorRowToPayload(row: Record<string, unknown>): PushPayload {
  const metafields: Record<string, string> = {};
  for (const col of Object.keys(METAFIELD_DEFS)) {
    const v = row[col];
    if (v != null && String(v).trim()) metafields[col] = String(v).trim();
  }
  const images: string[] = [];
  if (Array.isArray(row.images)) {
    for (const im of row.images) {
      const src = typeof im === "string" ? im : (im as { src?: string })?.src;
      if (src && /^https?:\/\//.test(src)) images.push(src);
    }
  } else if (row.image_url && /^https?:\/\//.test(String(row.image_url))) {
    images.push(String(row.image_url));
  }
  const handle = normalizeShopifyHandle(String(row.shopify_url || row.handle || "")) || undefined;
  const variants = Array.isArray(row.variants)
    ? (row.variants as Record<string, unknown>[]).map((v, index) => ({
      id: v.id as string | number | undefined,
      index,
      sku: typeof v.sku === "string" ? v.sku : null,
    }))
    : undefined;
  return {
    source_product_id: (row.source_product_id as string | null) ?? null,
    title: typeof row.title === "string" ? row.title : undefined,
    body_html: typeof row.body_html === "string" ? row.body_html : undefined,
    price: row.price != null ? Number(row.price) : undefined,
    compare_at_price: row.compare_at_price != null ? Number(row.compare_at_price) : undefined,
    vendor: typeof row.vendor === "string" ? row.vendor : undefined,
    product_type: typeof row.product_type === "string" ? row.product_type : undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : undefined,
    images: images.length > 0 ? images : undefined,
    variants,
    sku: typeof row.sku === "string" ? row.sku : undefined,
    metafields: Object.keys(metafields).length > 0 ? metafields : undefined,
    handle,
    seo_title: typeof row.shopify_page_title === "string" ? row.shopify_page_title : undefined,
    seo_description: typeof row.shopify_page_description === "string" ? row.shopify_page_description : undefined,
  };
}

/** Push one product from payload → Shopify (+ optional mirror timestamp refresh). */
async function pushProductToShopify(
  supabase: ReturnType<typeof createClient>,
  shopDomain: string,
  shopifyToken: string,
  shopifyId: string,
  payload: PushPayload,
  opts?: { skipMirrorWrite?: boolean },
): Promise<{ success: boolean; error?: string; metafields_updated?: number; metafields_failed?: number }> {
  const {
    source_product_id: sourceProductId,
    title, body_html: bodyHtml,
    price, compare_at_price: compareAtPrice,
    vendor, product_type: productType, tags,
    images, variants, sku, metafields,
    handle, seo_title: seoTitle, seo_description: seoDescription,
  } = payload;

  const apiBase = `https://${shopDomain}/admin/api/2024-10`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken };

  const getResp = await fetch(`${apiBase}/products/${shopifyId}.json`, { headers });
  if (!getResp.ok) {
    const t = await getResp.text();
    return { success: false, error: `Shopify GET failed (${getResp.status}): ${t.slice(0, 200)}` };
  }
  const existing = (await getResp.json()).product as Record<string, unknown>;
  const existingVariants = (existing.variants as Record<string, unknown>[]) || [];

  const productUpdate: Record<string, unknown> = { id: Number(shopifyId) };
  if (typeof title === "string" && title.trim()) productUpdate.title = title;
  if (typeof bodyHtml === "string") productUpdate.body_html = bodyHtml;
  if (typeof vendor === "string") productUpdate.vendor = vendor;
  if (typeof productType === "string") productUpdate.product_type = productType;
  if (tags !== undefined) {
    productUpdate.tags = Array.isArray(tags)
      ? tags.filter(Boolean).join(", ")
      : String(tags || "");
  }

  const requestedVariantSkus = new Map<string, string | null>();
  if (Array.isArray(variants)) {
    for (const [index, variant] of variants.entries()) {
      const key = variant.id != null ? String(variant.id) : `index-${variant.index ?? index}`;
      requestedVariantSkus.set(key, variant.sku == null ? null : String(variant.sku).trim());
    }
  }
  const fallbackSku = sku == null ? undefined : String(sku).trim();
  const shouldUpdateVariants =
    (price != null && !isNaN(Number(price))) ||
    requestedVariantSkus.size > 0 ||
    fallbackSku !== undefined;

  if (shouldUpdateVariants) {
    productUpdate.variants = existingVariants.map((v, index) => {
      const nv: Record<string, unknown> = { id: v.id };
      if (price != null && !isNaN(Number(price))) nv.price = Number(price).toFixed(2);
      if (
        price != null &&
        compareAtPrice != null &&
        !isNaN(Number(compareAtPrice)) &&
        Number(compareAtPrice) > Number(price)
      ) {
        nv.compare_at_price = Number(compareAtPrice).toFixed(2);
      }
      const idKey = v.id != null ? String(v.id) : "";
      const indexKey = `index-${index}`;
      if (requestedVariantSkus.has(idKey)) {
        nv.sku = requestedVariantSkus.get(idKey) || "";
      } else if (requestedVariantSkus.has(indexKey)) {
        nv.sku = requestedVariantSkus.get(indexKey) || "";
      } else if (fallbackSku !== undefined && existingVariants.length === 1) {
        nv.sku = fallbackSku;
      }
      return nv;
    });
  }

  if (Array.isArray(images)) {
    const valid = images.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
    productUpdate.images = valid.map((src, i) => ({ src, position: i + 1 }));
  }

  const putResp = await fetch(`${apiBase}/products/${shopifyId}.json`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ product: productUpdate }),
  });
  if (!putResp.ok) {
    const t = await putResp.text();
    return { success: false, error: `Shopify PUT failed (${putResp.status}): ${t.slice(0, 200)}` };
  }
  const updated = (await putResp.json()).product as Record<string, unknown>;

  const normalizedHandle = normalizeShopifyHandle(handle) || undefined;
  const seoResult = await updateSeoAndHandle(shopDomain, shopifyToken, shopifyId, {
    handle: normalizedHandle,
    seoTitle: typeof seoTitle === "string" ? seoTitle : undefined,
    seoDescription: typeof seoDescription === "string" ? seoDescription : undefined,
  });
  if (!seoResult.ok) {
    return { success: false, error: seoResult.error || "SEO/handle update failed" };
  }

  const mfs = buildMetafields(metafields);
  let mfOk = 0, mfFail = 0;
  for (const mf of mfs) {
    try {
      const r = await fetch(`${apiBase}/products/${shopifyId}/metafields.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ metafield: { namespace: mf.namespace, key: mf.key, type: mf.type, value: mf.value } }),
      });
      if (r.ok) mfOk++;
      else {
        const existingMf = await fetch(
          `${apiBase}/products/${shopifyId}/metafields.json?namespace=${mf.namespace}&key=${mf.key}`,
          { headers },
        ).then((x) => x.ok ? x.json() : { metafields: [] }).catch(() => ({ metafields: [] }));
        const mid = existingMf?.metafields?.[0]?.id;
        if (mid) {
          const pr = await fetch(`${apiBase}/metafields/${mid}.json`, {
            method: "PUT", headers,
            body: JSON.stringify({ metafield: { id: mid, type: mf.type, value: mf.value } }),
          });
          if (pr.ok) mfOk++; else mfFail++;
        } else mfFail++;
      }
    } catch { mfFail++; }
  }

  if (!opts?.skipMirrorWrite) {
    const mfColumns: Record<string, string> = {};
    for (const mf of mfs) mfColumns[`${mf.namespace}.${mf.key}`] = mf.value;
    const spUpdate: Record<string, unknown> = {
      shopify_updated_at: String(updated.updated_at || new Date().toISOString()),
      ...mfColumns,
    };
    const updatedVariants = Array.isArray(updated.variants) ? updated.variants as Record<string, unknown>[] : [];
    if (shouldUpdateVariants) {
      spUpdate.variants = updatedVariants;
      spUpdate.sku = firstSkuFromVariants(updatedVariants) ?? fallbackSku ?? null;
    }
    if (typeof title === "string" && title.trim()) spUpdate.title = title;
    if (typeof bodyHtml === "string") spUpdate.body_html = bodyHtml;
    if (typeof vendor === "string") spUpdate.vendor = vendor;
    if (typeof productType === "string") spUpdate.product_type = productType;
    if (tags !== undefined) {
      spUpdate.tags = Array.isArray(tags)
        ? tags.filter(Boolean)
        : String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    }
    if (price != null && !isNaN(Number(price))) spUpdate.price = Number(price);
    if (compareAtPrice != null && !isNaN(Number(compareAtPrice))) spUpdate.compare_at_price = Number(compareAtPrice);
    if (Array.isArray(images)) {
      const valid = images.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
      spUpdate.image_url = valid[0] || null;
      spUpdate.images = valid.map((src, i) => ({ src, position: i + 1 }));
      if (mfs.length > 0) spUpdate.metafields = mfs;
    } else if (mfs.length > 0) {
      spUpdate.metafields = mfs;
    }
    if (normalizedHandle) {
      spUpdate.handle = normalizedHandle;
      spUpdate.shopify_url = normalizedHandle;
    }
    if (typeof seoTitle === "string") spUpdate.shopify_page_title = seoTitle.trim() || null;
    if (typeof seoDescription === "string") spUpdate.shopify_page_description = seoDescription.trim() || null;
    await supabase.from("shopify_products").update(spUpdate).eq("shopify_product_id", shopifyId);
  }

  return {
    success: true,
    metafields_updated: mfOk,
    metafields_failed: mfFail,
    ...(sourceProductId ? {} : {}),
  };
}

/** Push mirror rows to Shopify (existing products only — never creates). */
async function pushMirrorRows(
  supabase: ReturnType<typeof createClient>,
  shopDomain: string,
  shopifyToken: string,
  rows: Record<string, unknown>[],
) {
  let pushed = 0;
  let failed = 0;
  let skipped = 0;
  const errors: { shopify_product_id: string; error: string }[] = [];
  for (const row of rows) {
    const sid = String(row.shopify_product_id || "");
    if (!/^\d+$/.test(sid)) {
      skipped++;
      continue;
    }
    const payload = mirrorRowToPayload(row);
    const result = await pushProductToShopify(supabase, shopDomain, shopifyToken, sid, payload, { skipMirrorWrite: true });
    if (result.success) {
      pushed++;
      await supabase.from("shopify_products").update({
        shopify_updated_at: new Date().toISOString(),
      }).eq("shopify_product_id", sid);
    } else {
      failed++;
      if (errors.length < 20) errors.push({ shopify_product_id: sid, error: result.error || "unknown" });
    }
  }
  return { pushed, failed, skipped, errors };
}

/**
 * update-shopify-product
 *
 * Single product push: POST { shopify_product_id, title?, body_html?, ... }
 * Push one mirror row: POST { push_from_mirror: true, shopify_product_id }
 * Push selected mirror rows: POST { shopify_product_ids: string[] }
 * Batch push all mirror rows: POST { push_all_from_mirror: true }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseKey) return json({ error: "Missing env vars" }, 400);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: conn } = await supabase
      .from("shopify_connections")
      .select("shop_domain, access_token")
      .eq("is_active", true)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const shopifyToken = conn?.access_token || Deno.env.get("SHOPIFY_ACCESS_TOKEN") || "";
    const shopDomain = (conn?.shop_domain || Deno.env.get("SHOPIFY_STORE_URL") || "")
      .replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!shopifyToken || !shopDomain) return json({ error: "Shopify credentials not configured." }, 400);

    const body = await req.json().catch(() => ({})) as {
      push_all_from_mirror?: boolean;
      push_from_mirror?: boolean;
      shopify_product_ids?: string[];
      shopify_product_id?: string;
      source_product_id?: string;
      title?: string;
      body_html?: string;
      price?: number | null;
      compare_at_price?: number | null;
      vendor?: string;
      product_type?: string;
      tags?: string[] | string;
      images?: string[];
      variants?: { id?: string | number; index?: number; sku?: string | null }[];
      sku?: string | null;
      metafields?: Record<string, string>;
      handle?: string;
      seo_title?: string;
      seo_description?: string;
    };

    if (body.push_all_from_mirror) {
      const { data: rows, error: fetchErr } = await supabase.from("shopify_products").select("*");
      if (fetchErr) return json({ error: fetchErr.message }, 500);
      const stats = await pushMirrorRows(supabase, shopDomain, shopifyToken, (rows || []) as Record<string, unknown>[]);
      return json({ success: true, mode: "push_all_from_mirror", ...stats });
    }

    if (Array.isArray(body.shopify_product_ids) && body.shopify_product_ids.length > 0) {
      const ids = body.shopify_product_ids.map(String).filter((id) => /^\d+$/.test(id));
      if (ids.length === 0) return json({ error: "No valid numeric shopify_product_ids" }, 400);
      const { data: rows, error: fetchErr } = await supabase
        .from("shopify_products")
        .select("*")
        .in("shopify_product_id", ids);
      if (fetchErr) return json({ error: fetchErr.message }, 500);
      const stats = await pushMirrorRows(supabase, shopDomain, shopifyToken, (rows || []) as Record<string, unknown>[]);
      return json({ success: true, mode: "push_selected_from_mirror", ...stats });
    }

    if (body.push_from_mirror && body.shopify_product_id) {
      const sid = String(body.shopify_product_id);
      if (!/^\d+$/.test(sid)) return json({ error: "Invalid shopify_product_id" }, 400);
      const { data: row, error: fetchErr } = await supabase
        .from("shopify_products")
        .select("*")
        .eq("shopify_product_id", sid)
        .maybeSingle();
      if (fetchErr) return json({ error: fetchErr.message }, 500);
      if (!row) return json({ error: `No shopify_products row for ${sid}` }, 404);
      const stats = await pushMirrorRows(supabase, shopDomain, shopifyToken, [row as Record<string, unknown>]);
      if (stats.failed > 0) {
        return json({ success: false, error: stats.errors[0]?.error || "Push failed", ...stats }, 502);
      }
      return json({ success: true, mode: "push_from_mirror", ...stats });
    }

    const shopifyId = body.shopify_product_id;
    if (!shopifyId) return json({ error: "shopify_product_id is required" }, 400);

    const result = await pushProductToShopify(supabase, shopDomain, shopifyToken, shopifyId, body);
    if (!result.success) return json({ error: result.error || "Push failed" }, 502);

    return json({
      success: true,
      shopify_product_id: shopifyId,
      source_product_id: body.source_product_id || null,
      metafields_updated: result.metafields_updated,
      metafields_failed: result.metafields_failed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[update-shopify-product] Error:", msg);
    return json({ error: msg }, 500);
  }
});

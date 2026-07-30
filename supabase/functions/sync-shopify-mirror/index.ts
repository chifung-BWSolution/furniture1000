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

/** Plain text for meta description when Shopify seo.description is unset. */
function plainProductDescription(node: {
  description?: string | null;
  descriptionHtml?: string | null;
}): string | null {
  const direct = typeof node.description === "string" ? node.description.trim() : "";
  if (direct) return direct;
  const html = typeof node.descriptionHtml === "string" ? node.descriptionHtml : "";
  if (!html) return null;
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

/** Fetch SEO for ALL products via GraphQL pagination (REST omits seo fields). */
async function fetchAllProductsSeoGraphQL(
  shopDomain: string,
  token: string,
): Promise<Map<string, {
  shopify_page_title: string | null;
  shopify_page_description: string | null;
  shopify_url: string | null;
}>> {
  const out = new Map<string, {
    shopify_page_title: string | null;
    shopify_page_description: string | null;
    shopify_url: string | null;
  }>();
  let cursor: string | null = null;
  const gqlHeaders = { "Content-Type": "application/json", "X-Shopify-Access-Token": token };

  for (;;) {
    const resp = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: gqlHeaders,
      body: JSON.stringify({
        query: `query productsSeo($cursor: String) {
          products(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              title
              handle
              description
              descriptionHtml
              seo { title description }
            }
          }
        }`,
        variables: { cursor },
      }),
    });
    if (!resp.ok) {
      console.error("[sync-shopify-mirror] SEO GraphQL error:", resp.status, (await resp.text()).slice(0, 200));
      break;
    }
    const j = await resp.json();
    if (j?.errors?.length) {
      console.error("[sync-shopify-mirror] SEO GraphQL errors:", JSON.stringify(j.errors).slice(0, 300));
      break;
    }
    const conn = j?.data?.products;
    const nodes = conn?.nodes ?? [];
    for (const node of nodes) {
      const gid = String(node?.id ?? "");
      const shopifyId = gid.replace("gid://shopify/Product/", "");
      if (!/^\d+$/.test(shopifyId)) continue;
      const seo = node?.seo ?? {};
      const handle = typeof node?.handle === "string" && node.handle.trim() ? node.handle.trim() : null;
      const productTitle = typeof node?.title === "string" && node.title.trim() ? node.title.trim() : null;
      const seoTitle = typeof seo.title === "string" && seo.title.trim() ? seo.title.trim() : null;
      const seoDesc = typeof seo.description === "string" && seo.description.trim() ? seo.description.trim() : null;
      const fallbackDesc = plainProductDescription(node);
      out.set(shopifyId, {
        shopify_page_title: seoTitle || productTitle,
        // Shopify Admin shows product description in Meta description when seo.description is unset.
        shopify_page_description: seoDesc || fallbackDesc,
        shopify_url: handle,
      });
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }
  return out;
}

/** Apply SEO map to shopify_products mirror rows (parallel batches). */
async function applySeoBackfill(
  supabase: ReturnType<typeof createClient>,
  seoMap: Map<string, {
    shopify_page_title: string | null;
    shopify_page_description: string | null;
    shopify_url: string | null;
  }>,
  opts?: { fillOnlyNull?: boolean },
): Promise<number> {
  let updated = 0;
  const entries = Array.from(seoMap.entries());
  const BATCH = 20;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    await Promise.all(batch.map(async ([shopifyId, seo]) => {
      if (opts?.fillOnlyNull) {
        const { data: row, error: fetchErr } = await supabase
          .from("shopify_products")
          .select("shopify_page_title, shopify_page_description, shopify_url")
          .eq("shopify_product_id", shopifyId)
          .maybeSingle();
        if (fetchErr || !row) return;
        const patch: Record<string, string> = {};
        const curTitle = (row.shopify_page_title as string | null)?.trim();
        const curDesc = (row.shopify_page_description as string | null)?.trim();
        const curUrl = (row.shopify_url as string | null)?.trim();
        if (!curTitle && seo.shopify_page_title) patch.shopify_page_title = seo.shopify_page_title;
        if (!curDesc && seo.shopify_page_description) patch.shopify_page_description = seo.shopify_page_description;
        if (!curUrl && seo.shopify_url) patch.shopify_url = seo.shopify_url;
        if (Object.keys(patch).length === 0) return;
        const { error } = await supabase
          .from("shopify_products")
          .update(patch)
          .eq("shopify_product_id", shopifyId);
        if (!error) updated++;
        else console.error(`[sync-shopify-mirror] SEO fill ${shopifyId}:`, error.message);
        return;
      }
      const { error } = await supabase
        .from("shopify_products")
        .update(seo)
        .eq("shopify_product_id", shopifyId);
      if (!error) updated++;
      else console.error(`[sync-shopify-mirror] SEO update ${shopifyId}:`, error.message);
    }));
  }
  return updated;
}

function stripEditorArtifactHtml(html: string | null): string | null {
  if (!html) return html;
  let out = html;
  out = out.replace(/\s+style="[^"]*--tw-[^"]*"/gi, "");
  out = out.replace(/\s+style='[^']*--tw-[^']*'/gi, "");
  out = out.replace(/<br\s*\/?>/gi, "<br>");
  return out;
}

/** Fetch specific products by Shopify numeric IDs. */
async function fetchProductsByIds(
  apiBase: string,
  headers: Record<string, string>,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  const products: Record<string, unknown>[] = [];
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const url =
      `${apiBase}/products.json?limit=250&ids=${chunk.join(",")}&fields=id,title,body_html,vendor,product_type,handle,status,published_at,images,variants,tags,created_at,updated_at`;
    const r = await fetch(url, { headers });
    if (!r.ok) continue;
    const j = await r.json();
    if (Array.isArray(j.products)) products.push(...j.products);
  }
  return products;
}

function imageIdentityKey(url: string): string {
  const noQuery = url.split("?")[0];
  const base = noQuery.substring(noQuery.lastIndexOf("/") + 1);
  let stem = base
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(
      /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "",
    )
    .trim()
    .toLowerCase();
  if (/cdn\.shopify\.com/i.test(url)) {
    stem = stem.replace(/_\d{1,2}$/, "");
  }
  return stem;
}

function sortLiveImages(images: Record<string, unknown>[]): Record<string, unknown>[] {
  const sorted = [...images]
    .filter((im) => typeof im.src === "string" && (im.src as string).startsWith("http"))
    .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99));
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const im of sorted) {
    const key = imageIdentityKey(String(im.src));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(im);
  }
  return out;
}

/**
 * Remove stem-duplicate images from live Shopify.
 * Prefer keeping the image whose CDN URL is referenced by more_image_link_* metafields
 * so storefront links do not break after purge. Then rewrite more_image_* to kept URLs.
 */
async function purgeDuplicateShopifyImages(
  shopDomain: string,
  token: string,
  productId: string,
  images: Record<string, unknown>[],
  preferredSrcs: string[] = [],
): Promise<{ kept: Record<string, unknown>[]; deleted: number; rewrittenMetafields: boolean }> {
  const ordered = [...images]
    .filter((im) => typeof im.src === "string" && (im.src as string).startsWith("http"))
    .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99));

  if (ordered.length <= 1) {
    return { kept: ordered, deleted: 0, rewrittenMetafields: false };
  }

  const preferredKeys = new Set(
    preferredSrcs
      .filter((s) => typeof s === "string" && s.startsWith("http"))
      .map((s) => imageIdentityKey(s)),
  );
  const preferredExact = new Set(
    preferredSrcs
      .filter((s) => typeof s === "string" && s.startsWith("http"))
      .map((s) => s.split("?")[0]),
  );

  // Group by stem identity
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const im of ordered) {
    const key = imageIdentityKey(String(im.src));
    const list = groups.get(key) || [];
    list.push(im);
    groups.set(key, list);
  }

  // No duplicates → nothing to do (avoid unnecessary Shopify writes)
  if (![...groups.values()].some((g) => g.length > 1)) {
    return { kept: ordered, deleted: 0, rewrittenMetafields: false };
  }

  const pickKeep = (group: Record<string, unknown>[]): Record<string, unknown> => {
    const exact = group.find((im) => preferredExact.has(String(im.src).split("?")[0]));
    if (exact) return exact;
    const byStem = group.find((im) => preferredKeys.has(imageIdentityKey(String(im.src))));
    if (byStem) return byStem;
    // Prefer non-UUID / shorter filename (original upload)
    return [...group].sort((a, b) => {
      const sa = String(a.src);
      const sb = String(b.src);
      const ua = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sa) ? 1 : 0;
      const ub = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sb) ? 1 : 0;
      if (ua !== ub) return ua - ub;
      return sa.length - sb.length || (Number(a.position) || 99) - (Number(b.position) || 99);
    })[0];
  };

  const kept: Record<string, unknown>[] = [];
  const deleteIds: string[] = [];
  // Preserve original position order of first occurrence groups
  const seenGroup = new Set<string>();
  for (const im of ordered) {
    const key = imageIdentityKey(String(im.src));
    if (seenGroup.has(key)) continue;
    seenGroup.add(key);
    const group = groups.get(key) || [im];
    const keep = pickKeep(group);
    kept.push(keep);
    for (const other of group) {
      if (other === keep) continue;
      if (other.id != null) deleteIds.push(String(other.id));
    }
  }

  let deleted = 0;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
  for (const imageId of deleteIds) {
    try {
      const resp = await fetch(
        `https://${shopDomain}/admin/api/2024-10/products/${productId}/images/${imageId}.json`,
        { method: "DELETE", headers },
      );
      if (resp.ok || resp.status === 404) deleted++;
      else {
        console.warn(
          `[sync-shopify-mirror] failed to delete duplicate image ${imageId} on ${productId}: ${resp.status}`,
        );
      }
    } catch (err) {
      console.warn(`[sync-shopify-mirror] delete image error:`, err);
    }
  }

  // Rewrite more_image_link_* to kept CDN URLs so storefront never points at deleted dupes.
  let rewrittenMetafields = false;
  const keptUrls = kept
    .map((im) => String(im.src || ""))
    .filter((s) => s.startsWith("http"))
    .slice(0, 4);
  if (deleted > 0) {
    rewrittenMetafields = await rewriteMoreImageLinksToUrls(
      shopDomain,
      token,
      productId,
      keptUrls,
    );
  }

  return { kept, deleted, rewrittenMetafields };
}

/**
 * Align custom.more_image_link_1..4 with the product's current live gallery URLs.
 * Clears slots beyond the live gallery so storefront never points at removed images.
 */
async function rewriteMoreImageLinksToUrls(
  shopDomain: string,
  token: string,
  productId: string,
  keptUrls: string[],
): Promise<boolean> {
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
  let rewritten = false;
  try {
    for (let i = 1; i <= 4; i++) {
      const url = keptUrls[i - 1] || "";
      const ns = "custom";
      const linkKey = `more_image_link_${i}`;

      const existingResp = await fetch(
        `https://${shopDomain}/admin/api/2024-10/products/${productId}/metafields.json?namespace=${ns}&key=${linkKey}`,
        { headers },
      );
      const existing = existingResp.ok
        ? ((await existingResp.json()).metafields?.[0] as { id?: number; value?: string } | undefined)
        : undefined;

      if (!url) {
        if (existing?.id) {
          await fetch(`https://${shopDomain}/admin/api/2024-10/metafields/${existing.id}.json`, {
            method: "DELETE",
            headers,
          });
          rewritten = true;
        }
        continue;
      }

      if (existing?.value === url) continue;

      if (existing?.id) {
        const pr = await fetch(`https://${shopDomain}/admin/api/2024-10/metafields/${existing.id}.json`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ metafield: { id: existing.id, type: "url", value: url } }),
        });
        if (pr.ok) rewritten = true;
      } else {
        const pr = await fetch(
          `https://${shopDomain}/admin/api/2024-10/products/${productId}/metafields.json`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              metafield: { namespace: ns, key: linkKey, type: "url", value: url },
            }),
          },
        );
        if (pr.ok) rewritten = true;
      }
    }
  } catch (err) {
    console.warn(`[sync-shopify-mirror] more_image rewrite failed for ${productId}:`, err);
  }
  return rewritten;
}

/** True when mirror more_image_link_* points at stems no longer in the live gallery. */
function mirrorMoreImageLinksAreOrphaned(
  liveImages: Record<string, unknown>[],
  mirrorLinks: Array<string | null | undefined>,
): boolean {
  const liveUrls = liveImages
    .map((im) => String(im.src || ""))
    .filter((s) => s.startsWith("http"));
  const liveKeys = new Set(liveUrls.map((s) => imageIdentityKey(s)));
  const liveExact = new Set(liveUrls.map((s) => s.split("?")[0]));
  const links = mirrorLinks.filter((s): s is string => typeof s === "string" && s.startsWith("http"));
  if (links.length === 0) return false;
  if (links.length > liveUrls.length) return true;
  for (const link of links) {
    const exact = link.split("?")[0];
    if (liveExact.has(exact) || liveKeys.has(imageIdentityKey(link))) continue;
    return true;
  }
  return false;
}

async function fetchMoreImagePreferredSrcs(
  shopDomain: string,
  token: string,
  productId: string,
): Promise<string[]> {
  const headers = { "X-Shopify-Access-Token": token };
  const out: string[] = [];
  try {
    const resp = await fetch(
      `https://${shopDomain}/admin/api/2024-10/products/${productId}/metafields.json?namespace=custom`,
      { headers },
    );
    if (!resp.ok) return out;
    const mfs = ((await resp.json()).metafields || []) as Array<{ key?: string; value?: string }>;
    for (let i = 1; i <= 4; i++) {
      const mf = mfs.find((m) => m.key === `more_image_link_${i}`);
      const val = (mf?.value || "").trim();
      if (val.startsWith("http")) out.push(val);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function buildMirrorRow(
  sp: Record<string, unknown>,
  shopDomain: string,
  nowIso: string,
  prev?: {
    id: string;
    source_product_id: string | null;
    shopify_page_title: string | null;
    shopify_page_description: string | null;
    shopify_url: string | null;
    /** Parent SKU when this row was merged as a child — must survive reconcile upserts. */
    configurable: string | null;
  },
): Record<string, unknown> {
  const shopifyId = String(sp.id);
  const variants = (sp.variants as Record<string, unknown>[]) ?? [];
  const prices = variants.map((v) => parseFloat(String(v.price ?? "0")) || 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const compareAt = variants.length && variants[0].compare_at_price
    ? parseFloat(String(variants[0].compare_at_price)) || null : null;
  const images = sortLiveImages((sp.images as Record<string, unknown>[]) ?? []);
  const tags = ((sp.tags as string) || "").split(",").map((t) => t.trim()).filter(Boolean);
  const localUrl = prev?.shopify_url?.trim() || null;
  const prevConfigurable = typeof prev?.configurable === "string" && prev.configurable.trim()
    ? prev.configurable.trim()
    : null;

  const row: Record<string, unknown> = {
    shopify_product_id: shopifyId,
    title: sp.title ?? "(未命名)",
    body_html: stripEditorArtifactHtml((sp.body_html as string) ?? null),
    vendor: sp.vendor ?? null,
    product_type: sp.product_type ?? null,
    handle: localUrl || (sp.handle ?? null),
    shopify_url: localUrl || (sp.handle ?? null),
    status: sp.status ?? "active",
    published_at: sp.published_at ?? null,
    image_url: (images[0]?.src as string) ?? null,
    images: images.length > 0 ? images.map((im, i) => ({
      id: im.id, src: im.src, alt: im.alt || "", width: im.width, height: im.height, position: i + 1,
    })) : null,
    variants: variants.length > 0 ? variants : null,
    tags,
    price: minPrice,
    compare_at_price: compareAt,
    shopify_created_at: sp.created_at ?? null,
    shopify_updated_at: sp.updated_at ?? null,
    imported_at: nowIso,
    shop_domain: shopDomain,
    id: prev?.id ?? null,
    source_product_id: prev?.source_product_id ?? null,
    // Merged children stay hidden on 已上載產品 (filter configurable IS NULL).
    // Explicitly re-write so upsert never clears the merge marker.
    configurable: prevConfigurable,
  };
  return row;
}

/**
 * sync-shopify-mirror
 *
 * Mirror reconciliation: makes shopify_products an exact reflection of the live
 * Shopify store.
 *  1. Fetch ALL products from Shopify (paginated).
 *  2. UPSERT each into shopify_products (status, title, price, images, handle…),
 *     preserving the existing row's id / source_product_id / configurable /
 *     metafield columns (merged children keep configurable so they stay hidden).
 *  3. DELETE any shopify_products row whose shopify_product_id is no longer on
 *     Shopify (product was deleted in the Shopify admin).
 *
 * POST { backfill_seo?: boolean }  → SEO-only backfill (no mirror reconcile)
 * POST { product_ids?: string[] }  → partial reconcile for specific Shopify IDs
 * POST { skip_seo?: boolean }      → skip SEO backfill on full/partial reconcile
 * POST {}                          → full mirror reconcile (SEO fill-only-null)
 *
 * Title/price/status always reflect Shopify (source of truth for the mirror).
 * Metafield columns are NOT touched here — they are owned by the import /
 * update-shopify-product flows.
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

    let body: { backfill_seo?: boolean; product_ids?: string[]; skip_seo?: boolean } = {};
    try { body = await req.json(); } catch { /* empty body */ }

    // ── SEO-only mode: pull Page title / Meta description / URL handle for all products ──
    if (body.backfill_seo) {
      const seoMap = await fetchAllProductsSeoGraphQL(shopDomain, shopifyToken);
      const seoBackfilled = await applySeoBackfill(supabase, seoMap);
      return json({
        success: true,
        mode: "backfill_seo",
        shopify_products_fetched: seoMap.size,
        seo_backfilled: seoBackfilled,
      });
    }

    const apiBase = `https://${shopDomain}/admin/api/2024-10`;
    const headers = { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" };

    const partialIds = (body.product_ids ?? [])
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id));

    // ── 1. Fetch live Shopify products ──
    let live: Record<string, unknown>[] = [];
    let fetchedPages = 0;
    if (partialIds.length > 0) {
      live = await fetchProductsByIds(apiBase, headers, partialIds);
    } else {
      let url: string | null =
        `${apiBase}/products.json?limit=250&fields=id,title,body_html,vendor,product_type,handle,status,published_at,images,variants,tags,created_at,updated_at`;
      while (url) {
        const r = await fetch(url, { headers });
        if (!r.ok) {
          const t = await r.text();
          return json({ error: `Shopify API error (${r.status})`, detail: t.slice(0, 300) }, 502);
        }
        const j = await r.json();
        if (Array.isArray(j.products)) live.push(...j.products);
        fetchedPages++;
        const link = r.headers.get("link") || "";
        const m = link.match(/<([^>]+)>;\s*rel="next"/);
        url = m ? m[1] : null;
      }
    }

    // SAFETY GUARD: if Shopify returned zero products, do NOT delete anything —
    // a transient/auth/parameter error must never wipe the mirror. Bail out.
    if (live.length === 0) {
      return json({
        success: false,
        live: 0,
        upserted: 0,
        deleted: 0,
        error: "Shopify returned 0 products — aborting sync to protect the mirror (no rows deleted).",
      });
    }

    const liveIds = new Set(live.map((p) => String(p.id)));

    // ── 2. Load existing mirror rows to preserve id / source_product_id / local SEO ──
    // Also load more_image_link_* so we can cheaply detect orphaned metafield URLs
    // without fetching metafields for every product on each sync.
    const { data: existingRows } = await supabase
      .from("shopify_products")
      .select(
        'id, shopify_product_id, source_product_id, shopify_page_title, shopify_page_description, shopify_url, configurable, "custom.more_image_link_1", "custom.more_image_link_2", "custom.more_image_link_3", "custom.more_image_link_4"',
      );
    type MirrorPrev = {
      id: string;
      source_product_id: string | null;
      shopify_page_title: string | null;
      shopify_page_description: string | null;
      shopify_url: string | null;
      configurable: string | null;
      "custom.more_image_link_1"?: string | null;
      "custom.more_image_link_2"?: string | null;
      "custom.more_image_link_3"?: string | null;
      "custom.more_image_link_4"?: string | null;
    };
    const existingByShopifyId = new Map<string, MirrorPrev>();
    (existingRows || []).forEach((r: MirrorPrev & { shopify_product_id: string }) => {
      existingByShopifyId.set(String(r.shopify_product_id), r);
    });

    // ── 3. Purge stem-duplicate images on Shopify (only when needed),
    //     repair orphaned more_image_link_* (when mirror shows stale URLs),
    //     then UPSERT mirror ──
    let upserted = 0;
    let imagesPurged = 0;
    let metafieldsRewritten = 0;
    const nowIso = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    for (const p of live) {
      const sp = p as Record<string, unknown>;
      const shopifyId = String(sp.id);
      const prev = existingByShopifyId.get(shopifyId);
      const rawImages = (sp.images as Record<string, unknown>[]) ?? [];
      let moreImageCols: Record<string, string | null> | null = null;

      // Cheap stem-dup check before any metafield/Shopify write.
      const stemSeen = new Set<string>();
      let hasStemDup = false;
      for (const im of rawImages) {
        const src = typeof im.src === "string" ? im.src : "";
        if (!src.startsWith("http")) continue;
        const key = imageIdentityKey(src);
        if (stemSeen.has(key)) {
          hasStemDup = true;
          break;
        }
        stemSeen.add(key);
      }

      if (hasStemDup) {
        const preferred = await fetchMoreImagePreferredSrcs(
          shopDomain,
          shopifyToken,
          shopifyId,
        );
        const { kept, deleted, rewrittenMetafields } = await purgeDuplicateShopifyImages(
          shopDomain,
          shopifyToken,
          shopifyId,
          rawImages,
          preferred,
        );
        imagesPurged += deleted;
        if (rewrittenMetafields) metafieldsRewritten++;
        sp.images = kept;
        if (deleted > 0) {
          const keptUrls = kept
            .map((im) => String(im.src || ""))
            .filter((s) => s.startsWith("http"))
            .slice(0, 4);
          moreImageCols = {};
          for (let i = 1; i <= 4; i++) {
            moreImageCols[`custom.more_image_link_${i}`] = keptUrls[i - 1] || null;
          }
        }
      } else {
        // No stem dupes → do not re-upload. Still repair more_image_link if mirror
        // shows links that no longer match the live gallery (e.g. gallery shrank).
        const mirrorLinks = [
          prev?.["custom.more_image_link_1"],
          prev?.["custom.more_image_link_2"],
          prev?.["custom.more_image_link_3"],
          prev?.["custom.more_image_link_4"],
        ];
        const liveSorted = sortLiveImages(rawImages);
        if (mirrorMoreImageLinksAreOrphaned(liveSorted, mirrorLinks)) {
          const keptUrls = liveSorted
            .map((im) => String(im.src || ""))
            .filter((s) => s.startsWith("http"))
            .slice(0, 4);
          const rewritten = await rewriteMoreImageLinksToUrls(
            shopDomain,
            shopifyToken,
            shopifyId,
            keptUrls,
          );
          if (rewritten) metafieldsRewritten++;
          moreImageCols = {};
          for (let i = 1; i <= 4; i++) {
            moreImageCols[`custom.more_image_link_${i}`] = keptUrls[i - 1] || null;
          }
        }
      }

      const row = buildMirrorRow(sp, shopDomain, nowIso, prev);
      if (moreImageCols) Object.assign(row, moreImageCols);
      rows.push(row);
    }
    const UPSERT_CHUNK = 50;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from("shopify_products")
        .upsert(chunk, { onConflict: "shopify_product_id" });
      if (!error) upserted += chunk.length;
      else console.error(`[sync-shopify-mirror] batch upsert error:`, error.message);
    }

    // ── 4. DELETE orphan mirror rows (full reconcile only) ──
    // Includes merged child rows (configurable set) — those products were removed on Shopify
    // during variant merge and must not linger as stale "已下架" entries in the mirror.
    let deleted = 0;
    if (partialIds.length === 0) {
      const orphanIds = (existingRows || [])
        .map((r: { shopify_product_id: string }) => String(r.shopify_product_id))
        .filter((id) => /^\d+$/.test(id) && !liveIds.has(id));
      if (orphanIds.length > 0) {
        const { error: delErr, count } = await supabase
          .from("shopify_products")
          .delete({ count: "exact" })
          .in("shopify_product_id", orphanIds);
        if (delErr) console.error("[sync-shopify-mirror] delete orphans error:", delErr.message);
        else deleted = count ?? orphanIds.length;
      }
    }

    // ── 5. Backfill source_product_id from products.shopify_product_id ──
    // New rows (created after a wipe) have no products linkage; restore it so the
    // catalog can tell which local product each Shopify product came from.
    try {
      const { data: prodLinks } = await supabase
        .from("products")
        .select("id, shopify_product_id")
        .not("shopify_product_id", "is", null);
      const prodByShopifyId = new Map<string, string>();
      (prodLinks || []).forEach((p: { id: string; shopify_product_id: string | null }) => {
        if (p.shopify_product_id) prodByShopifyId.set(String(p.shopify_product_id), p.id);
      });
      for (const id of liveIds) {
        const prodId = prodByShopifyId.get(id);
        if (prodId) {
          await supabase
            .from("shopify_products")
            .update({ source_product_id: prodId })
            .eq("shopify_product_id", id)
            .is("source_product_id", null);
        }
      }
    } catch (e) {
      console.warn("[sync-shopify-mirror] source_product_id backfill skipped:", e instanceof Error ? e.message : String(e));
    }

    // ── 6. Backfill SEO (optional — skipped by default on reconcile for speed) ──
    let seoBackfilled = 0;
    if (!body.skip_seo) {
      try {
        const seoMap = await fetchAllProductsSeoGraphQL(shopDomain, shopifyToken);
        seoBackfilled = await applySeoBackfill(supabase, seoMap, { fillOnlyNull: true });
      } catch (e) {
        console.warn("[sync-shopify-mirror] SEO backfill skipped:", e instanceof Error ? e.message : String(e));
      }
    }

    return json({
      success: true,
      mode: partialIds.length > 0 ? "partial" : "full",
      live: live.length,
      upserted,
      deleted,
      images_purged: imagesPurged,
      metafields_rewritten: metafieldsRewritten,
      seo_backfilled: seoBackfilled,
      fetched_pages: fetchedPages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-shopify-mirror] Error:", msg);
    return json({ error: msg }, 500);
  }
});

#!/usr/bin/env node
/**
 * Full Shopify → shopify_products mirror reconcile (server-side, no client timeout).
 * Same logic as sync-shopify-mirror edge function but runs locally with service role.
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

function stripEditorArtifactHtml(html) {
  if (!html) return html;
  let out = html;
  out = out.replace(/\s+style="[^"]*--tw-[^"]*"/gi, '');
  out = out.replace(/\s+style='[^']*--tw-[^']*'/gi, '');
  out = out.replace(/<br\s*\/?>/gi, '<br>');
  return out;
}

async function rest(path, opts = {}) {
  const res = await fetch(`${FURNITURE}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function sortLiveImages(images) {
  return [...images]
    .filter((im) => typeof im.src === 'string' && im.src.startsWith('http'))
    .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99));
}

async function main() {
  const conn = await rest('shopify_connections?is_active=eq.true&order=connected_at.desc&limit=1&select=shop_domain,access_token');
  const shopDomain = (conn[0]?.shop_domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const token = conn[0]?.access_token;
  if (!shopDomain || !token) throw new Error('Shopify credentials not found');

  console.log(`Fetching all products from ${shopDomain}...`);
  const shopHeaders = { 'X-Shopify-Access-Token': token };
  const live = [];
  let url = `https://${shopDomain}/admin/api/2024-10/products.json?limit=250&fields=id,title,body_html,vendor,product_type,handle,status,published_at,images,variants,tags,created_at,updated_at`;
  while (url) {
    const r = await fetch(url, { headers: shopHeaders });
    if (!r.ok) throw new Error(`Shopify ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    live.push(...(j.products || []));
    const link = r.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    process.stdout.write(`\rFetched ${live.length} products...`);
  }
  console.log(`\nShopify live: ${live.length}`);

  const existing = await rest('shopify_products?select=id,shopify_product_id,source_product_id,shopify_url');
  const existingById = new Map(existing.map((r) => [String(r.shopify_product_id), r]));
  const nowIso = new Date().toISOString();

  const rows = live.map((p) => {
    const variants = p.variants || [];
    const prices = variants.map((v) => parseFloat(v.price ?? '0') || 0);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const compareAt = variants.length && variants[0].compare_at_price
      ? parseFloat(variants[0].compare_at_price) || null
      : null;
    const images = sortLiveImages(p.images || []);
    const tags = (p.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    const prev = existingById.get(String(p.id));
    const row = {
      shopify_product_id: String(p.id),
      title: p.title ?? '(未命名)',
      body_html: stripEditorArtifactHtml(p.body_html ?? null),
      vendor: p.vendor ?? null,
      product_type: p.product_type ?? null,
      handle: prev?.shopify_url?.trim() || p.handle || null,
      shopify_url: prev?.shopify_url?.trim() || p.handle || null,
      status: p.status ?? 'active',
      published_at: p.published_at ?? null,
      image_url: images[0]?.src ?? null,
      images: images.length > 0
        ? images.map((im, i) => ({
          id: im.id, src: im.src, alt: im.alt || '', width: im.width, height: im.height, position: i + 1,
        }))
        : null,
      variants: variants.length > 0 ? variants : null,
      tags,
      price: minPrice,
      compare_at_price: compareAt,
      shopify_created_at: p.created_at ?? null,
      shopify_updated_at: p.updated_at ?? null,
      imported_at: nowIso,
      shop_domain: shopDomain,
      id: prev?.id ?? null,
      source_product_id: prev?.source_product_id ?? null,
    };
    return row;
  });

  let upserted = 0;
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(`${FURNITURE}/rest/v1/shopify_products?on_conflict=shopify_product_id`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`upsert chunk ${i}: ${res.status} ${await res.text()}`);
    upserted += chunk.length;
    process.stdout.write(`\rUpserted ${upserted}/${rows.length}...`);
  }
  console.log('\nDone:', { live: live.length, upserted });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

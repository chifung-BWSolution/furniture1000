#!/usr/bin/env node
/**
 * Pull one live Shopify product into shopify_products mirror.
 * Preserves id, source_product_id, shopify_url, and metafield columns.
 *
 * Usage:
 *   SHOPIFY_PRODUCT_ID=8753210261703 node scripts/sync-single-shopify-product.mjs
 *
 * Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Shopify creds from shopify_connections table (or SHOPIFY_ACCESS_TOKEN + SHOPIFY_STORE_URL).
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOPIFY_PRODUCT_ID = process.env.SHOPIFY_PRODUCT_ID;

function stripEditorArtifactHtml(html) {
  if (!html) return html;
  let out = html;
  out = out.replace(/\s+style="[^"]*--tw-[^"]*"/gi, '');
  out = out.replace(/\s+style='[^']*--tw-[^']*'/gi, '');
  out = out.replace(/\s+class="[^"]*\btw-[^\s"]+[^"]*"/gi, (match) => {
    const cleaned = match
      .replace(/class="/i, '')
      .replace(/"$/, '')
      .split(/\s+/)
      .filter((c) => c && !c.startsWith('tw-'))
      .join(' ');
    return cleaned ? ` class="${cleaned}"` : '';
  });
  out = out.replace(/<span>([^<]*)<\/span>/gi, '$1');
  out = out.replace(/<br\s*\/?>/gi, '<br>');
  return out;
}

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}
if (!SHOPIFY_PRODUCT_ID) {
  console.error('SHOPIFY_PRODUCT_ID required');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path, opts = {}) {
  const res = await fetch(`${FURNITURE}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function getShopifyCreds() {
  const rows = await rest(
    'shopify_connections?is_active=eq.true&order=connected_at.desc&limit=1&select=shop_domain,access_token',
  );
  const conn = rows?.[0];
  const shopDomain = (conn?.shop_domain || process.env.SHOPIFY_STORE_URL || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const token = conn?.access_token || process.env.SHOPIFY_ACCESS_TOKEN || '';
  if (!shopDomain || !token) throw new Error('Shopify credentials not found');
  return { shopDomain, token };
}

async function fetchShopifyProduct(shopDomain, token, productId) {
  const url = `https://${shopDomain}/admin/api/2024-10/products/${productId}.json?fields=id,title,body_html,vendor,product_type,handle,status,published_at,images,variants,tags,created_at,updated_at`;
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).product;
}

async function main() {
  const { shopDomain, token } = await getShopifyCreds();
  console.log(`Fetching Shopify product ${SHOPIFY_PRODUCT_ID} from ${shopDomain}...`);

  const p = await fetchShopifyProduct(shopDomain, token, SHOPIFY_PRODUCT_ID);
  const images = p.images ?? [];
  const variants = p.variants ?? [];
  const prices = variants.map((v) => parseFloat(v.price ?? '0') || 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const compareAt = variants.length && variants[0].compare_at_price
    ? parseFloat(variants[0].compare_at_price) || null
    : null;
  const tags = (p.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

  const existingRows = await rest(
    `shopify_products?shopify_product_id=eq.${SHOPIFY_PRODUCT_ID}&select=id,source_product_id,shopify_url,shopify_page_title,shopify_page_description`,
  );
  const prev = existingRows?.[0];

  const patch = {
    shopify_product_id: String(p.id),
    title: p.title ?? '(未命名)',
    body_html: stripEditorArtifactHtml(p.body_html ?? null) || null,
    vendor: p.vendor ?? null,
    product_type: p.product_type ?? null,
    handle: prev?.shopify_url?.trim() || p.handle || null,
    shopify_url: prev?.shopify_url?.trim() || p.handle || null,
    status: p.status ?? 'active',
    published_at: p.published_at ?? null,
    image_url: images[0]?.src ?? null,
    images: images.length > 0
      ? images.map((im) => ({
        id: im.id,
        src: im.src,
        alt: im.alt || '',
        width: im.width,
        height: im.height,
        position: im.position,
      }))
      : null,
    variants: variants.length > 0 ? variants : null,
    tags,
    price: minPrice,
    compare_at_price: compareAt,
    shopify_created_at: p.created_at ?? null,
    shopify_updated_at: p.updated_at ?? null,
    imported_at: new Date().toISOString(),
    shop_domain: shopDomain,
  };

  if (prev?.id) patch.id = prev.id;
  if (prev?.source_product_id) patch.source_product_id = prev.source_product_id;
  if (prev?.shopify_page_title) patch.shopify_page_title = prev.shopify_page_title;
  if (prev?.shopify_page_description) patch.shopify_page_description = prev.shopify_page_description;

  const res = await fetch(`${FURNITURE}/rest/v1/shopify_products?on_conflict=shopify_product_id`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(patch),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(`upsert failed: ${res.status} ${JSON.stringify(result)}`);

  console.log('Synced:', {
    shopify_product_id: SHOPIFY_PRODUCT_ID,
    title: patch.title,
    image_count: images.length,
    body_html_length: (patch.body_html || '').length,
    source_product_id: patch.source_product_id ?? prev?.source_product_id ?? null,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

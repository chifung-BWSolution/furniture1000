#!/usr/bin/env node
/**
 * Recover lost lifestyle primary images on Shopify + shopify_products mirror.
 *
 * Pattern: products.image_url has _primary_ (lifestyle scene) but Shopify/mirror
 * only has dialog_file / _extra_ white-background shots because publish skipped
 * the RTS image_url when images[] was populated.
 *
 * Source: products.image_url (canonical primary from copywriting sync).
 * Does NOT use image_url_2 / image_url_3.
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const ONLY_SHOPIFY_ID = process.env.SHOPIFY_PRODUCT_ID || null;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

function stem(url) {
  return (url || '').split('?')[0].split('/').pop()?.toLowerCase() || '';
}

function isLifestylePrimary(url) {
  const s = stem(url);
  return s.includes('_primary_') || s.includes('whatsapp') || (s.includes('dialog_file') && !s.includes('_extra'));
}

function isWhiteBgPrimary(url) {
  const s = stem(url);
  return s.includes('dialog_file') || s.includes('_extra');
}

async function rest(path, opts = {}) {
  const res = await fetch(`${FURNITURE}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function getShopifyCreds() {
  const conn = await rest('shopify_connections?is_active=eq.true&order=connected_at.desc&limit=1&select=shop_domain,access_token');
  const shopDomain = (conn[0]?.shop_domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const token = conn[0]?.access_token || '';
  if (!shopDomain || !token) throw new Error('Shopify credentials not found');
  return { shopDomain, token, apiBase: `https://${shopDomain}/admin/api/2024-10` };
}

async function recoverOne(apiBase, token, row, prodPrimary) {
  const shopifyId = row.shopify_product_id;
  const sh = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
  const prodStem = stem(prodPrimary);

  const prodRes = await fetch(`${apiBase}/products/${shopifyId}.json?fields=id,images`, { headers: sh });
  const prodJson = await prodRes.json();
  if (!prodRes.ok) throw new Error(`fetch product ${shopifyId}: ${prodRes.status}`);

  let images = [...(prodJson.product?.images || [])].sort((a, b) => a.position - b.position);
  let primaryImg = images.find((im) => stem(im.src).includes(prodStem.replace(/\.[a-z]+$/, '').split('_primary_')[0] + '_primary_')
    || stem(im.src) === prodStem
    || (prodStem.includes('_primary_') && stem(im.src).includes('_primary_') && stem(im.src).split('_primary_')[0] === prodStem.split('_primary_')[0]));

  if (!primaryImg) {
    const postRes = await fetch(`${apiBase}/products/${shopifyId}/images.json`, {
      method: 'POST',
      headers: sh,
      body: JSON.stringify({ image: { src: prodPrimary } }),
    });
    const postBody = await postRes.json();
    if (!postRes.ok) throw new Error(`upload image ${shopifyId}: ${postRes.status} ${JSON.stringify(postBody)}`);
    primaryImg = postBody.image;
    const refresh = await fetch(`${apiBase}/products/${shopifyId}.json?fields=images`, { headers: sh }).then((r) => r.json());
    images = [...(refresh.product?.images || [])];
  }

  const primaryId = primaryImg.id;
  const others = images.filter((im) => im.id !== primaryId).sort((a, b) => a.position - b.position);
  const ordered = [primaryImg, ...others];

  const putRes = await fetch(`${apiBase}/products/${shopifyId}.json`, {
    method: 'PUT',
    headers: sh,
    body: JSON.stringify({
      product: {
        id: Number(shopifyId),
        images: ordered.map((im, i) => ({ id: im.id, position: i + 1 })),
      },
    }),
  });
  const putBody = await putRes.json();
  if (!putRes.ok) throw new Error(`reorder ${shopifyId}: ${putRes.status}`);

  const final = (putBody.product?.images || []).sort((a, b) => a.position - b.position);
  const mirrorImages = final.map((im) => ({
    id: im.id,
    src: im.src,
    alt: im.alt || '',
    width: im.width,
    height: im.height,
    position: im.position,
  }));

  const patch = {
    image_url: final[0]?.src || null,
    images: mirrorImages,
    imported_at: new Date().toISOString(),
  };
  const title = row.title || '';
  for (let i = 0; i < 4; i++) {
    patch[`custom.more_image_link_${i + 1}`] = final[i]?.src || null;
    patch[`custom.more_image_alt_${i + 1}`] = final[i]?.src && title ? title : null;
  }

  const patchRes = await fetch(`${FURNITURE}/rest/v1/shopify_products?shopify_product_id=eq.${shopifyId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) throw new Error(`mirror patch ${shopifyId}: ${patchRes.status} ${await patchRes.text()}`);

  return { shopifyId, title, primary: stem(final[0]?.src), imageCount: final.length };
}

async function main() {
  const { apiBase, token } = await getShopifyCreds();
  let mirrorRows = await rest(
    'shopify_products?configurable=is.null&status=eq.active&select=shopify_product_id,title,image_url,source_product_id',
  );
  if (ONLY_SHOPIFY_ID) {
    mirrorRows = mirrorRows.filter((r) => String(r.shopify_product_id) === ONLY_SHOPIFY_ID);
  }

  const targets = [];
  for (const row of mirrorRows) {
    if (!row.source_product_id || !/^\d+$/.test(String(row.shopify_product_id))) continue;
    const prods = await rest(`products?id=eq.${row.source_product_id}&select=image_url`);
    const prodPrimary = prods[0]?.image_url || '';
    if (!prodPrimary.startsWith('http') || !isLifestylePrimary(prodPrimary)) continue;
    if (!isWhiteBgPrimary(row.image_url) && stem(row.image_url) === stem(prodPrimary)) continue;
    const prodBase = prodPrimary.split('_primary_')[0];
    const mirrorSrc = row.image_url || '';
    if (mirrorSrc.includes(prodBase) && mirrorSrc.includes('_primary_')) continue;
    targets.push({ row, prodPrimary });
  }

  console.log(`Recovering lifestyle primary for ${targets.length} product(s)...`);
  const report = { ok: [], fail: [] };

  for (let i = 0; i < targets.length; i++) {
    const { row, prodPrimary } = targets[i];
    try {
      const result = await recoverOne(apiBase, token, row, prodPrimary);
      report.ok.push(result);
      console.log(`[${i + 1}/${targets.length}] OK ${result.title?.slice(0, 40)} → ${result.primary?.slice(0, 35)}`);
    } catch (err) {
      report.fail.push({ shopify_product_id: row.shopify_product_id, title: row.title, error: String(err.message || err) });
      console.error(`[${i + 1}/${targets.length}] FAIL ${row.title?.slice(0, 40)}: ${err.message || err}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('\nDONE', { ok: report.ok.length, fail: report.fail.length });
  if (report.fail.length) console.log(JSON.stringify(report.fail, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

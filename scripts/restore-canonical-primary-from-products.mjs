#!/usr/bin/env node
/**
 * Restore Shopify + shopify_products gallery order using products.image_url as canonical primary.
 *
 * Reverses the mistaken batch reorder that moved dialog_file ahead of _primary_ for most products.
 * products.image_url (_primary_) is the copywriting primary slot and should be position 1.
 *
 * Exceptions (lifestyle lives in extras, not image_url): 3 known products only.
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';

/** Lifestyle scene is in gallery extras, not products.image_url (_primary_ white-bg). */
const LIFESTYLE_IN_EXTRAS_IDS = new Set([
  '8742663946439', // 現代淺木色拼灰色一櫃桶一門密碼鎖帶轆活動櫃
  '8751613903047', // 現代商務L形帶側櫃辦公枱
  '8753210261703', // 幾何設計商務會議桌
]);

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

function stem(url) {
  return (url || '').split('?')[0].split('/').pop()?.toLowerCase() || '';
}

function fileKey(url) {
  return stem(url).replace(/\.(jpg|jpeg|png|webp|gif)$/i, '');
}

function sortImages(images) {
  return [...images].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

function findByFileKey(sorted, canonicalUrl) {
  const key = fileKey(canonicalUrl);
  if (!key) return null;
  return (
    sorted.find((im) => fileKey(im.src) === key)
    || sorted.find((im) => stem(im.src).includes(key))
    || sorted.find((im) => key.includes(fileKey(im.src).split('_').slice(0, 3).join('_')))
  );
}

function pickLifestyleInExtras(sorted) {
  const whatsapp = sorted.find((im) => /whatsapp/i.test(im.src || ''));
  if (whatsapp) return whatsapp;
  const imgScene = sorted.find((im) => /_img_/i.test(stem(im.src)));
  if (imgScene) return imgScene;
  const dialog = sorted.find((im) => stem(im.src).includes('dialog_file'));
  if (dialog) return dialog;
  return sorted[0] || null;
}

function reorderGallery(sorted, preferred) {
  if (!preferred?.src) return sorted;
  const pk = fileKey(preferred.src);
  const rest = sorted.filter((im) => fileKey(im.src) !== pk);
  return [preferred, ...rest];
}

function needsReorder(sorted, preferred) {
  if (!preferred?.src || !sorted[0]?.src) return false;
  return fileKey(preferred.src) !== fileKey(sorted[0].src);
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

async function reorderOnShopify(apiBase, token, shopifyId, ordered) {
  const sh = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
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
  if (!putRes.ok) throw new Error(`reorder ${shopifyId}: ${putRes.status} ${JSON.stringify(putBody)}`);
  return sortImages(putBody.product?.images || []);
}

async function patchMirror(sid, final, title) {
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
  for (let j = 0; j < 4; j++) {
    patch[`custom.more_image_link_${j + 1}`] = final[j]?.src || null;
    patch[`custom.more_image_alt_${j + 1}`] = final[j]?.src && title ? title : null;
  }
  await fetch(`${FURNITURE}/rest/v1/shopify_products?shopify_product_id=eq.${sid}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

async function main() {
  const { apiBase, token } = await getShopifyCreds();
  const rows = await rest(
    'shopify_products?configurable=is.null&status=eq.active&select=shopify_product_id,title,image_url,images,source_product_id',
  );

  const productIds = [...new Set(rows.map((r) => r.source_product_id).filter(Boolean))];
  const productMap = new Map();
  const CHUNK = 80;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const chunk = productIds.slice(i, i + CHUNK);
    const q = chunk.map((id) => `id.eq.${id}`).join(',');
    const prods = await rest(`products?or=(${q})&select=id,image_url`);
    for (const p of prods) productMap.set(p.id, p.image_url || '');
  }

  const targets = [];
  for (const row of rows) {
    if (!/^\d+$/.test(String(row.shopify_product_id))) continue;
    const sorted = sortImages(row.images || []);
    if (sorted.length < 2) continue;

    const sid = String(row.shopify_product_id);
    let preferred;
    if (LIFESTYLE_IN_EXTRAS_IDS.has(sid)) {
      preferred = pickLifestyleInExtras(sorted);
    } else {
      const canonical = productMap.get(row.source_product_id) || '';
      preferred = findByFileKey(sorted, canonical) || sorted[0];
    }
    if (needsReorder(sorted, preferred)) targets.push({ row, preferred, canonical: productMap.get(row.source_product_id) });
  }

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Restoring canonical primary for ${targets.length} product(s)...`);

  const report = { ok: [], fail: [], skip: 0 };
  for (let i = 0; i < targets.length; i++) {
    const { row, preferred } = targets[i];
    const sid = row.shopify_product_id;
    try {
      const sh = { 'X-Shopify-Access-Token': token };
      const live = await fetch(`${apiBase}/products/${sid}.json?fields=id,images`, { headers: sh }).then((r) => r.json());
      const sorted = sortImages(live.product?.images || row.images || []);
      const ordered = reorderGallery(sorted, preferred);
      const newPrimary = stem(ordered[0]?.src).slice(0, 45);

      if (DRY_RUN) {
        console.log(`[${i + 1}/${targets.length}] WOULD ${row.title?.slice(0, 38)} → ${newPrimary}`);
        report.ok.push({ shopify_product_id: sid, title: row.title, newPrimary });
        continue;
      }

      const final = await reorderOnShopify(apiBase, token, sid, ordered);
      await patchMirror(sid, final, row.title || '');
      report.ok.push({ shopify_product_id: sid, title: row.title?.slice(0, 50), newPrimary });
      console.log(`[${i + 1}/${targets.length}] OK ${row.title?.slice(0, 38)} → ${newPrimary}`);
    } catch (err) {
      report.fail.push({ shopify_product_id: sid, title: row.title, error: String(err.message || err) });
      console.error(`[${i + 1}/${targets.length}] FAIL ${row.title?.slice(0, 38)}: ${err.message || err}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log('\nDONE', { ok: report.ok.length, fail: report.fail.length });
  if (report.fail.length) console.log(JSON.stringify(report.fail, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

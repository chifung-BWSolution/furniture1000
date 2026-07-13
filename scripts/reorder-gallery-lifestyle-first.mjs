#!/usr/bin/env node
/**
 * Reorder Shopify + shopify_products gallery: lifestyle scene first, white-bg catalog second.
 *
 * Detects when position 1 is a white-bg _primary_ catalog shot but a lifestyle image
 * (WhatsApp / dialog_file office render / _img_ scene) exists later in the gallery.
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ONLY_IDS = process.env.SHOPIFY_PRODUCT_IDS
  ? process.env.SHOPIFY_PRODUCT_IDS.split(',').map((s) => s.trim())
  : null;

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

function sortImages(images) {
  return [...images].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

/** Pick lifestyle primary when _primary_ at pos 1 is a white-bg catalog shot. */
function pickPreferredPrimary(sorted) {
  if (sorted.length === 0) return null;

  const whatsapp = sorted.find((im) => /whatsapp/i.test(im.src || ''));
  if (whatsapp) return whatsapp;

  const first = sorted[0];
  const firstIsPrimary = stem(first?.src).includes('_primary_');
  if (!firstIsPrimary) return first;

  const dialogFiles = sorted.filter((im) => stem(im.src).includes('dialog_file'));
  if (dialogFiles.length > 0) return dialogFiles[0];

  const imgScenes = sorted.filter((im) => /_img_/i.test(stem(im.src)));
  if (imgScenes.length > 0) return imgScenes[0];

  return first;
}

function needsReorder(sorted) {
  const preferred = pickPreferredPrimary(sorted);
  if (!preferred?.src || !sorted[0]?.src) return false;
  return stem(preferred.src) !== stem(sorted[0].src);
}

function reorderGallery(sorted) {
  const preferred = pickPreferredPrimary(sorted);
  if (!preferred) return sorted;
  const rest = sorted.filter((im) => im.id !== preferred.id && stem(im.src) !== stem(preferred.src));
  return [preferred, ...rest];
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

async function main() {
  const { apiBase, token } = await getShopifyCreds();
  let rows = await rest(
    'shopify_products?configurable=is.null&status=eq.active&select=shopify_product_id,title,image_url,images',
  );
  if (ONLY_IDS?.length) {
    rows = rows.filter((r) => ONLY_IDS.includes(String(r.shopify_product_id)));
  }

  const targets = rows.filter((r) => {
    if (!/^\d+$/.test(String(r.shopify_product_id))) return false;
    const sorted = sortImages(r.images || []);
    return sorted.length >= 2 && needsReorder(sorted);
  });

  console.log(`Reordering ${targets.length} product(s)...`);
  const report = { ok: [], fail: [], skipped: 0 };

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const sid = row.shopify_product_id;
    try {
      const sh = { 'X-Shopify-Access-Token': token };
      const live = await fetch(`${apiBase}/products/${sid}.json?fields=id,images`, { headers: sh }).then((r) => r.json());
      const sorted = sortImages(live.product?.images || row.images || []);
      const ordered = reorderGallery(sorted);
      const final = await reorderOnShopify(apiBase, token, sid, ordered);

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
      for (let j = 0; j < 4; j++) {
        patch[`custom.more_image_link_${j + 1}`] = final[j]?.src || null;
        patch[`custom.more_image_alt_${j + 1}`] = final[j]?.src && title ? title : null;
      }

      await fetch(`${FURNITURE}/rest/v1/shopify_products?shopify_product_id=eq.${sid}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });

      report.ok.push({
        shopify_product_id: sid,
        title: row.title?.slice(0, 50),
        newPrimary: stem(final[0]?.src).slice(0, 40),
      });
      console.log(`[${i + 1}/${targets.length}] OK ${row.title?.slice(0, 42)} → ${stem(final[0]?.src).slice(0, 35)}`);
    } catch (err) {
      report.fail.push({ shopify_product_id: sid, title: row.title, error: String(err.message || err) });
      console.error(`[${i + 1}/${targets.length}] FAIL ${row.title?.slice(0, 42)}: ${err.message || err}`);
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

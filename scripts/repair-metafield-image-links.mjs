#!/usr/bin/env node
/**
 * Repair more_image_link_* metafields:
 *  1) Patch shopify_products mirror columns from images[] CDN URLs
 *  2) Push each product to Shopify via update-shopify-product (one per request)
 *
 * Usage:
 *   node scripts/repair-metafield-image-links.mjs --dry-run
 *   node scripts/repair-metafield-image-links.mjs
 *   node scripts/repair-metafield-image-links.mjs --ids=8753175298247,8753170251975
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const onlyIds = idsArg
  ? new Set(idsArg.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

function isCdn(url) {
  return typeof url === 'string' && url.includes('cdn.shopify.com');
}

function isSupabase(url) {
  return typeof url === 'string' && url.includes('supabase.co');
}

function orderedCdnUrls(row) {
  const out = [];
  const seen = new Set();
  const add = (src) => {
    if (!isCdn(src)) return;
    const key = src.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    out.push(src);
  };
  if (Array.isArray(row.images)) {
    const sorted = [...row.images].sort(
      (a, b) => (Number(a.position) || 99) - (Number(b.position) || 99),
    );
    for (const im of sorted) add(typeof im === 'string' ? im : im?.src);
  }
  if (out.length === 0 && isCdn(row.image_url)) add(row.image_url);
  return out.slice(0, 4);
}

function needsRepair(row) {
  const links = [
    row['custom.more_image_link_1'],
    row['custom.more_image_link_2'],
    row['custom.more_image_link_3'],
    row['custom.more_image_link_4'],
  ];
  const cdnUrls = orderedCdnUrls(row);
  if (cdnUrls.length === 0) return false;
  if (links.some(isSupabase)) return true;
  const l1 = row['custom.more_image_link_1'];
  if (isCdn(row.image_url) && (!l1 || !isCdn(l1))) return true;
  for (let i = 0; i < Math.min(cdnUrls.length, 4); i++) {
    if ((links[i] || '').split('?')[0] !== cdnUrls[i].split('?')[0]) return true;
  }
  return false;
}

function patchFromGallery(row) {
  const urls = orderedCdnUrls(row);
  const title = (row.title || '').trim();
  const patch = {};
  for (let i = 1; i <= 4; i++) {
    const linkKey = `custom.more_image_link_${i}`;
    const altKey = `custom.more_image_alt_${i}`;
    const url = urls[i - 1];
    if (url) {
      patch[linkKey] = url;
      if (title) patch[altKey] = title;
      else patch[altKey] = null;
    } else {
      patch[linkKey] = null;
      patch[altKey] = null;
    }
  }
  return patch;
}

async function restGet(path) {
  const res = await fetch(`${FURNITURE}/rest/v1/${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function restPatch(shopifyId, patch) {
  const res = await fetch(
    `${FURNITURE}/rest/v1/shopify_products?shopify_product_id=eq.${shopifyId}`,
    { method: 'PATCH', headers, body: JSON.stringify(patch) },
  );
  if (!res.ok) throw new Error(`patch ${shopifyId}: ${res.status} ${await res.text()}`);
}

async function pushToShopify(shopifyId) {
  const res = await fetch(`${FURNITURE}/functions/v1/supabase-functions-update-shopify-product`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ shopify_product_ids: [shopifyId] }),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    throw new Error((data?.error || text || `HTTP ${res.status}`).slice(0, 300));
  }
  return data;
}

async function main() {
  const select = [
    'shopify_product_id', 'title', 'image_url', 'images',
    '"custom.more_image_link_1"', '"custom.more_image_link_2"',
    '"custom.more_image_link_3"', '"custom.more_image_link_4"',
    '"custom.more_image_alt_1"', '"custom.more_image_alt_2"',
    '"custom.more_image_alt_3"', '"custom.more_image_alt_4"',
  ].join(',');

  const rows = await restGet(
    `shopify_products?select=${encodeURIComponent(select)}`
    + '&status=eq.active&shopify_product_id=not.is.null&order=shopify_product_id',
  );

  let targets = rows.filter((r) => /^\d+$/.test(String(r.shopify_product_id)) && needsRepair(r));
  if (onlyIds) {
    targets = targets.filter((r) => onlyIds.has(String(r.shopify_product_id)));
  }

  console.log(`Repair targets: ${targets.length}${dryRun ? ' (dry-run)' : ''}`);

  let patched = 0;
  let pushed = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const sid = String(row.shopify_product_id);
    const patch = patchFromGallery(row);
    process.stdout.write(`[${i + 1}/${targets.length}] ${sid} ${(row.title || '').slice(0, 40)}… `);

    if (dryRun) {
      console.log('skip');
      continue;
    }

    try {
      await restPatch(sid, patch);
      patched++;
      const result = await pushToShopify(sid);
      const p = Number(result?.pushed ?? 0);
      const s = Number(result?.skipped ?? 0);
      const f = Number(result?.failed ?? 0);
      if (f > 0) {
        failed++;
        console.log(`FAIL ${result?.errors?.[0]?.error || 'push failed'}`);
      } else {
        pushed += p + s;
        console.log(`OK (pushed=${p} skipped=${s})`);
      }
    } catch (e) {
      failed++;
      console.log(`ERR ${e instanceof Error ? e.message : e}`);
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\nDone.');
  console.log(`Mirror patched: ${patched}`);
  console.log(`Shopify sync ok: ${pushed}`);
  console.log(`Failed: ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

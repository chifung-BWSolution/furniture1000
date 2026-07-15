#!/usr/bin/env node
/**
 * Bulk reclassify 已上載產品:
 *   休閑家具 / 沙發  →  Sofa 梳化 / 單人梳化
 * Tags: add 單人梳化, Sofa 梳化; remove 休閒家具, 接待家具
 *
 * Usage:
 *   node scripts/bulk-reclassify-leisure-sofa.mjs --dry-run
 *   node scripts/bulk-reclassify-leisure-sofa.mjs
 *   node scripts/bulk-reclassify-leisure-sofa.mjs --mirror-only
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const mirrorOnly = process.argv.includes('--mirror-only');

const SOURCE_PRODUCT_TYPE = '休閑家具 / 沙發';
const TARGET_PRODUCT_TYPE = 'Sofa 梳化 / 單人梳化';
const TAGS_TO_REMOVE = new Set(['休閒家具', '接待家具']);
const TAGS_TO_ADD = ['單人梳化', 'Sofa 梳化'];

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

function transformTags(tags) {
  const base = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t.trim()) : [];
  const filtered = base.filter((t) => !TAGS_TO_REMOVE.has(t.trim()));
  const out = [...filtered];
  for (const tag of TAGS_TO_ADD) {
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRows() {
  const url = `${FURNITURE}/rest/v1/shopify_products?select=shopify_product_id,title,product_type,tags&configurable=is.null&product_type=eq.${encodeURIComponent(SOURCE_PRODUCT_TYPE)}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`fetch: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function patchMirror(shopifyId, patch) {
  const res = await fetch(
    `${FURNITURE}/rest/v1/shopify_products?shopify_product_id=eq.${shopifyId}`,
    { method: 'PATCH', headers, body: JSON.stringify(patch) },
  );
  if (!res.ok) throw new Error(`patch ${shopifyId}: ${res.status} ${await res.text()}`);
}

async function pushToShopify(shopifyId) {
  for (let attempt = 0; attempt <= 4; attempt++) {
    const res = await fetch(`${FURNITURE}/functions/v1/supabase-functions-update-shopify-product`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ push_from_mirror: true, shopify_product_id: shopifyId }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (res.ok && data.failed === 0) return data;
    const err = data.error || text;
    if (/429|calls per second/i.test(err) && attempt < 4) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`push ${shopifyId}: ${err}`);
  }
}

async function main() {
  const rows = await fetchRows();
  console.log(`Found ${rows.length} products: "${SOURCE_PRODUCT_TYPE}"`);

  if (rows.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  let mirrorOk = 0;
  let pushed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sid = String(row.shopify_product_id);
    const newTags = transformTags(row.tags);
    const patch = {
      product_type: TARGET_PRODUCT_TYPE,
      tags: newTags,
    };

    console.log(`[${i + 1}/${rows.length}] ${row.title?.slice(0, 40) || sid}`);
    console.log(`  tags: ${JSON.stringify(row.tags)} → ${JSON.stringify(newTags)}`);

    if (dryRun) continue;

    try {
      await patchMirror(sid, patch);
      mirrorOk++;
      if (!mirrorOnly) {
        await sleep(750);
        const result = await pushToShopify(sid);
        if (result.pushed > 0) pushed++;
        else if (result.skipped > 0) console.log('  Shopify: skipped (already matched)');
        else pushed++;
      }
    } catch (e) {
      failed++;
      console.error(`  ERROR: ${e.message}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Mirror updated: ${dryRun ? 0 : mirrorOk}`);
  if (!mirrorOnly && !dryRun) {
    console.log(`Shopify pushed: ${pushed}, failed: ${failed}`);
  }
  if (dryRun) console.log('(dry-run — no changes written)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

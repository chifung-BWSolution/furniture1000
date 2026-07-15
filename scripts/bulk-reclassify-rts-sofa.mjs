#!/usr/bin/env node
/**
 * Reclassify 準備上載 pipeline (ready_to_shopify + products):
 *   休閑家具 / 沙發  →  Sofa 梳化 / 單人梳化
 *
 * 產品文案篩選使用 products.level1_category / level2_category（RPC），
 * 僅改 ready_to_shopify.product_type 不會出現在篩選結果中。
 *
 * Usage:
 *   node scripts/bulk-reclassify-rts-sofa.mjs --dry-run
 *   node scripts/bulk-reclassify-rts-sofa.mjs
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const SRC_TYPE = '休閑家具 / 沙發';
const DST_TYPE = 'Sofa 梳化 / 單人梳化';
const DST_L1 = 'Sofa 梳化';
const DST_L2 = '單人梳化';
const SRC_L1 = '休閑家具';
const SRC_L2 = '沙發';

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

async function restGet(path) {
  const res = await fetch(`${FURNITURE}/rest/v1/${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

async function patchIn(table, col, values, patch) {
  for (let i = 0; i < values.length; i += 50) {
    const chunk = values.slice(i, i + 50);
    const q = `(${chunk.map((v) => encodeURIComponent(v)).join(',')})`;
    const res = await fetch(`${FURNITURE}/rest/v1/${table}?${col}=in.${q}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`patch ${table}: ${res.status} ${await res.text()}`);
  }
}

async function rpcCount(level1, level2) {
  const res = await fetch(`${FURNITURE}/rest/v1/rpc/get_publish_rts_count`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_stage: 'copywriting',
      p_level1: level1,
      p_level2: level2,
      p_rejected_only: false,
    }),
  });
  return res.json();
}

async function main() {
  const rtsRows = await restGet(
    `ready_to_shopify?select=id,product_id,title,product_type&product_type=eq.${encodeURIComponent(SRC_TYPE)}`,
  );
  console.log(`ready_to_shopify "${SRC_TYPE}": ${rtsRows.length}`);

  const productIds = [...new Set(rtsRows.map((r) => r.product_id).filter(Boolean))];
  console.log(`linked products: ${productIds.length}`);

  const before = await rpcCount(DST_L1, DST_L2);
  console.log(`copywriting RPC count (${DST_L1}/${DST_L2}) before: ${before}`);

  if (dryRun) {
    console.log('(dry-run — no changes)');
    return;
  }

  if (rtsRows.length > 0) {
    const res = await fetch(
      `${FURNITURE}/rest/v1/ready_to_shopify?product_type=eq.${encodeURIComponent(SRC_TYPE)}`,
      { method: 'PATCH', headers, body: JSON.stringify({ product_type: DST_TYPE }) },
    );
    if (!res.ok) throw new Error(`rts patch: ${await res.text()}`);
    console.log(`updated ready_to_shopify.product_type → ${DST_TYPE}`);
  }

  if (productIds.length > 0) {
    await patchIn('products', 'id', productIds, {
      level1_category: DST_L1,
      level2_category: DST_L2,
    });
    console.log(`updated products.level1/level2 → ${DST_L1} / ${DST_L2}`);
  }

  const after = await rpcCount(DST_L1, DST_L2);
  console.log(`copywriting RPC count (${DST_L1}/${DST_L2}) after: ${after}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

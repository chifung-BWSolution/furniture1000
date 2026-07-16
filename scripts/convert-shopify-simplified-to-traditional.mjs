#!/usr/bin/env node
/**
 * Scan shopify_products mirror text fields for simplified Chinese,
 * convert to Hong Kong traditional, patch Supabase, push to Shopify.
 *
 * Fields: shopify_page_description, shopify_page_title, body_html, my_fields.materials
 *
 * Usage:
 *   node --experimental-strip-types scripts/convert-shopify-simplified-to-traditional.mjs --dry-run
 *   node --experimental-strip-types scripts/convert-shopify-simplified-to-traditional.mjs
 *   node --experimental-strip-types scripts/convert-shopify-simplified-to-traditional.mjs --mirror-only
 *   node --experimental-strip-types scripts/convert-shopify-simplified-to-traditional.mjs --ids=8753175298247
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY
 */
import {
  containsSimplifiedChinese,
  simplifiedToTraditional,
} from '../src/lib/chineseConverter.ts';

const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const mirrorOnly = process.argv.includes('--mirror-only');
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const onlyIds = idsArg
  ? new Set(idsArg.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const TEXT_FIELDS = [
  'shopify_page_description',
  'shopify_page_title',
  'body_html',
  'my_fields.materials',
];

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function convertField(value) {
  if (value == null) return null;
  const text = String(value);
  if (!text.trim() || !containsSimplifiedChinese(text)) return null;
  const converted = simplifiedToTraditional(text);
  return converted !== text ? converted : null;
}

function buildPatch(row) {
  const patch = {};
  for (const field of TEXT_FIELDS) {
    const converted = convertField(row[field]);
    if (converted != null) patch[field] = converted;
  }
  return patch;
}

async function restGet(path) {
  const res = await fetch(`${FURNITURE}/rest/v1/${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

async function fetchAllRows() {
  const select = [
    'shopify_product_id',
    'title',
    'shopify_page_description',
    'shopify_page_title',
    'body_html',
    '"my_fields.materials"',
  ].join(',');

  const pageSize = 500;
  let offset = 0;
  const all = [];

  while (true) {
    let path =
      `shopify_products?select=${encodeURIComponent(select)}`
      + '&configurable=is.null'
      + '&shopify_product_id=not.is.null'
      + '&order=shopify_product_id'
      + `&limit=${pageSize}&offset=${offset}`;
    if (onlyIds?.size) {
      const quoted = [...onlyIds].map((id) => `"${id}"`).join(',');
      path += `&shopify_product_id=in.(${quoted})`;
    }
    const batch = await restGet(path);
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
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
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (res.ok && Number(data?.failed ?? 0) === 0) return data;
    const err = data?.error || data?.errors?.[0]?.error || text;
    if (/429|calls per second|rate limit/i.test(String(err)) && attempt < 4) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`push ${shopifyId}: ${String(err).slice(0, 300)}`);
  }
}

async function main() {
  console.log('Fetching shopify_products mirror rows…');
  const rows = await fetchAllRows();
  const targets = rows.filter((r) => /^\d+$/.test(String(r.shopify_product_id)));
  const withPatch = targets
    .map((row) => ({ row, patch: buildPatch(row) }))
    .filter(({ patch }) => Object.keys(patch).length > 0);

  console.log(`Scanned ${targets.length} products · ${withPatch.length} need conversion${dryRun ? ' (dry-run)' : ''}`);

  if (withPatch.length === 0) {
    console.log('No simplified Chinese found in target fields.');
    return;
  }

  let mirrorOk = 0;
  let pushed = 0;
  let pushSkipped = 0;
  let failed = 0;

  for (let i = 0; i < withPatch.length; i++) {
    const { row, patch } = withPatch[i];
    const sid = String(row.shopify_product_id);
    const title = (row.title || '').slice(0, 48);
    const fields = Object.keys(patch).join(', ');

    process.stdout.write(`[${i + 1}/${withPatch.length}] ${sid} ${title}… `);
    console.log(`fields: ${fields}`);

    if (dryRun) continue;

    try {
      await patchMirror(sid, patch);
      mirrorOk++;
      if (!mirrorOnly) {
        await sleep(700);
        const result = await pushToShopify(sid);
        const p = Number(result?.pushed ?? 0);
        const s = Number(result?.skipped ?? 0);
        if (p > 0) pushed += p;
        else if (s > 0) pushSkipped += s;
        else pushed += 1;
      }
    } catch (e) {
      failed++;
      console.error(`  ERROR: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Mirror updated: ${dryRun ? 0 : mirrorOk}`);
  if (!mirrorOnly && !dryRun) {
    console.log(`Shopify pushed: ${pushed}, skipped (already matched): ${pushSkipped}, failed: ${failed}`);
  }
  if (dryRun) console.log('(dry-run — no changes written)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

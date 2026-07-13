#!/usr/bin/env node
/**
 * Repair shopify_products + Shopify live gallery for products whose primary
 * image_url was dropped during publish (extras-only images[] bug).
 */
import { writeFileSync } from 'node:fs';

const FURNITURE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = 'riaubhtruisbwdlwjzur';

function imageIdentityKey(url) {
  if (!url) return '';
  const noQuery = url.split('?')[0];
  const base = noQuery.substring(noQuery.lastIndexOf('/') + 1);
  return base.replace(/\.[a-zA-Z0-9]+$/, '').trim().toLowerCase();
}

function normalizeStem(url) {
  let stem = imageIdentityKey(url);
  stem = stem.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '');
  return stem;
}

function stemsMatch(a, b) {
  const sa = normalizeStem(a);
  const sb = normalizeStem(b);
  return !!sa && !!sb && sa === sb;
}

function buildCorrectGallery(row) {
  const ordered = [];
  const seen = new Set();
  const add = (url) => {
    if (!url || !String(url).startsWith('http')) return;
    const key = normalizeStem(url);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(url);
  };
  add(row.prod_primary);
  for (const im of row.prod_images || []) add(im?.src || im);
  add(row.image_url_2);
  add(row.image_url_3);
  return ordered;
}

function needsRepair(row) {
  const correct = buildCorrectGallery(row);
  if (correct.length === 0) return null;
  const primary = correct[0];
  const spUrls = [row.sp_image_url, ...(row.sp_images || []).map((im) => im?.src)].filter(Boolean);
  const primaryInGallery = spUrls.some((u) => stemsMatch(primary, u));
  const correctPrimaryAtPos1 = spUrls[0] && stemsMatch(primary, spUrls[0]);
  if (primaryInGallery && correctPrimaryAtPos1) return null;
  return { correct, title: row.title, shopify_product_id: row.shopify_product_id };
}

async function runQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function patchMirror(shopifyProductId, gallery, title) {
  const imagesJson = gallery.map((src, i) => ({ src, position: i + 1 }));
  const patch = {
    image_url: gallery[0] || null,
    images: imagesJson,
  };
  for (let i = 0; i < 4; i++) {
    patch[`custom.more_image_link_${i + 1}`] = gallery[i] || null;
    patch[`custom.more_image_alt_${i + 1}`] = gallery[i] && title ? title : null;
  }

  const res = await fetch(`${FURNITURE}/rest/v1/shopify_products?shopify_product_id=eq.${shopifyProductId}`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mirror PATCH ${shopifyProductId}: ${res.status} ${text}`);
  }
}

async function pushBatch(ids) {
  const res = await fetch(`${FURNITURE}/functions/v1/update-shopify-product`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ shopify_product_ids: ids }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || `push failed ${res.status}`);
  }
  return payload;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('Fetching candidate products...');
  const rows = await runQuery(`
    SELECT
      sp.shopify_product_id,
      sp.title,
      sp.image_url AS sp_image_url,
      sp.images AS sp_images,
      p.image_url AS prod_primary,
      p.images AS prod_images,
      p.image_url_2,
      p.image_url_3
    FROM shopify_products sp
    JOIN products p ON p.id = sp.source_product_id
    WHERE sp.source_product_id IS NOT NULL
      AND p.image_url IS NOT NULL
      AND p.image_url LIKE 'http%'
      AND COALESCE(sp.imported_at, sp.published_at) >= '2026-07-06'
    ORDER BY COALESCE(sp.imported_at, sp.published_at) DESC
  `);

  const targets = [];
  for (const row of rows || []) {
    const repair = needsRepair(row);
    if (repair) targets.push(repair);
  }

  console.log(`Need repair: ${targets.length}`);
  const report = { startedAt: new Date().toISOString(), total: targets.length, mirrorOk: 0, mirrorFail: [], pushBatches: [], pushFail: [] };

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      await patchMirror(t.shopify_product_id, t.correct, t.title);
      report.mirrorOk++;
      if ((i + 1) % 25 === 0) console.log(`Mirror updated ${i + 1}/${targets.length}`);
    } catch (err) {
      report.mirrorFail.push({ shopify_product_id: t.shopify_product_id, error: String(err.message || err) });
    }
  }

  report.finishedAt = new Date().toISOString();
  writeFileSync('/tmp/repair-primary-images-report.json', JSON.stringify(report, null, 2));
  console.log('DONE (mirror only — Shopify push skipped)', JSON.stringify({
    total: report.total,
    mirrorOk: report.mirrorOk,
    mirrorFail: report.mirrorFail.length,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

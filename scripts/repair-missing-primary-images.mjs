#!/usr/bin/env node
/**
 * Repair shopify_products mirror gallery using ready_to_shopify as primary source.
 *
 * Gallery rules (same as src/lib/rtsImages.ts parseRtsGalleryUrls):
 *   - ready_to_shopify.image_url = primary
 *   - ready_to_shopify.images[] = extras only (no primary duplicate)
 *   - Fallback to products.* when RTS row was deleted after publish
 *
 * Mirror only — does NOT push to Shopify.
 */
import { writeFileSync } from 'node:fs';

const FURNITURE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = 'riaubhtruisbwdlwjzur';

function normalizeImagesField(images) {
  if (Array.isArray(images)) return images;
  if (typeof images === 'string' && images.trim()) {
    try {
      const parsed = JSON.parse(images);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** ready_to_shopify gallery: image_url primary, then images[] extras. */
function buildGalleryFromRow(row) {
  const urls = [];
  const seen = new Set();
  const add = (src) => {
    const s = (src || '').trim();
    if (!s || !s.startsWith('http') || seen.has(s)) return;
    seen.add(s);
    urls.push(s);
  };

  add(row.image_url);
  for (const img of normalizeImagesField(row.images)) {
    if (typeof img === 'string') add(img);
    else if (img && typeof img === 'object') {
      add(typeof img.src === 'string' ? img.src : typeof img.url === 'string' ? img.url : null);
    }
  }
  return urls;
}

function normalizeStem(url) {
  if (!url) return '';
  const noQuery = url.split('?')[0];
  const base = noQuery.substring(noQuery.lastIndexOf('/') + 1);
  let stem = base.replace(/\.[a-zA-Z0-9]+$/, '').trim().toLowerCase();
  stem = stem.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '');
  return stem;
}

function galleriesMatch(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (normalizeStem(a[i]) !== normalizeStem(b[i])) return false;
  }
  return true;
}

function pickImageSource(row) {
  if (row.rts_primary || (row.rts_images && row.rts_images.length > 0)) {
    return {
      source: 'ready_to_shopify',
      image_url: row.rts_primary,
      images: row.rts_images,
    };
  }
  return {
    source: 'products',
    image_url: row.prod_primary,
    images: row.prod_images,
  };
}

function needsRepair(row) {
  const src = pickImageSource(row);
  const correct = buildGalleryFromRow(src);
  if (correct.length === 0) return null;

  const current = buildGalleryFromRow({
    image_url: row.sp_primary,
    images: row.sp_images,
  });

  if (galleriesMatch(correct, current)) return null;

  return {
    shopify_product_id: row.shopify_product_id,
    title: row.title,
    correct,
    source: src.source,
  };
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

async function main() {
  console.log('Fetching candidate products (RTS-first gallery logic)...');
  const rows = await runQuery(`
    SELECT
      sp.shopify_product_id,
      sp.title,
      sp.image_url AS sp_primary,
      sp.images AS sp_images,
      rts.image_url AS rts_primary,
      rts.images AS rts_images,
      p.image_url AS prod_primary,
      p.images AS prod_images
    FROM shopify_products sp
    JOIN products p ON p.id = sp.source_product_id
    LEFT JOIN ready_to_shopify rts ON rts.product_id = sp.source_product_id
    WHERE sp.source_product_id IS NOT NULL
      AND COALESCE(sp.imported_at, sp.published_at) >= '2026-07-06'
    ORDER BY COALESCE(sp.imported_at, sp.published_at) DESC
  `);

  const targets = [];
  const sourceStats = { ready_to_shopify: 0, products: 0 };
  for (const row of rows || []) {
    const repair = needsRepair(row);
    if (!repair) continue;
    targets.push(repair);
    sourceStats[repair.source]++;
  }

  console.log(`Need repair: ${targets.length}`);
  console.log('Source breakdown:', sourceStats);

  const report = {
    startedAt: new Date().toISOString(),
    total: targets.length,
    sourceStats,
    mirrorOk: 0,
    mirrorFail: [],
  };

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      await patchMirror(t.shopify_product_id, t.correct, t.title);
      report.mirrorOk++;
      if ((i + 1) % 25 === 0) console.log(`Mirror updated ${i + 1}/${targets.length}`);
    } catch (err) {
      report.mirrorFail.push({
        shopify_product_id: t.shopify_product_id,
        error: String(err.message || err),
      });
    }
  }

  report.finishedAt = new Date().toISOString();
  writeFileSync('/tmp/repair-primary-images-report.json', JSON.stringify(report, null, 2));
  console.log('DONE (mirror only — Shopify push skipped)', JSON.stringify({
    total: report.total,
    mirrorOk: report.mirrorOk,
    mirrorFail: report.mirrorFail.length,
    sourceStats: report.sourceStats,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

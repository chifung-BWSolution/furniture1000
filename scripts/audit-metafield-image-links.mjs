#!/usr/bin/env node
/**
 * Audit shopify_products rows for broken image metafields.
 *
 * Issues detected:
 *  A) more_image_link_* or my_fields.image_link contains supabase.co (non-Shopify CDN)
 *  B) image_url is Shopify CDN but more_image_link_1 missing or not CDN (mirror drift)
 *
 * Usage:
 *   node scripts/audit-metafield-image-links.mjs
 *   node scripts/audit-metafield-image-links.mjs --json
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN;

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN required');
  process.exit(1);
}

const jsonOut = process.argv.includes('--json');

function isCdn(url) {
  return typeof url === 'string' && url.includes('cdn.shopify.com');
}

function isSupabase(url) {
  return typeof url === 'string' && url.includes('supabase.co');
}

function galleryFromImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((im) => (typeof im === 'string' ? im : im?.src))
    .filter((src) => typeof src === 'string' && src.startsWith('http'));
}

function classify(row) {
  const links = [
    row['custom.more_image_link_1'],
    row['custom.more_image_link_2'],
    row['custom.more_image_link_3'],
    row['custom.more_image_link_4'],
    row['my_fields.image_link'],
  ].filter(Boolean);

  const hasSupabaseMetafield = links.some(isSupabase);
  const gallery = galleryFromImages(row.images);
  const cdnGallery = gallery.filter(isCdn);
  const primaryCdn = isCdn(row.image_url);
  const l1 = row['custom.more_image_link_1'];
  const l1Mismatch = primaryCdn && (!l1 || !isCdn(l1));

  const issues = [];
  if (hasSupabaseMetafield) issues.push('supabase_metafield_url');
  if (l1Mismatch) issues.push('primary_metafield_mismatch');
  if (cdnGallery.length > 0 && hasSupabaseMetafield) issues.push('fixable_from_mirror_images');

  return {
    shopify_product_id: row.shopify_product_id,
    title: row.title,
    issues,
    fixable: cdnGallery.length > 0 && (hasSupabaseMetafield || l1Mismatch),
    cdn_image_count: cdnGallery.length,
  };
}

async function fetchAllProducts() {
  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
  };
  const select = [
    'shopify_product_id', 'title', 'status', 'image_url', 'images',
    '"custom.more_image_link_1"', '"custom.more_image_link_2"',
    '"custom.more_image_link_3"', '"custom.more_image_link_4"',
    '"my_fields.image_link"',
  ].join(',');

  const rows = [];
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const url = `${FURNITURE}/rest/v1/shopify_products?select=${encodeURIComponent(select)}`
      + `&shopify_product_id=not.is.null&status=eq.active`
      + `&order=shopify_product_id&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`fetch failed ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch.filter((r) => /^\d+$/.test(String(r.shopify_product_id))));
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function main() {
  const rows = await fetchAllProducts();
  const classified = rows.map(classify);
  const withIssues = classified.filter((r) => r.issues.length > 0);
  const fixable = classified.filter((r) => r.fixable);
  const supabaseOnly = classified.filter((r) => r.issues.includes('supabase_metafield_url'));
  const mismatch = classified.filter((r) => r.issues.includes('primary_metafield_mismatch'));

  const report = {
    scanned_active_products: rows.length,
    products_with_issues: withIssues.length,
    supabase_url_in_metafields: supabaseOnly.length,
    primary_metafield_mismatch: mismatch.length,
    fixable_from_mirror_images: fixable.length,
    samples: withIssues.slice(0, 10).map((r) => ({
      shopify_product_id: r.shopify_product_id,
      title: r.title,
      issues: r.issues,
    })),
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('=== Metafield image audit (shopify_products mirror) ===');
  console.log(`Active products scanned: ${report.scanned_active_products}`);
  console.log(`Products with image metafield issues: ${report.products_with_issues}`);
  console.log(`  - Supabase URL in more_image/image_link: ${report.supabase_url_in_metafields}`);
  console.log(`  - Primary CDN but metafield mismatch: ${report.primary_metafield_mismatch}`);
  console.log(`Fixable using mirror images[] (CDN): ${report.fixable_from_mirror_images}`);
  if (report.samples.length) {
    console.log('\nSample affected products:');
    for (const s of report.samples) {
      console.log(`  ${s.shopify_product_id}  ${s.issues.join(', ')}  ${(s.title || '').slice(0, 50)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

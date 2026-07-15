#!/usr/bin/env node
/**
 * Remove content-duplicate Shopify gallery images (same binary MD5).
 * Common pattern in 單人梳化: only 3 unique shots, but 4th media = copy of 2nd
 * (extra0 duplicated as img0 during restore/publish).
 *
 * Usage:
 *   node scripts/dedupe-content-duplicate-shopify-images.mjs --dry-run
 *   node scripts/dedupe-content-duplicate-shopify-images.mjs
 *   node scripts/dedupe-content-duplicate-shopify-images.mjs --category=單人梳化
 *   node scripts/dedupe-content-duplicate-shopify-images.mjs --ids=8743221625031,8743221133511
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.FURNITURE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const catArg = process.argv.find((a) => a.startsWith('--category='));
const category = catArg ? catArg.slice('--category='.length) : '單人梳化';
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const onlyIds = idsArg
  ? new Set(idsArg.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

const hashCache = new Map();

async function rest(path, opts = {}) {
  const res = await fetch(`${FURNITURE}/rest/v1/${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function shopify(shop, token, path, { method = 'GET', body, retries = 8 } = {}) {
  const url = path.startsWith('http') ? path : `https://${shop}/admin/api/2024-10${path}`;
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('Retry-After') || 1.5 * (attempt + 1));
        await sleep(wait * 1000);
        continue;
      }
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      // DELETE of already-removed image → treat as success
      if (method === 'DELETE' && res.status === 404) return { ok: true, notFound: true };
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
      return json;
    } catch (e) {
      lastErr = e;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function md5Url(url) {
  if (hashCache.has(url)) return hashCache.get(url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const h = crypto.createHash('md5').update(buf).digest('hex');
    hashCache.set(url, h);
    return h;
  } catch (e) {
    const h = `ERR:${e.message || e}`;
    hashCache.set(url, h);
    return h;
  }
}

async function rewriteMoreLinks(shop, token, productId, keptUrls) {
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const url = keptUrls[i - 1] || '';
    const existingJson = await shopify(
      shop,
      token,
      `/products/${productId}/metafields.json?namespace=custom&key=more_image_link_${i}`,
    );
    const existing = (existingJson.metafields || [])[0];
    if (!url) {
      if (existing?.id) {
        await shopify(shop, token, `/metafields/${existing.id}.json`, { method: 'DELETE' });
        n++;
      }
      continue;
    }
    if (existing?.value === url) continue;
    if (existing?.id) {
      await shopify(shop, token, `/metafields/${existing.id}.json`, {
        method: 'PUT',
        body: { metafield: { id: existing.id, type: 'url', value: url } },
      });
    } else {
      await shopify(shop, token, `/products/${productId}/metafields.json`, {
        method: 'POST',
        body: {
          metafield: { namespace: 'custom', key: `more_image_link_${i}`, type: 'url', value: url },
        },
      });
    }
    n++;
  }
  return n;
}

async function main() {
  const conn = await rest(
    'shopify_connections?is_active=eq.true&order=connected_at.desc&limit=1&select=shop_domain,access_token',
  );
  const shop = (conn?.[0]?.shop_domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const token = conn?.[0]?.access_token;
  if (!shop || !token) throw new Error('Shopify credentials missing');
  console.log(`Shop=${shop} dryRun=${dryRun} category=${category || '(all)'}`);

  // Products in category (or explicit ids)
  let products = [];
  if (onlyIds) {
    for (const sid of onlyIds) {
      const rows = await rest(
        `products?shopify_product_id=eq.${sid}&select=id,title,sku,shopify_product_id,level1_category,level2_category,image_url,image_url_2,image_url_3,lifestyle_image_url,images`,
      );
      products.push(...(rows || []));
    }
  } else if (category) {
    for (let offset = 0; ; offset += 1000) {
      const chunk = await rest(
        `products?level2_category=eq.${encodeURIComponent(category)}&shopify_product_id=not.is.null&select=id,title,sku,shopify_product_id,level1_category,level2_category,image_url,image_url_2,image_url_3,lifestyle_image_url,images&order=id&limit=1000&offset=${offset}`,
      );
      products.push(...chunk);
      if (chunk.length < 1000) break;
    }
  }
  console.log(`Candidate products: ${products.length}`);

  const results = [];
  let cleaned = 0;
  let skipped = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const sid = String(p.shopify_product_id || '');
    if (!/^\d+$/.test(sid)) {
      skipped++;
      continue;
    }
    process.stdout.write(`\r[${i + 1}/${products.length}] ${sid} cleaned=${cleaned} skip=${skipped}   `);

    let live;
    try {
      live = (await shopify(shop, token, `/products/${sid}.json?fields=id,images,title`)).product;
    } catch (e) {
      results.push({ sid, status: 'missing', error: String(e.message || e) });
      skipped++;
      continue;
    }
    const imgs = [...(live.images || [])]
      .filter((im) => typeof im?.src === 'string' && im.src.startsWith('http'))
      .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99));

    if (imgs.length < 2) {
      skipped++;
      continue;
    }

    const hashes = [];
    for (const im of imgs) hashes.push(await md5Url(im.src));

    const keep = [];
    const deleteIds = [];
    const seen = new Set();
    for (let idx = 0; idx < imgs.length; idx++) {
      const h = hashes[idx];
      const key = h.startsWith('ERR') ? `path:${imgs[idx].src.split('?')[0]}` : h;
      if (seen.has(key)) {
        deleteIds.push(imgs[idx].id);
        continue;
      }
      seen.add(key);
      keep.push(imgs[idx]);
    }

    // Also detect duplicate more_image_link even if gallery already unique
    const mir = (
      await rest(
        `shopify_products?shopify_product_id=eq.${sid}&select="custom.more_image_link_1","custom.more_image_link_2","custom.more_image_link_3","custom.more_image_link_4"`,
      )
    )?.[0];
    const links = [1, 2, 3, 4]
      .map((n) => mir?.[`custom.more_image_link_${n}`])
      .filter((u) => typeof u === 'string' && u.startsWith('http'));
    const linkHashes = [];
    for (const u of links) linkHashes.push(await md5Url(u));
    const linkDup =
      linkHashes.filter((h) => !h.startsWith('ERR')).length !==
      new Set(linkHashes.filter((h) => !h.startsWith('ERR'))).size;

    if (deleteIds.length === 0 && !linkDup) {
      skipped++;
      continue;
    }

    console.log(
      `\n  DUP ${sid} sku=${p.sku || ''} ${imgs.length}→${keep.length} delete=${deleteIds.length} linkDup=${linkDup} ${String(p.title || '').slice(0, 40)}`,
    );

    if (dryRun) {
      results.push({
        sid,
        sku: p.sku,
        title: p.title,
        before: imgs.length,
        after: keep.length,
        deleteIds,
        status: 'dry-run',
      });
      cleaned++;
      continue;
    }

    let deleted = 0;
    for (const imageId of deleteIds) {
      try {
        await shopify(shop, token, `/products/${sid}/images/${imageId}.json`, { method: 'DELETE' });
        deleted++;
      } catch (e) {
        console.warn(`  delete warn ${imageId}:`, e.message || e);
      }
      await sleep(120);
    }

    let refreshed;
    try {
      refreshed = (await shopify(shop, token, `/products/${sid}.json?fields=id,images`)).product;
    } catch (e) {
      console.warn(`  refresh fail ${sid}:`, e.message || e);
      results.push({ sid, sku: p.sku, title: p.title, status: 'error', error: String(e.message || e) });
      continue;
    }
    const liveImgs = [...(refreshed.images || [])]
      .filter((im) => typeof im?.src === 'string' && im.src.startsWith('http'))
      .sort((a, b) => (Number(a.position) || 99) - (Number(b.position) || 99));

    const keptUrls = [];
    const keptRows = [];
    const seen2 = new Set();
    for (const im of liveImgs) {
      const h = await md5Url(im.src);
      const key = h.startsWith('ERR') ? `path:${im.src.split('?')[0]}` : h;
      if (seen2.has(key)) {
        try {
          await shopify(shop, token, `/products/${sid}/images/${im.id}.json`, { method: 'DELETE' });
          deleted++;
        } catch (e) {
          console.warn(`  leftover delete warn ${im.id}:`, e.message || e);
        }
        continue;
      }
      seen2.add(key);
      keptUrls.push(im.src);
      keptRows.push(im);
    }

    let mf = 0;
    try {
      mf = await rewriteMoreLinks(shop, token, sid, keptUrls.slice(0, 4));
    } catch (e) {
      console.warn(`  metafield warn ${sid}:`, e.message || e);
    }

    const imageRows = keptRows.map((im, idx) => ({
      id: im.id,
      src: im.src,
      alt: im.alt || '',
      width: im.width,
      height: im.height,
      position: idx + 1,
    }));
    try {
      await rest(`shopify_products?shopify_product_id=eq.${sid}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          image_url: keptUrls[0] || null,
          images: imageRows.length ? imageRows : null,
          'custom.more_image_link_1': keptUrls[0] || null,
          'custom.more_image_link_2': keptUrls[1] || null,
          'custom.more_image_link_3': keptUrls[2] || null,
          'custom.more_image_link_4': keptUrls[3] || null,
        }),
      });
    } catch (e) {
      console.warn(`  mirror patch warn ${sid}:`, e.message || e);
    }

    // Clean products source fields (content-unique)
    try {
      const ordered = [];
      for (const u of [p.image_url, p.image_url_2, p.image_url_3]) {
        if (typeof u === 'string' && u.startsWith('http')) ordered.push(u);
      }
      let imgsField = p.images || [];
      if (typeof imgsField === 'string') {
        try {
          imgsField = JSON.parse(imgsField);
        } catch {
          imgsField = [];
        }
      }
      const norm = [];
      for (const im of Array.isArray(imgsField) ? imgsField : []) {
        if (typeof im === 'string') norm.push([99, im]);
        else if (im?.src) norm.push([Number(im.position) || 99, im.src]);
      }
      for (const [, u] of norm.sort((a, b) => a[0] - b[0])) ordered.push(u);
      if (typeof p.lifestyle_image_url === 'string' && p.lifestyle_image_url.startsWith('http')) {
        ordered.push(p.lifestyle_image_url);
      }

      const uniq = [];
      const seenU = new Set();
      for (const u of ordered) {
        const h = await md5Url(u);
        const key = h.startsWith('ERR') ? `path:${u.split('?')[0]}` : h;
        if (seenU.has(key)) continue;
        seenU.add(key);
        uniq.push(u);
      }
      await rest(`products?id=eq.${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          image_url: uniq[0] || null,
          image_url_2: uniq[1] || null,
          image_url_3: uniq[2] || null,
          images: uniq.length > 3 ? uniq.slice(3).map((u, idx) => ({ src: u, position: idx + 1 })) : [],
        }),
      });
    } catch (e) {
      console.warn('  products clean fail', e.message || e);
    }

    results.push({
      sid,
      sku: p.sku,
      title: p.title,
      before: imgs.length,
      after: keptUrls.length,
      deleted,
      metafields: mf,
      status: 'ok',
    });
    cleaned++;
    await sleep(100);
  }

  console.log(`\nDone. cleaned=${cleaned} skipped=${skipped} dryRun=${dryRun}`);
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  fs.writeFileSync(
    '/opt/cursor/artifacts/content_dedupe_danren_sofa_report.json',
    JSON.stringify({ category, dryRun, cleaned, skipped, results }, null, 2),
  );
  console.log('Wrote /opt/cursor/artifacts/content_dedupe_danren_sofa_report.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

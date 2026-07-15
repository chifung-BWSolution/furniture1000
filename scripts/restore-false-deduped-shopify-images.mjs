#!/usr/bin/env node
/**
 * Restore Shopify galleries wrongly collapsed by over-aggressive stem dedupe
 * (`_\d+$` stripped timestamps so all *_extra_<ts> looked identical).
 *
 * Source of truth: products.image_url / image_url_2 / image_url_3 / images[]
 * For each affected product:
 *   1) Replace live Shopify media with preferred ≤4 Storage URLs
 *   2) Rewrite custom.more_image_link_1..4 to new CDN URLs
 *   3) Upsert shopify_products mirror image columns
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-false-deduped-shopify-images.mjs --dry-run
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-false-deduped-shopify-images.mjs
 *   ... --ids=8743234896071,8743710359751
 */
const FURNITURE = process.env.VITE_SUPABASE_URL || 'https://riaubhtruisbwdlwjzur.supabase.co';
const KEY = process.env.FURNITURE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

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
};

const UUID_SUFFIX =
  /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function imageIdentityKey(src) {
  const noQuery = String(src || '').split('?')[0];
  const base = noQuery.substring(noQuery.lastIndexOf('/') + 1);
  return base
    .replace(/\.[a-zA-Z0-9]+$/, '')
    .replace(UUID_SUFFIX, '')
    .replace(/_\d{1,2}$/, '')
    .trim()
    .toLowerCase();
}

function isHttp(u) {
  return typeof u === 'string' && /^https?:\/\//.test(u);
}

function dedupe(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (!isHttp(u)) continue;
    const k = imageIdentityKey(u);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

/** Preferred restore gallery: primary, image_url_2/3, then images[] by position (max 4). */
function preferredGallery(row, maxN = 4) {
  const urls = [];
  const push = (s) => {
    if (isHttp(s)) urls.push(s.trim());
  };
  push(row.image_url);
  push(row.image_url_2);
  push(row.image_url_3);
  let imgs = row.images || [];
  if (typeof imgs === 'string') {
    try {
      imgs = JSON.parse(imgs);
    } catch {
      imgs = [];
    }
  }
  const norm = [];
  for (const im of Array.isArray(imgs) ? imgs : []) {
    if (typeof im === 'string') norm.push([99, im]);
    else if (im && typeof im === 'object') {
      const src = im.src || im.url;
      if (src) norm.push([Number(im.position) || 99, src]);
    }
  }
  for (const [, src] of norm.sort((a, b) => a[0] - b[0])) push(src);
  push(row.lifestyle_image_url);
  return dedupe(urls).slice(0, maxN);
}

async function rest(path, opts = {}) {
  const res = await fetch(`${FURNITURE}/rest/v1/${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 300)}`);
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
      if (!res.ok) {
        lastErr = new Error(`${method} ${path}: ${res.status} ${text.slice(0, 240)}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw lastErr;
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return { json, link: res.headers.get('link') || '' };
    } catch (e) {
      lastErr = e;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr || new Error(`Shopify failed ${path}`);
}

async function rewriteMoreImageLinks(shop, token, productId, keptUrls) {
  let rewritten = 0;
  for (let i = 1; i <= 4; i++) {
    const url = keptUrls[i - 1] || '';
    const linkKey = `more_image_link_${i}`;
    const { json } = await shopify(
      shop,
      token,
      `/products/${productId}/metafields.json?namespace=custom&key=${linkKey}`,
    );
    const existing = (json.metafields || [])[0];
    if (!url) {
      if (existing?.id) {
        await shopify(shop, token, `/metafields/${existing.id}.json`, { method: 'DELETE' });
        rewritten++;
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
          metafield: { namespace: 'custom', key: linkKey, type: 'url', value: url },
        },
      });
    }
    rewritten++;
  }
  return rewritten;
}

async function replaceGallery(shop, token, productId, desiredUrls) {
  const { json: before } = await shopify(shop, token, `/products/${productId}.json?fields=id,images`);
  const live = [...(before.product?.images || [])].sort(
    (a, b) => (Number(a.position) || 99) - (Number(b.position) || 99),
  );

  // Delete all existing (wrongly reduced / stale CDN copies)
  for (const im of live) {
    if (im?.id == null) continue;
    await shopify(shop, token, `/products/${productId}/images/${im.id}.json`, {
      method: 'DELETE',
    });
    await sleep(120);
  }

  const kept = [];
  for (const src of desiredUrls) {
    const { json } = await shopify(shop, token, `/products/${productId}/images.json`, {
      method: 'POST',
      body: { image: { src } },
    });
    if (json.image?.src) kept.push(json.image);
    await sleep(180);
  }

  // Ensure position order
  if (kept.length > 0) {
    const payload = {
      product: {
        id: Number(productId),
        images: kept.map((im, i) => ({ id: im.id, position: i + 1 })),
      },
    };
    await shopify(shop, token, `/products/${productId}.json`, {
      method: 'PUT',
      body: payload,
    });
  }

  const { json: after } = await shopify(shop, token, `/products/${productId}.json?fields=id,images,title,handle,status,image`);
  const finalImgs = [...(after.product?.images || [])].sort(
    (a, b) => (Number(a.position) || 99) - (Number(b.position) || 99),
  );
  return finalImgs;
}

async function main() {
  const conn = await rest(
    'shopify_connections?is_active=eq.true&order=connected_at.desc&limit=1&select=shop_domain,access_token',
  );
  const shop = (conn?.[0]?.shop_domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const token = conn?.[0]?.access_token;
  if (!shop || !token) throw new Error('Shopify credentials missing');

  console.log(`Shop: ${shop} dryRun=${dryRun}`);

  // Load products with shopify ids
  const products = [];
  for (let offset = 0; ; offset += 1000) {
    const chunk = await rest(
      `products?shopify_product_id=not.is.null&select=id,title,sku,shopify_product_id,image_url,image_url_2,image_url_3,lifestyle_image_url,images&order=id&limit=1000&offset=${offset}`,
    );
    products.push(...chunk);
    if (chunk.length < 1000) break;
  }
  console.log(`products with shopify_product_id: ${products.length}`);

  // Live Shopify image counts (paginated)
  const liveById = new Map();
  let url =
    `https://${shop}/admin/api/2024-10/products.json?limit=250&fields=id,title,images,status`;
  while (url) {
    const { json, link } = await shopify(shop, token, url);
    for (const p of json.products || []) liveById.set(String(p.id), p);
    const m = (link || '').match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    process.stdout.write(`\rLive Shopify products: ${liveById.size}`);
  }
  console.log();

  // Map Storage product id prefix → live Shopify product (CDN filenames: {id}_primary_...)
  const liveByPrefix = new Map();
  for (const [sid, live] of liveById.entries()) {
    for (const im of live.images || []) {
      const src = im?.src || '';
      const base = src.split('?')[0].split('/').pop() || '';
      const m = base.match(/^([a-z0-9]+)_/i);
      if (m && !liveByPrefix.has(m[1])) liveByPrefix.set(m[1], sid);
    }
  }

  const targets = [];
  const seenSids = new Set();
  for (const p of products) {
    let sid = String(p.shopify_product_id || '');
    const viaPrefix = liveByPrefix.get(p.id);
    const currentLive = sid && liveById.get(sid);
    const currentHasPrefix = !!(currentLive?.images || []).some((im) =>
      String(im?.src || '').includes(`/${p.id}_`),
    );
    // Only remap when stored id is missing/stale, or live gallery no longer uses this product's files
    if (viaPrefix && viaPrefix !== sid && (!currentLive || !currentHasPrefix)) {
      console.log(`Remap ${p.id}: products.shopify_product_id ${sid || '(none)'} → ${viaPrefix}`);
      sid = viaPrefix;
      if (!dryRun) {
        try {
          await rest(`products?id=eq.${encodeURIComponent(p.id)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ shopify_product_id: sid }),
          });
        } catch (e) {
          console.warn('Failed to remap product id', p.id, e.message || e);
        }
      }
    }
    if (!sid || !/^\d+$/.test(sid)) continue;
    if (onlyIds && !onlyIds.has(sid)) continue;
    if (seenSids.has(sid)) continue;
    const live = liveById.get(sid);
    if (!live) continue;
    const liveN = (live.images || []).filter((im) => isHttp(im?.src)).length;
    const desired = preferredGallery(p, 4);
    const storageN = desired.filter((u) => u.includes('product-images')).length;
    // Restore when live gallery is short and catalog still has 3–4 FDP images
    if (desired.length >= 3 && liveN < desired.length && storageN >= 3) {
      seenSids.add(sid);
      targets.push({
        id: p.id,
        sid,
        sku: p.sku,
        title: p.title,
        liveN,
        desired,
      });
    }
  }

  console.log(`Restore targets: ${targets.length}`);
  for (const t of targets.slice(0, 8)) {
    console.log(
      `  ${t.sid} live=${t.liveN} → ${t.desired.length} sku=${t.sku || ''} ${String(t.title || '').slice(0, 50)}`,
    );
  }

  const results = [];
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    process.stdout.write(
      `\r[${i + 1}/${targets.length}] ${t.sid} live=${t.liveN}→${t.desired.length} ok=${ok} fail=${fail}   `,
    );
    if (dryRun) {
      results.push({ ...t, status: 'dry-run' });
      ok++;
      continue;
    }
    try {
      const finalImgs = await replaceGallery(shop, token, t.sid, t.desired);
      const cdnUrls = finalImgs.map((im) => im.src).filter(isHttp).slice(0, 4);
      await rewriteMoreImageLinks(shop, token, t.sid, cdnUrls);

      const imageRows = finalImgs.map((im, idx) => ({
        id: im.id,
        src: im.src,
        alt: im.alt || '',
        width: im.width,
        height: im.height,
        position: idx + 1,
      }));
      const patch = {
        shopify_product_id: t.sid,
        source_product_id: t.id,
        title: t.title || liveById.get(t.sid)?.title || null,
        image_url: cdnUrls[0] || null,
        images: imageRows.length ? imageRows : null,
        'custom.more_image_link_1': cdnUrls[0] || null,
        'custom.more_image_link_2': cdnUrls[1] || null,
        'custom.more_image_link_3': cdnUrls[2] || null,
        'custom.more_image_link_4': cdnUrls[3] || null,
      };
      // Upsert so products missing from mirror still get updated
      await rest('shopify_products?on_conflict=shopify_product_id', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(patch),
      });

      results.push({
        sid: t.sid,
        sku: t.sku,
        title: t.title,
        from: t.liveN,
        to: cdnUrls.length,
        status: 'ok',
        cdnUrls,
      });
      ok++;
    } catch (e) {
      fail++;
      results.push({
        sid: t.sid,
        sku: t.sku,
        title: t.title,
        status: 'error',
        error: String(e?.message || e),
      });
      console.error(`\nFAIL ${t.sid}:`, e?.message || e);
    }
    await sleep(200);
  }

  console.log(`\nDone. ok=${ok} fail=${fail} dryRun=${dryRun}`);
  const fs = await import('node:fs');
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  fs.writeFileSync(
    '/opt/cursor/artifacts/restore_false_deduped_images_report.json',
    JSON.stringify({ dryRun, ok, fail, targets: targets.length, results }, null, 2),
  );
  console.log('Wrote /opt/cursor/artifacts/restore_false_deduped_images_report.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

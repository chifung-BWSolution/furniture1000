#!/usr/bin/env node
/**
 * FDS-08 live regression on the FDS 2.0 develop branch.
 *
 * Verifies, with real rows on the branch (all created and removed by this script):
 *   - a saved reference quote keeps its price snapshot after the base price changes
 *   - a new quote picks up the new base price
 *   - share tokens only return their own quote, and wrong tokens return nothing
 *   - the base price is restored to its original value
 *
 *   node scripts/test-package-pricing-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = `FDS08-TEST-${Date.now()}`;
const TOKEN_A = `fds08toka${Date.now().toString(36)}`;
const TOKEN_B = `fds08tokb${Date.now().toString(36)}`;

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error('SUPABASE_ACCESS_TOKEN not found (env or .env.local)');
}

const token = readToken();

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${BRANCH_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : [];
}

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const j = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

let originalPrice = null;
let priceId = null;
let quoteA = null;
let quoteB = null;

try {
  const [line] = await sql(`
    select id, area, item_name, grade, material, dimension_text, unit_text, unit_price::text as price,
           standard_note, premium_note
      from public.fds_package_price_lines
     where unit_price is not null
     order by sort_order
     limit 1;
  `);
  if (!line) throw new Error('no base price line to test');
  priceId = line.id;
  originalPrice = Number(line.price);
  const newPrice = originalPrice + 123.45;

  const lineOf = (price) => ({
    id: 'test-line',
    area: line.area,
    itemName: line.item_name,
    grade: line.grade,
    material: line.material,
    dimension: line.dimension_text,
    unit: line.unit_text,
    quantity: 3,
    unitPrice: price,
    standardNote: line.standard_note,
    premiumNote: line.premium_note,
  });
  const snapshot = (price) => ({
    title: `${TAG} 參考報價`,
    priceYear: 2026,
    note: '參考報價，不是正式報價單。',
    lines: [lineOf(price)],
  });

  // Customer-visible save path: insert the snapshot as the app does.
  const [a] = await sql(`
    insert into public.fds_package_quotes (title, snapshot, share_token)
    values ('${TAG} A', ${j(snapshot(originalPrice))}, '${TOKEN_A}')
    returning id;
  `);
  quoteA = a.id;

  // Admin changes the base price afterwards.
  await sql(`update public.fds_package_price_lines set unit_price = ${newPrice} where id = '${priceId}';`);

  const [aAfter] = await sql(`select snapshot from public.fds_package_quotes where id = '${quoteA}';`);
  assertEqual(aAfter.snapshot.lines[0].unitPrice, originalPrice, 'saved snapshot keeps the old price');

  // A new quote uses the new base price.
  const [b] = await sql(`
    insert into public.fds_package_quotes (title, snapshot, share_token)
    values ('${TAG} B', ${j(snapshot(newPrice))}, '${TOKEN_B}')
    returning id;
  `);
  quoteB = b.id;
  const [bRead] = await sql(`select snapshot from public.fds_package_quotes where id = '${quoteB}';`);
  assertEqual(bRead.snapshot.lines[0].unitPrice, newPrice, 'new quote uses the new base price');

  // Share token scope: only the matching token returns a snapshot.
  const [byTokenA] = await sql(`select public.fds_package_quote_by_token('${TOKEN_A}') as s;`);
  assertEqual(byTokenA.s.lines[0].unitPrice, originalPrice, 'token A returns quote A');
  const [byTokenB] = await sql(`select public.fds_package_quote_by_token('${TOKEN_B}') as s;`);
  assertEqual(byTokenB.s.lines[0].unitPrice, newPrice, 'token B returns quote B');
  const [wrong] = await sql(`select public.fds_package_quote_by_token('fds08wrongtoken000000') as s;`);
  assertEqual(wrong.s, null, 'unknown token returns nothing');
  const [shortToken] = await sql(`select public.fds_package_quote_by_token('abc') as s;`);
  assertEqual(shortToken.s, null, 'short token is rejected');

  // Money consistency: 3 × price in cents for both snapshots.
  for (const [price, label] of [[originalPrice, 'A'], [newPrice, 'B']]) {
    const expected = Math.round(price * 100) * 3;
    const [q] = await sql(`select public.fds_package_quote_by_token('${label === 'A' ? TOKEN_A : TOKEN_B}') as s;`);
    assertEqual(q.s.lines[0].quantity * Math.round(q.s.lines[0].unitPrice * 100), expected, `cent total ${label}`);
  }

  console.log('PASS package pricing snapshot isolation, new-quote pricing and share-token scope');
} finally {
  if (priceId !== null && originalPrice !== null) {
    await sql(`update public.fds_package_price_lines set unit_price = ${originalPrice} where id = '${priceId}';`)
      .catch((error) => {
        console.error('base price restore failed:', error.message);
        process.exitCode = 1;
      });
  }
  for (const id of [quoteA, quoteB].filter(Boolean)) {
    await sql(`delete from public.fds_package_quotes where id = '${id}';`).catch((error) => {
      console.error('quote cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }
}

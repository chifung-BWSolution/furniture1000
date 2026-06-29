#!/usr/bin/env node
/**
 * One-shot batch migration: base64 → Supabase Storage URL
 * for ready_to_shopify AND products tables.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_ANON_KEY=eyJ... \
 *   node scripts/run-image-migration.mjs
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_* equivalents).');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${ANON_KEY}`,
  apikey: ANON_KEY,
};

async function invoke(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function migrateRts() {
  console.log('\n=== Step 1: ready_to_shopify ===');
  let round = 0;
  while (true) {
    round++;
    const data = await invoke('migrate-rts-images', { batch_size: 5 });
    console.log(`  batch ${round}:`, data);
    if (data.done || data.remaining === 0) break;
    await sleep(800);
  }
}

async function migrateProducts() {
  console.log('\n=== Step 2: products ===');
  let cursor = null;
  let round = 0;
  while (true) {
    round++;
    const body = { batch_size: 5 };
    if (cursor) body.after_id = cursor;
    const data = await invoke('migrate-products-images', body);
    console.log(`  batch ${round}:`, data);
    cursor = data.next_cursor;
    if (data.done) break;
    await sleep(800);
  }
}

(async () => {
  try {
    await migrateRts();
    await migrateProducts();
    console.log('\n✅ Migration complete.');
  } catch (e) {
    console.error('\n❌ Migration failed:', e.message);
    process.exit(1);
  }
})();

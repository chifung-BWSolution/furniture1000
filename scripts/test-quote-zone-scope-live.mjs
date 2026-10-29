#!/usr/bin/env node
/**
 * FDS-13 server-side quote scope live check (FDS 2.0 develop branch only).
 *
 * Creates a temporary PM identity and four throw-away quotes, then verifies
 * `fds_quote_zone_scope` allows only the BWF formal quote. Cleans everything up.
 *
 *   node scripts/test-quote-zone-scope-live.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = `FDS13-TEST-${Date.now()}`;
const AUTH_UUID = crypto.randomUUID();
const STAFF_EMAIL = `fds13-test-${Date.now()}@example.invalid`;
const CLAIMS = JSON.stringify({ sub: AUTH_UUID, email: STAFF_EMAIL, role: 'authenticated' }).replace(/'/g, "''");

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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : [];
}

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const ids = [];

try {
  await sql(`
    insert into public.platform_user_profiles (email, auth_user_id, display_name, role, active, source)
    values ('${STAFF_EMAIL}', '${AUTH_UUID}', 'FDS13 測試PM', 'pm', true, 'pms');
  `);

  const rows = await sql(`
    insert into public.bwf_quote (quote_id, version, status, total_amount, submitter, project_data) values
      ('${TAG}-FORMAL', 'v1', '待審核', 1000, 'FDS13 測試PM', '{}'::jsonb),
      ('${TAG}-QUICK', 'v1', '快速報價', 1000, 'FDS13 測試PM', '{}'::jsonb),
      ('DP-${TAG}', 'v1', '待審核', 1000, 'FDS13 測試PM', '{}'::jsonb),
      ('${TAG}-PROJECT', 'v1', '待審核', 1000, 'FDS13 測試PM', '{"designProjectId":"11111111-1111-4111-8111-111111111111"}'::jsonb)
    returning id, quote_id;
  `);
  for (const row of rows) ids.push(row.id);
  const byCode = new Map(rows.map((row) => [row.quote_id, row.id]));

  const asStaff = (quoteUuid) => `
    select set_config('request.jwt.claims', '${CLAIMS}', false);
    select public.fds_quote_zone_scope('${quoteUuid}') as s;
  `;

  const [formal] = await sql(asStaff(byCode.get(`${TAG}-FORMAL`)));
  assertEqual(formal.s.allowed, true, 'formal quote is allowed');

  const [quick] = await sql(asStaff(byCode.get(`${TAG}-QUICK`)));
  assertEqual(quick.s.allowed, false, 'quick quote is rejected');
  assertEqual(quick.s.reason, 'not_formal_quote', 'quick quote reason');

  const [dp] = await sql(asStaff(byCode.get(`DP-${TAG}`)));
  assertEqual(dp.s.allowed, false, 'DP- quote is rejected');
  assertEqual(dp.s.reason, 'design_project', 'DP- reason');

  const [project] = await sql(asStaff(byCode.get(`${TAG}-PROJECT`)));
  assertEqual(project.s.allowed, false, 'design-project shell is rejected');
  assertEqual(project.s.reason, 'design_project', 'design project reason');

  const [missing] = await sql(asStaff(crypto.randomUUID()));
  assertEqual(missing.s.allowed, false, 'unknown quote is rejected');
  assertEqual(missing.s.reason, 'quote_missing', 'missing quote reason');

  // Non-staff caller (no role) must be rejected even for a formal quote.
  const [anon] = await sql(`
    select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
    select public.fds_quote_zone_scope('${byCode.get(`${TAG}-FORMAL`)}') as s;
  `);
  assertEqual(anon.s.allowed, false, 'non-staff caller is rejected');
  assertEqual(anon.s.reason, 'role', 'role reason');

  console.log('PASS quote zone scope allows only BWF formal quotes (server-side)');
} finally {
  for (const id of ids) {
    await sql(`delete from public.bwf_quote where id = '${id}';`).catch((error) => {
      console.error('quote cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }
  await sql(`delete from public.platform_user_profiles where auth_user_id = '${AUTH_UUID}';`).catch((error) => {
    console.error('profile cleanup failed:', error.message);
    process.exitCode = 1;
  });
}

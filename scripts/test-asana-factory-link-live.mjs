#!/usr/bin/env node
/**
 * FDS-12 read-only Asana factory link live test (FDS 2.0 develop branch only).
 *
 * Verifies the persistence + worker contract without calling Asana:
 *   link_set / link_list → apply (description wins, comments idempotent) →
 *   permission guard → remove. Creates and removes its own rows.
 *
 *   node scripts/test-asana-factory-link-live.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const AUTH_UUID = crypto.randomUUID();
const STAFF_EMAIL = `fds12-test-${Date.now()}@example.invalid`;
const CLAIMS = JSON.stringify({ sub: AUTH_UUID, email: STAFF_EMAIL, role: 'authenticated' }).replace(/'/g, "''");
const SERVICE_CLAIMS = '{"role":"service_role"}';
const FACTORY_ID = crypto.randomUUID();
const TASK_GID = `1219${Date.now().toString().slice(-12)}`;

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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : [];
}

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const asStaff = (statement) => `
  select set_config('request.jwt.claims', '${CLAIMS}', false);
  ${statement}
`;
const asService = (statement) => `
  select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
  ${statement}
`;

let linkId = null;

try {
  await sql(`
    insert into public.platform_user_profiles (email, auth_user_id, display_name, role, active, source)
    values ('${STAFF_EMAIL}', '${AUTH_UUID}', 'FDS12 測試UPLOADER', 'uploader', true, 'pms');
  `);

  const [setRow] = await sql(asStaff(`
    select public.fds_asana_factory_link_set('${FACTORY_ID}', '測試廠家', '${TASK_GID}') as id;
  `));
  linkId = setRow.id;
  if (!linkId) throw new Error('link_set did not return an id');

  const [listed] = await sql(asStaff(`select public.fds_asana_factory_link_list() as rows;`));
  const rows = listed.rows;
  assertEqual(rows.length, 1, 'one link listed');
  assertEqual(rows[0].factory_name, '測試廠家', 'factory name');
  assertEqual(rows[0].asana_task_gid, TASK_GID, 'task gid');
  assertEqual(rows[0].asana_project_gid, '1155109275123381', 'default project gid');
  assertEqual(rows[0].comment_count, 0, 'no comments yet');

  // Duplicate factory_id updates the same link instead of creating another.
  await sql(asStaff(`
    select public.fds_asana_factory_link_set('${FACTORY_ID}', '測試廠家（更新）', '${TASK_GID}');
  `));
  const [countAfter] = await sql(`select count(*)::text as c from public.fds_asana_factory_link where factory_id = '${FACTORY_ID}';`);
  assertEqual(countAfter.c, '1', 'factory_id is unique');

  // Worker apply: description + comments, second run must not duplicate.
  const comments = JSON.stringify([
    { gid: 'story-1', body: '第一次跟進', author: 'Rachel', created_at: '2026-10-01T10:00:00Z' },
    { gid: 'story-2', body: '第二次跟進', author: 'Leo', created_at: '2026-10-02T10:00:00Z' },
  ]).replace(/'/g, "''");
  const [applied] = await sql(asService(`
    select public.fds_asana_factory_apply('${linkId}', 'Asana 廠家描述', '2026-10-02T10:00:00Z', '${comments}'::jsonb) as r;
  `));
  assertEqual(applied.r.inserted_comments, 2, 'two comments inserted');
  const [appliedAgain] = await sql(asService(`
    select public.fds_asana_factory_apply('${linkId}', '', '2026-10-02T10:00:00Z', '${comments}'::jsonb) as r;
  `));
  assertEqual(appliedAgain.r.inserted_comments, 0, 're-running the same comments inserts nothing');

  const [state] = await sql(`
    select l.remote_description, l.remote_modified_at is not null as has_modified,
           l.last_synced_at is not null as synced,
           (select count(*)::text from public.fds_asana_factory_comment c where c.link_id = l.id) as comments
      from public.fds_asana_factory_link l where l.id = '${linkId}';
  `);
  assertEqual(state.remote_description, 'Asana 廠家描述', 'description saved');
  assertEqual(state.synced, 'true', 'last_synced_at set');
  assertEqual(state.comments, '2', 'comments stored once');

  // Empty remote description must not erase the stored one.
  await sql(asService(`select public.fds_asana_factory_apply('${linkId}', '', null, '[]'::jsonb);`));
  const [kept] = await sql(`select remote_description from public.fds_asana_factory_link where id = '${linkId}';`);
  assertEqual(kept.remote_description, 'Asana 廠家描述', 'empty Asana description keeps the FDS copy');

  // Error mark.
  await sql(asService(`select public.fds_asana_factory_mark_error('${linkId}', 'asana_task_500');`));
  const [errored] = await sql(`select last_error from public.fds_asana_factory_link where id = '${linkId}';`);
  assertEqual(errored.last_error, 'asana_task_500', 'error recorded');

  // Permission: a plain authenticated user cannot link or list.
  for (const [label, statement] of [
    ['link_set', `select public.fds_asana_factory_link_set(gen_random_uuid(), 'x', 'y');`],
    ['link_list', `select public.fds_asana_factory_link_list();`],
  ]) {
    let denied = false;
    try {
      await sql(`select set_config('request.jwt.claims', '{"role":"authenticated"}', false); ${statement}`);
    } catch (error) {
      denied = /permission_denied|42501/.test(String(error.body ?? error.message));
    }
    if (!denied) throw new Error(`non staff could run ${label}`);
  }

  // Remove.
  await sql(asStaff(`select public.fds_asana_factory_link_remove('${linkId}');`));
  const [removed] = await sql(`
    select (select count(*)::text from public.fds_asana_factory_link where id = '${linkId}') as links,
           (select count(*)::text from public.fds_asana_factory_comment where link_id = '${linkId}') as comments;
  `);
  assertEqual(removed.links, '0', 'link removed');
  assertEqual(removed.comments, '0', 'comments cascade');

  console.log('PASS Asana factory link persists, sync is idempotent, description keeps FDS copy and permissions hold');
} finally {
  if (linkId) {
    await sql(`delete from public.fds_asana_factory_link where id = '${linkId}';`).catch((error) => {
      console.error('link cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }
  await sql(`delete from public.platform_user_profiles where auth_user_id = '${AUTH_UUID}';`).catch((error) => {
    console.error('profile cleanup failed:', error.message);
    process.exitCode = 1;
  });
}

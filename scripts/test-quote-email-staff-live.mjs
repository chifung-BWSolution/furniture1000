#!/usr/bin/env node
/**
 * FDS-15 staff-path live regression on the FDS 2.0 develop branch.
 *
 * Simulates a signed-in PM (JWT claims + a temporary platform_user_profiles row) and
 * checks the real staff RPCs: status → save template → missing phone/share link errors
 * → schedule → stop. No email is sent and no message is claimed.
 *
 *   node scripts/test-quote-email-staff-live.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = `FDS15-STAFF-${Date.now()}`;
const TOKEN = `fds15staff${Date.now().toString(36)}`;
const AUTH_UUID = crypto.randomUUID();
const STAFF_EMAIL = `fds15-test-${Date.now()}@example.invalid`;
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
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
    error.body = text;
    throw error;
  }
  return text ? JSON.parse(text) : [];
}

function assertEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function expectError(label, query, needle) {
  try {
    await sql(query);
  } catch (error) {
    if (String(error.body ?? error.message).includes(needle)) return;
    throw new Error(`${label}: expected ${needle}, got ${error.body ?? error.message}`);
  }
  throw new Error(`${label}: expected ${needle}, but the call succeeded`);
}

const asStaff = (statement) => `
  select set_config('request.jwt.claims', '${CLAIMS}', false);
  ${statement}
`;

let quoteUuid = '';

try {
  await sql(`
    insert into public.platform_user_profiles (email, auth_user_id, display_name, role, active, source)
    values ('${STAFF_EMAIL}', '${AUTH_UUID}', 'FDS15 測試PM', 'pm', true, 'pms');
  `);

  const [created] = await sql(`
    insert into public.bwf_quote (quote_id, version, status, total_amount, submitter, project_data)
    values ('${TAG}', 'v1', '測試', 9600, 'FDS15 測試PM', '{"formData":{"projectManager":"FDS15 測試PM"}}'::jsonb)
    returning id;
  `);
  quoteUuid = created.id;

  await sql(`
    insert into public.bwf_quote_item (quote_uuid, sort_order, client_item_id, name, unit_price, quantity, unit)
    values
      ('${quoteUuid}', 1, 'a', '員工椅', 800, 8, 'PC'),
      ('${quoteUuid}', 2, 'b', '會議桌', 1600, 2, 'PC');
    insert into public.bwf_quote_share_links (quote_uuid, quote_id, share_token, status)
    values ('${quoteUuid}', '${TAG}', '${TOKEN}', 'active');
  `);

  // --- status ------------------------------------------------------------
  const [initial] = await sql(asStaff(`select public.fds_quote_email_status('${quoteUuid}') as s;`));
  assertEqual(initial.s.status, 'not_sent', 'initial status');
  assertEqual(initial.s.item_count, 2, 'status returns item count');
  assertEqual(initial.s.share_token, TOKEN, 'status returns the active share token');
  assertEqual(initial.s.total_amount, '9600', 'status returns the quote total');

  // --- missing phone must block sending ---------------------------------
  await expectError(
    'schedule without a contact phone',
    asStaff(`select public.fds_quote_email_schedule('${quoteUuid}', 'customer@example.com', 'manual');`),
    'contact_phone_missing',
  );

  // --- save template -----------------------------------------------------
  await sql(asStaff(`
    select public.fds_quote_email_template_save(
      '${quoteUuid}',
      '以下是為你準備的方案。',
      '+852 9000 0000',
      '[{"title":"送貨","body":"下月安排"}]'::jsonb
    );
  `));
  const [saved] = await sql(asStaff(`select public.fds_quote_email_status('${quoteUuid}') as s;`));
  assertEqual(saved.s.contact_phone, '+852 9000 0000', 'template phone saved');
  assertEqual(saved.s.intro_text, '以下是為你準備的方案。', 'template intro saved');
  assertEqual(saved.s.custom_sections.length, 1, 'custom section saved');

  // --- invalid recipient -------------------------------------------------
  await expectError(
    'invalid recipient',
    asStaff(`select public.fds_quote_email_schedule('${quoteUuid}', 'not-an-email', 'manual');`),
    'invalid_recipient',
  );

  // --- missing share link ------------------------------------------------
  await sql(`update public.bwf_quote_share_links set status = 'revoked' where quote_uuid = '${quoteUuid}';`);
  await expectError(
    'schedule without an active share link',
    asStaff(`select public.fds_quote_email_schedule('${quoteUuid}', 'customer@example.com', 'manual');`),
    'share_link_missing',
  );
  await sql(`update public.bwf_quote_share_links set status = 'active' where quote_uuid = '${quoteUuid}';`);

  // --- schedule + duplicate schedule ------------------------------------
  const [scheduled] = await sql(asStaff(`
    select public.fds_quote_email_schedule('${quoteUuid}', 'Customer@Example.com', 'manual') as id;
  `));
  if (!scheduled.id) throw new Error('schedule did not return a message id');
  const [scheduledAgain] = await sql(asStaff(`
    select public.fds_quote_email_schedule('${quoteUuid}', 'customer@example.com', 'manual') as id;
  `));
  assertEqual(scheduledAgain.id, scheduled.id, 'rescheduling reuses the pending message');
  const [queued] = await sql(`
    select count(*)::text as c, min(to_email) as email
      from public.bwf_quote_email_message
     where quote_uuid = '${quoteUuid}' and status = 'queued';
  `);
  assertEqual(queued.c, '1', 'only one pending message');
  assertEqual(queued.email, 'customer@example.com', 'recipient normalised to lower case');

  // --- stop --------------------------------------------------------------
  await sql(asStaff(`select public.fds_quote_email_stop('${quoteUuid}', 'manual');`));
  const [stopped] = await sql(`
    select s.status, s.auto_follow_up,
           (select count(*)::text from public.bwf_quote_email_message m
             where m.quote_uuid = '${quoteUuid}' and m.status = 'cancelled') as cancelled
      from public.bwf_quote_email_settings s where s.quote_uuid = '${quoteUuid}';
  `);
  assertEqual(stopped.status, 'stopped', 'settings stopped');
  assertEqual(stopped.auto_follow_up, 'false', 'auto follow-up disabled by stop');

  // --- permission --------------------------------------------------------
  await expectError(
    'non staff cannot read the email status',
    `select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
     select public.fds_quote_email_status('${quoteUuid}');`,
    'permission_denied',
  );

  console.log('PASS staff email template save, send checks, schedule dedupe, stop and role guard');
} finally {
  if (quoteUuid) {
    await sql(`delete from public.bwf_quote where id = '${quoteUuid}';`).catch((error) => {
      console.error('quote cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }
  await sql(`delete from public.platform_user_profiles where auth_user_id = '${AUTH_UUID}';`).catch((error) => {
    console.error('profile cleanup failed:', error.message);
    process.exitCode = 1;
  });
}

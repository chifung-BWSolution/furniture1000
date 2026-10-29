#!/usr/bin/env node
/**
 * FDS-15 A/B isolation live regression (FDS 2.0 develop branch only).
 *
 * Two quotes with different templates must stay independent:
 *   - saving B's template never changes A
 *   - a valid customer view of A stops only A's auto follow-up
 *   - B keeps its queued follow-up and can be stopped later on its own
 *
 * No email is sent. Everything this script creates is removed.
 *
 *   node scripts/test-quote-email-isolation-live.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = `FDS15-ISO-${Date.now()}`;
const TOKEN_A = `fds15isoa${Date.now().toString(36)}`;
const TOKEN_B = `fds15isob${Date.now().toString(36)}`;
const AUTH_UUID = crypto.randomUUID();
const STAFF_EMAIL = `fds15-iso-${Date.now()}@example.invalid`;
const CLAIMS = JSON.stringify({ sub: AUTH_UUID, email: STAFF_EMAIL, role: 'authenticated' }).replace(/'/g, "''");
const SERVICE_CLAIMS = '{"role":"service_role"}';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

const quotes = [];

try {
  await sql(`
    insert into public.platform_user_profiles (email, auth_user_id, display_name, role, active, source)
    values ('${STAFF_EMAIL}', '${AUTH_UUID}', 'FDS15 ISO PM', 'pm', true, 'pms');
  `);

  for (const [suffix, tokenValue] of [['A', TOKEN_A], ['B', TOKEN_B]]) {
    const [created] = await sql(`
      insert into public.bwf_quote (quote_id, version, status, total_amount, submitter, project_data)
      values ('${TAG}-${suffix}', 'v1', '測試', 1000, 'FDS15 ISO PM', '{}'::jsonb)
      returning id;
    `);
    quotes.push({ suffix, id: created.id });
    await sql(`
      insert into public.bwf_quote_item (quote_uuid, sort_order, client_item_id, name, unit_price, quantity, unit)
      values ('${created.id}', 1, 'a', '員工椅', 500, 2, 'PC');
      insert into public.bwf_quote_share_links (quote_uuid, quote_id, share_token, status)
      values ('${created.id}', '${TAG}-${suffix}', '${tokenValue}', 'active');
      insert into public.bwf_quote_email_template (quote_uuid, intro_text, contact_phone)
      values ('${created.id}', '${suffix} 的引言', '+852 9000 000${suffix}');
      insert into public.bwf_quote_email_settings (quote_uuid, status, recipient_email, auto_follow_up, next_follow_up_at)
      values ('${created.id}', 'auto_follow_up_active', 'customer-${suffix.toLowerCase()}@example.com', true, now() - interval '1 minute');
    `);
  }

  const idA = quotes[0].id;
  const idB = quotes[1].id;

  // Both quotes are due → one queued follow-up each, then the worker claims them.
  await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_enqueue_follow_ups(50);
  `);
  const queuedRows = await sql(`
    select quote_uuid
      from public.bwf_quote_email_message
     where quote_uuid in ('${idA}', '${idB}') and kind = 'follow_up' and status = 'queued';
  `);
  assertEqual(queuedRows.length, 2, 'one queued follow-up per quote');

  const claimedRaw = await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_claim(50) as rows;
  `);
  const claimed = claimedRaw[0].rows;
  const claimA = claimed.find((row) => row.quote_uuid === idA);
  const claimB = claimed.find((row) => row.quote_uuid === idB);
  if (!claimA || !claimB) throw new Error('both follow-ups should be claimed (sending)');
  assertEqual(claimA.kind, 'follow_up', 'A claim is the follow-up');
  assertEqual(claimB.kind, 'follow_up', 'B claim is the follow-up');

  // Saving B's template must not touch A.
  await sql(`
    select set_config('request.jwt.claims', '${CLAIMS}', false);
    select public.fds_quote_email_template_save('${idB}', 'B 的新引言', '+852 9111 1111', '[]'::jsonb);
  `);
  const [templates] = await sql(`
    select
      (select intro_text from public.bwf_quote_email_template where quote_uuid = '${idA}') as a_intro,
      (select contact_phone from public.bwf_quote_email_template where quote_uuid = '${idA}') as a_phone,
      (select intro_text from public.bwf_quote_email_template where quote_uuid = '${idB}') as b_intro,
      (select contact_phone from public.bwf_quote_email_template where quote_uuid = '${idB}') as b_phone;
  `);
  assertEqual(templates.a_intro, 'A 的引言', 'A template intro unchanged');
  assertEqual(templates.a_phone, '+852 9000 000A', 'A template phone unchanged');
  assertEqual(templates.b_intro, 'B 的新引言', 'B template updated');
  assertEqual(templates.b_phone, '+852 9111 1111', 'B template phone updated');

  // Valid view of A only stops A.
  const [viewA] = await sql(`select public.record_quote_share_view('${TOKEN_A}', '${IPHONE_UA}', 'https://mail.example.com/', false) as r;`);
  assertEqual(viewA.r.valid, true, 'A view is valid');
  assertEqual(viewA.r.stopped, true, 'A view stops A follow-up');

  const [state] = await sql(`
    select
      (select status from public.bwf_quote_email_settings where quote_uuid = '${idA}') as a_status,
      (select auto_follow_up from public.bwf_quote_email_settings where quote_uuid = '${idA}') as a_auto,
      (select status from public.bwf_quote_email_settings where quote_uuid = '${idB}') as b_status,
      (select auto_follow_up from public.bwf_quote_email_settings where quote_uuid = '${idB}') as b_auto,
      (select count(*)::text from public.bwf_quote_email_message where quote_uuid = '${idA}' and status = 'cancelled') as a_cancelled,
      (select count(*)::text from public.bwf_quote_email_message where quote_uuid = '${idB}' and status in ('queued','sending')) as b_queued;
  `);
  assertEqual(state.a_status, 'viewed', 'A becomes viewed');
  assertEqual(state.a_auto, 'false', 'A auto follow-up off');
  assertEqual(state.b_status, 'auto_follow_up_active', 'B is untouched');
  assertEqual(state.b_auto, 'true', 'B auto follow-up still on');
  assertEqual(state.a_cancelled, '1', 'A claimed follow-up cancelled');
  assertEqual(state.b_queued, '1', 'B follow-up is still pending (sending)');

  // The race guard must block A even though its message was already claimed/claimed-sending.
  const [confirmA] = await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_confirm_send('${claimA.id}') as ok;
  `);
  assertEqual(confirmA.ok, false, 'A cannot send after a valid view');
  const [confirmB] = await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_confirm_send('${claimB.id}') as ok;
  `);
  assertEqual(confirmB.ok, true, 'B can still send');

  // A cancelled message is never claimable again.
  const reclaimRaw = await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_claim(50) as rows;
  `);
  assertEqual(reclaimRaw[0].rows.some((row) => row.quote_uuid === idA), false, 'A has nothing left to send');

  // Stopping B later only affects B.
  await sql(`
    select set_config('request.jwt.claims', '${CLAIMS}', false);
    select public.fds_quote_email_stop('${idB}', 'manual');
  `);
  const [afterStop] = await sql(`
    select
      (select status from public.bwf_quote_email_settings where quote_uuid = '${idA}') as a_status,
      (select status from public.bwf_quote_email_settings where quote_uuid = '${idB}') as b_status,
      (select count(*)::text from public.bwf_quote_email_message where quote_uuid = '${idB}' and status = 'cancelled') as b_cancelled;
  `);
  assertEqual(afterStop.a_status, 'viewed', 'A keeps viewed');
  assertEqual(afterStop.b_status, 'stopped', 'B stopped independently');
  assertEqual(afterStop.b_cancelled, '1', 'B pending follow-up cancelled by stop');

  const [confirmBAfterStop] = await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_confirm_send('${claimB.id}') as ok;
  `);
  assertEqual(confirmBAfterStop.ok, false, 'B cannot send after it was stopped');

  console.log('PASS quote email templates, follow-ups and stop events are isolated per quote');
} finally {
  for (const quote of quotes) {
    await sql(`delete from public.bwf_quote where id = '${quote.id}';`).catch((error) => {
      console.error('quote cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }
  await sql(`delete from public.platform_user_profiles where auth_user_id = '${AUTH_UUID}';`).catch((error) => {
    console.error('profile cleanup failed:', error.message);
    process.exitCode = 1;
  });
}

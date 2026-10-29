#!/usr/bin/env node
/**
 * FDS-15 live regression on the FDS 2.0 develop branch.
 *
 * Covers the worker-side state machine only (no real email is sent):
 *   claim → mark sent (auto follow-up every 3 days) → due follow-up enqueued once
 *   → valid customer view stops follow-up, queued follow-ups are cancelled
 *   → bot/scanner view does NOT stop follow-up.
 *
 * Creates and removes its own quote rows. Never touches Production.
 *
 *   node scripts/test-quote-email-followup-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = `FDS15-TEST-${Date.now()}`;
const TOKEN = `fds15test${Date.now().toString(36)}`;
const SERVICE_CLAIMS = `{"role":"service_role"}`;

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
  if (String(actual) !== String(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

let quoteUuid = '';

try {
  const [created] = await sql(`
    insert into public.bwf_quote (quote_id, version, status, total_amount, submitter, project_data)
    values ('${TAG}', 'v1', '測試', 12800, 'FDS15 測試', '{"formData":{"projectManager":"FDS15 測試"}}'::jsonb)
    returning id;
  `);
  quoteUuid = created.id;

  await sql(`
    insert into public.bwf_quote_item (quote_uuid, sort_order, client_item_id, name, unit_price, quantity, unit)
    values
      ('${quoteUuid}', 1, 'a', '員工椅', 800, 10, 'PC'),
      ('${quoteUuid}', 2, 'b', '會議桌', 1600, 3, 'PC');
    insert into public.bwf_quote_share_links (quote_uuid, quote_id, share_token, status)
    values ('${quoteUuid}', '${TAG}', '${TOKEN}', 'active');
    insert into public.bwf_quote_email_template (quote_uuid, intro_text, contact_phone)
    values ('${quoteUuid}', '以下是為你準備的傢俬方案。', '+852 9000 0000');
    insert into public.bwf_quote_email_settings (quote_uuid, status, recipient_email)
    values ('${quoteUuid}', 'not_sent', 'customer@example.com');
    insert into public.bwf_quote_email_message (quote_uuid, kind, to_email, status, scheduled_for)
    values ('${quoteUuid}', 'manual', 'customer@example.com', 'queued', now());
  `);

  // --- claim -------------------------------------------------------------
  const claimedRaw = await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_claim(50) as rows;
  `);
  const claimed = claimedRaw[0].rows;
  const mine = claimed.filter((row) => row.quote_uuid === quoteUuid);
  assertEqual(mine.length, 1, 'claim returns the queued manual message');
  assertEqual(mine[0].contact_phone, '+852 9000 0000', 'claim returns the current template phone');
  assertEqual(mine[0].share_token, TOKEN, 'claim returns the active share link');
  assertEqual(mine[0].item_count, 2, 'claim returns the item count summary');
  assertEqual(mine[0].attempts, 1, 'claim increments attempts');

  // --- mark sent ---------------------------------------------------------
  await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_mark('${mine[0].id}', 'sent', null, 'test', 'msg-test');
  `);
  const [afterSend] = await sql(`
    select s.status, s.auto_follow_up, s.next_follow_up_at > now() + interval '2 days 23 hours' as due_in_3d,
           m.status as message_status
      from public.bwf_quote_email_settings s
      join public.bwf_quote_email_message m on m.id = '${mine[0].id}'
     where s.quote_uuid = '${quoteUuid}';
  `);
  assertEqual(afterSend.status, 'auto_follow_up_active', 'settings move to auto follow-up');
  assertEqual(afterSend.auto_follow_up, 'true', 'auto follow-up enabled');
  assertEqual(afterSend.due_in_3d, 'true', 'next follow-up is 3 days out');
  assertEqual(afterSend.message_status, 'sent', 'message marked sent');

  // --- due follow-up enqueued exactly once -------------------------------
  await sql(`update public.bwf_quote_email_settings set next_follow_up_at = now() - interval '1 minute' where quote_uuid = '${quoteUuid}';`);
  await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_enqueue_follow_ups(50);
  `);
  const [firstEnqueue] = await sql(`
    select count(*)::text as c from public.bwf_quote_email_message
     where quote_uuid = '${quoteUuid}' and kind = 'follow_up' and status = 'queued';
  `);
  assertEqual(firstEnqueue.c, '1', 'one follow-up queued');

  await sql(`
    select set_config('request.jwt.claims', '${SERVICE_CLAIMS}', false);
    select public.fds_quote_email_enqueue_follow_ups(50);
  `);
  const [secondEnqueue] = await sql(`
    select count(*)::text as c from public.bwf_quote_email_message
     where quote_uuid = '${quoteUuid}' and kind = 'follow_up' and status in ('queued','sending');
  `);
  assertEqual(secondEnqueue.c, '1', 'parallel enqueue does not duplicate the follow-up');

  // --- bot/scanner view must not stop follow-up --------------------------
  const [botView] = await sql(`
    select public.record_quote_share_view(
      '${TOKEN}',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      null,
      false
    ) as result;
  `);
  assertEqual(botView.result.valid, false, 'scanner view is rejected');
  assertEqual(botView.result.stopped, false, 'scanner view does not stop email');
  const [afterBot] = await sql(`
    select status, auto_follow_up, first_viewed_at from public.bwf_quote_email_settings where quote_uuid = '${quoteUuid}';
  `);
  assertEqual(afterBot.status, 'auto_follow_up_active', 'scanner did not change settings status');
  assertEqual(afterBot.auto_follow_up, 'true', 'scanner did not disable follow-up');
  if (afterBot.first_viewed_at) throw new Error('scanner must not set first_viewed_at');

  // --- valid customer view stops this quote only ------------------------
  const [view] = await sql(`
    select public.record_quote_share_view(
      '${TOKEN}',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'https://mail.example.com/',
      false
    ) as result;
  `);
  assertEqual(view.result.valid, true, 'real browser view is valid');
  assertEqual(view.result.stopped, true, 'valid view stops this quote follow-up');
  const [afterView] = await sql(`
    select status, auto_follow_up, first_viewed_at is not null as viewed from public.bwf_quote_email_settings where quote_uuid = '${quoteUuid}';
  `);
  assertEqual(afterView.status, 'viewed', 'settings status becomes viewed');
  assertEqual(afterView.auto_follow_up, 'false', 'auto follow-up disabled after view');
  assertEqual(afterView.viewed, 'true', 'first viewed timestamp saved');
  const [cancelled] = await sql(`
    select count(*)::text as c from public.bwf_quote_email_message
     where quote_uuid = '${quoteUuid}' and kind = 'follow_up' and status = 'cancelled';
  `);
  assertEqual(cancelled.c, '1', 'queued follow-up is cancelled after a valid view');

  // Duplicate view within 30 minutes must not restart or duplicate anything.
  const [dup] = await sql(`
    select public.record_quote_share_view(
      '${TOKEN}',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'https://mail.example.com/',
      false
    ) as result;
  `);
  assertEqual(dup.result.reason, 'duplicate', 'repeated view is de-duplicated');

  // Invalid token must be rejected without leaking anything.
  const [bad] = await sql(`select public.record_quote_share_view('qtok_does_not_exist', 'Mozilla/5.0', null, false) as result;`);
  assertEqual(bad.result.valid, false, 'invalid token view is rejected');
  assertEqual(bad.result.reason, 'invalid_token', 'invalid token reason');

  console.log('PASS quote email claim/mark, 3-day follow-up dedupe, scanner exclusion, valid-view stop');
} finally {
  if (quoteUuid) {
    await sql(`delete from public.bwf_quote where id = '${quoteUuid}';`).catch((error) => {
      console.error('cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }
}

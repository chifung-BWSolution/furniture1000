#!/usr/bin/env node
/**
 * FDS-15 online failure/retry check (FDS 2.0 develop branch only).
 *
 * With no email provider configured, the deployed worker must:
 *   claim the message → fail to send → put it back in the queue with attempts=1
 *   and keep the error, instead of claiming success.
 *
 * Creates and removes its own quote/message. No email is sent.
 *
 *   node scripts/test-quote-email-retry-live.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = `FDS15-RETRY-${Date.now()}`;
const TOKEN = `fds15retry${Date.now().toString(36)}`;

function readEnv() {
  const text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const get = (key) => text.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? '';
  return {
    access: get('SUPABASE_ACCESS_TOKEN'),
    url: get('VITE_SUPABASE_URL').replace(/\/$/, ''),
  };
}

const env = readEnv();

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

const [secretRow] = await sql("select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret'");
const workerSecret = secretRow?.decrypted_secret;
if (!workerSecret) throw new Error('worker secret missing');

let quoteUuid = null;

try {
  const [created] = await sql(`
    insert into public.bwf_quote (quote_id, version, status, total_amount, submitter, project_data)
    values ('${TAG}', 'v1', '測試', 1000, 'FDS15 測試', '{"formData":{"projectManager":"FDS15 測試"}}'::jsonb)
    returning id;
  `);
  quoteUuid = created.id;

  await sql(`
    insert into public.bwf_quote_item (quote_uuid, sort_order, client_item_id, name, unit_price, quantity, unit)
    values ('${quoteUuid}', 1, 'a', '員工椅', 500, 2, 'PC');
    insert into public.bwf_quote_share_links (quote_uuid, quote_id, share_token, status)
    values ('${quoteUuid}', '${TAG}', '${TOKEN}', 'active');
    insert into public.bwf_quote_email_template (quote_uuid, intro_text, contact_phone)
    values ('${quoteUuid}', '測試引言', '+852 9000 0000');
    insert into public.bwf_quote_email_settings (quote_uuid, status, recipient_email)
    values ('${quoteUuid}', 'not_sent', 'retry-test@example.com');
    insert into public.bwf_quote_email_message (quote_uuid, kind, to_email, status, scheduled_for)
    values ('${quoteUuid}', 'manual', 'retry-test@example.com', 'queued', now());
  `);

  const res = await fetch(`${env.url}/functions/v1/send-quote-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-secret': workerSecret },
    body: JSON.stringify({ limit: 5 }),
  });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`worker ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);

  const mine = (body.results ?? []).find((row) => row.id);
  if (!mine) throw new Error(`worker did not claim the test message: ${JSON.stringify(body).slice(0, 300)}`);

  const [state] = await sql(`
    select status, attempts, error, sent_at
      from public.bwf_quote_email_message
     where quote_uuid = '${quoteUuid}' and kind = 'manual';
  `);
  if (state.status !== 'queued') throw new Error(`expected queued for retry, got ${state.status}`);
  if (state.attempts !== 1) throw new Error(`expected attempts=1, got ${state.attempts}`);
  if (!state.error || !/not configured|RESEND|SMTP/i.test(state.error)) {
    throw new Error(`expected a provider-missing error, got: ${state.error}`);
  }
  if (state.sent_at) throw new Error('sent_at must stay empty when sending failed');

  console.log(`PASS worker retries instead of pretending to send: status=${state.status} attempts=${state.attempts} error=${state.error.slice(0, 60)}`);
} finally {
  if (quoteUuid) {
    await sql(`delete from public.bwf_quote where id = '${quoteUuid}';`).catch((error) => {
      console.error('cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }
}

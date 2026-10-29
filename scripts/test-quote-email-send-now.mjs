#!/usr/bin/env node
/**
 * FDS-15 real send test (develop branch only).
 * Creates a clearly-labelled test quote, queues one email to the given test inbox,
 * runs the deployed worker, and reports the provider result. The quote is kept so
 * the recipient can open the share link; delete it with the printed id when done.
 */
import fs from 'node:fs';
import path from 'node:path';

const REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = `FDS15-SEND-TEST-${Date.now()}`;
const TOKEN = `fds15send${Date.now().toString(36)}`;
const TO = 'cfb.app02@chifung.net';

const text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const get = (key) => text.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? '';
const sb = get('SUPABASE_ACCESS_TOKEN');
const baseUrl = get('VITE_SUPABASE_URL').replace(/\/$/, '');

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sb}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : [];
}

// 1. config presence (values are hashed by the API; only presence is checked)
const secrets = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  headers: { Authorization: `Bearer ${sb}` },
}).then((r) => r.json());
const names = new Set((secrets || []).map((row) => row.name));
console.log('secrets', {
  RESEND_API_KEY: names.has('RESEND_API_KEY'),
  FDS_EMAIL_FROM: names.has('FDS_EMAIL_FROM'),
  FDS_APP_URL: names.has('FDS_APP_URL'),
});
if (!names.has('RESEND_API_KEY') || !names.has('FDS_APP_URL')) {
  throw new Error('missing RESEND_API_KEY or FDS_APP_URL on the branch');
}

// 2. worker secret
const [secretRow] = await sql("select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret'");
const workerSecret = secretRow?.decrypted_secret;
if (!workerSecret) throw new Error('worker secret missing');

// 3. test quote
const [created] = await sql(`
  insert into public.bwf_quote (quote_id, version, status, total_amount, submitter, project_data)
  values ('${TAG}', 'v1', '測試', 1600, 'FDS15 發信測試', '{"formData":{"projectManager":"FDS15 發信測試"}}'::jsonb)
  returning id;
`);
const quoteUuid = created.id;

await sql(`
  insert into public.bwf_quote_item (quote_uuid, sort_order, client_item_id, name, unit_price, quantity, unit)
  values ('${quoteUuid}', 1, 'a', '員工椅', 800, 2, 'PC');
  insert into public.bwf_quote_share_links (quote_uuid, quote_id, share_token, status)
  values ('${quoteUuid}', '${TAG}', '${TOKEN}', 'active');
  insert into public.bwf_quote_email_template (quote_uuid, intro_text, contact_phone)
  values ('${quoteUuid}', '這是 FDS 發信測試，收到請回覆。', '+852 9000 0000');
  insert into public.bwf_quote_email_settings (quote_uuid, status, recipient_email)
  values ('${quoteUuid}', 'not_sent', '${TO}');
  insert into public.bwf_quote_email_message (quote_uuid, kind, to_email, status, scheduled_for)
  values ('${quoteUuid}', 'manual', '${TO}', 'queued', now());
`);

// 4. run worker
const res = await fetch(`${baseUrl}/functions/v1/send-quote-email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-worker-secret': workerSecret },
  body: JSON.stringify({ limit: 5 }),
});
const workerBody = await res.json().catch(() => null);
console.log('worker', res.status, JSON.stringify(workerBody).slice(0, 500));

const [message] = await sql(`
  select status, attempts, provider, provider_message_id, error, sent_at
    from public.bwf_quote_email_message
   where quote_uuid = '${quoteUuid}';
`);
const logs = await sql(`
  select status, provider, message_id, error_message
    from public.email_notification_logs
   where related_quote_id = '${TAG}'
   order by sent_at desc limit 1;
`);

console.log('message', JSON.stringify(message));
console.log('log', JSON.stringify(logs[0] ?? null));
console.log('quote_id', TAG, 'uuid', quoteUuid, 'share_token', TOKEN);

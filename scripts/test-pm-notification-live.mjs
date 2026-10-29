#!/usr/bin/env node
/**
 * FDS-14 real PM-notification test (develop branch only), sent to one test inbox.
 *
 * Covers both triggers:
 *   A. customer submits a scheme   → PM gets a "客戶提交" email
 *   B. customer opens the share link → PM gets a "客戶已查看" email
 *
 * Creates a temporary PM profile (so the quote's projectManager resolves to the
 * test inbox), two test quotes, then deletes everything. Emails go only to TO.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TO = 'cfb.app02@chifung.net';
const AUTH_UUID = crypto.randomUUID();
const TAG = `FDS14-PM-TEST-${Date.now()}`;
let pmName = '';

const text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const get = (key) => text.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? '';
const sb = get('SUPABASE_ACCESS_TOKEN');
const base = get('VITE_SUPABASE_URL').replace(/\/$/, '');
const anon = get('VITE_SUPABASE_ANON_KEY');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

async function rpc(name, body) {
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify(body),
  });
  const payload = await res.text();
  if (!res.ok) throw new Error(`${name} ${res.status}: ${payload.slice(0, 400)}`);
  return payload ? JSON.parse(payload) : null;
}

const [secretRow] = await sql("select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret'");
const workerSecret = secretRow?.decrypted_secret;

const created = [];
try {
  const [profile] = await sql(`
    select display_name, role from public.platform_user_profiles
     where email = '${TO}' and active is true limit 1
  `);
  if (!profile) throw new Error(`no active profile with email ${TO}`);
  if (!['pm', 'admin', 'uploader'].includes(String(profile.role))) {
    throw new Error(`profile role ${profile.role} cannot receive PM notifications`);
  }
  pmName = String(profile.display_name);
  console.log('pm', pmName, profile.role);

  async function makeQuote(label, token) {
    const [quote] = await sql(`
      insert into public.bwf_quote (quote_id, version, status, total_amount, submitter, project_data)
      values ('${TAG}-${label}', 'v1', '測試', 1600, '${pmName}', '{"formData":{"projectManager":"${pmName}"}}'::jsonb)
      returning id;
    `);
    created.push(quote.id);
    await sql(`
      insert into public.bwf_quote_item (quote_uuid, sort_order, client_item_id, name, unit_price, quantity, unit)
      values ('${quote.id}', 1, 'a', '員工椅', 800, 2, 'PC');
      insert into public.bwf_quote_share_links (quote_uuid, quote_id, share_token, status)
      values ('${quote.id}', '${TAG}-${label}', '${token}', 'active');
    `);
    return quote.id;
  }

  const tokenA = `fds14pmA${Date.now().toString(36)}`;
  const tokenB = `fds14pmB${Date.now().toString(36)}`;

  // A. customer submission
  const quoteA = await makeQuote('A', tokenA);
  await rpc('submit_customer_quote_request', {
    p_token: tokenA,
    p_quote_id: null,
    p_lines: [{ id: 'a', quantity: 3, selected: true, note: '想換淺色' }],
    p_note: '客戶提交測試（PM 通知）',
    p_idempotency_key: null,
    p_request_type: 'scheme',
  });

  // B. customer opens the share link (valid browser view)
  const tokenBValue = tokenB;
  const quoteB = await makeQuote('B', tokenBValue);
  await rpc('record_quote_share_view', {
    p_token: tokenBValue,
    p_user_agent: IPHONE,
    p_referer: 'https://mail.example.com/',
    p_force_invalid: false,
  });

  const res = await fetch(`${base}/functions/v1/notify-customer-quote-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-secret': workerSecret },
    body: JSON.stringify({ limit: 10 }),
  });
  console.log('worker', res.status, JSON.stringify(await res.json()).slice(0, 700));

  const states = await sql(`
    select
      (select pm_notified_at is not null from public.bwf_quote_customer_request where quote_uuid = '${quoteA}') as request_notified,
      (select pm_email from public.bwf_quote_customer_request where quote_uuid = '${quoteA}') as request_email,
      (select pm_notified_at is not null from public.bwf_quote_share_view where quote_uuid = '${quoteB}' and is_valid limit 1) as view_notified,
      (select count(*)::text from public.email_notification_logs where related_quote_id like '${TAG}%' and status = 'success') as logs
  `);
  console.log('states', JSON.stringify(states[0]));

  const logRows = await sql(`
    select notification_type, recipient, provider, status
      from public.email_notification_logs
     where related_quote_id like '${TAG}%'
     order by sent_at desc limit 5
  `);
  console.log('logs', JSON.stringify(logRows));
} finally {
  for (const id of created) {
    await sql(`delete from public.bwf_quote where id = '${id}';`).catch((error) => console.error('quote cleanup:', error.message));
  }
  // The test inbox already has a staff profile; keep it untouched.
}

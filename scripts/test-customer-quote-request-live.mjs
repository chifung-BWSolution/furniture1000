#!/usr/bin/env node
/**
 * FDS-14 live regression: customer submission must not rewrite the official quote.
 *
 * Runs only against the FDS 2.0 develop branch (omxizeukbcqzsnjsuwod) through the
 * Management API, creates its own throw-away quote + share link, and removes every
 * row it created. It never touches Production and never sends email.
 *
 *   node scripts/test-customer-quote-request-live.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = `FDS14-TEST-${Date.now()}`;
const TOKEN = `fds14test${Date.now().toString(36)}`;
const AUTH_UUID = crypto.randomUUID();
const STAFF_EMAIL = `fds14-test-${Date.now()}@example.invalid`;
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
  if (String(actual) !== String(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

let quoteUuid = '';

try {
  const [created] = await sql(`
    insert into public.bwf_quote (quote_id, version, status, total_amount, submitter, project_data)
    values ('${TAG}', 'v1', '測試', 5000, 'FDS14 測試', '{"formData":{"projectManager":"FDS14 測試"}}'::jsonb)
    returning id;
  `);
  quoteUuid = created.id;

  await sql(`
    insert into public.bwf_quote_item (quote_uuid, sort_order, client_item_id, name, unit_price, quantity, unit)
    values
      ('${quoteUuid}', 1, 'item-a', '員工椅', 800, 10, 'PC'),
      ('${quoteUuid}', 2, 'item-b', '會議桌', 1620, 2, 'PC');
    insert into public.bwf_quote_share_links (quote_uuid, quote_id, share_token, status)
    values ('${quoteUuid}', '${TAG}', '${TOKEN}', 'active');
  `);

  // Submit: quantity 3 of item-a, deselect item-b, with a customer note.
  const lines = JSON.stringify([
    { id: 'item-a', quantity: 3, selected: true, note: '想換淺色' },
    { id: 'item-b', quantity: 0, selected: false },
  ]).replace(/'/g, "''");

  const [first] = await sql(`
    select public.submit_customer_quote_request('${TOKEN}', null, '${lines}'::jsonb, '希望下月送貨', null, 'scheme') as id;
  `);
  const requestId = first.id;
  if (!requestId) throw new Error('submit did not return a request id');

  const [request] = await sql(`
    select quote_uuid, quote_id, lines, note, total_cents, share_link_id, idempotency_key, pm_name
    from public.bwf_quote_customer_request where id = '${requestId}';
  `);
  assertEqual(request.quote_uuid, quoteUuid, 'request quote relation');
  assertEqual(request.quote_id, TAG, 'request quote id snapshot');
  assertEqual(request.lines.length, 2, 'saved lines');
  assertEqual(request.lines[0].quantity, 3, 'saved quantity');
  assertEqual(request.lines[0].note, '想換淺色', 'saved line note');
  assertEqual(request.note, '希望下月送貨', 'saved customer note');
  // 3 × HK$800 = HK$2,400 → 240,000 cents for the customer's own selection.
  assertEqual(request.total_cents, 240000, 'customer selection total in cents');
  assertEqual(request.pm_name, 'FDS14 測試', 'pm name snapshot');
  if (!request.share_link_id) throw new Error('share link was not recorded');

  // Official quote must be untouched.
  const [quote] = await sql(`
    select total_amount::text as total,
           project_data->'clientQuoteScheme'->>'requestId' as scheme_request,
           project_data->'clientQuoteScheme'->'quantities'->>'item-a' as scheme_qty
    from public.bwf_quote where id = '${quoteUuid}';
  `);
  assertEqual(quote.total, '5000', 'official total_amount unchanged');
  assertEqual(quote.scheme_request, requestId, 'client scheme points at the request');
  assertEqual(quote.scheme_qty, '3', 'client scheme keeps the customer quantity');

  const items = await sql(`
    select client_item_id, quantity::text as quantity
    from public.bwf_quote_item where quote_uuid = '${quoteUuid}' order by sort_order;
  `);
  assertEqual(items[0].quantity, '10', 'official item quantity unchanged');
  assertEqual(items[1].quantity, '2', 'official item quantity unchanged (second line)');

  // Resending the same content must reuse the request, not create a second one.
  const [second] = await sql(`
    select public.submit_customer_quote_request('${TOKEN}', null, '${lines}'::jsonb, '希望下月送貨', null, 'scheme') as id;
  `);
  assertEqual(second.id, requestId, 'idempotent resubmission');
  const [countRow] = await sql(`
    select count(*)::text as c from public.bwf_quote_customer_request where quote_uuid = '${quoteUuid}';
  `);
  assertEqual(countRow.c, '1', 'only one request row after resend');

  // Cross-quote token use must be rejected.
  let rejected = false;
  try {
    await sql(`
      select public.submit_customer_quote_request('${TOKEN}', gen_random_uuid(), '${lines}'::jsonb, '', null, 'scheme');
    `);
  } catch (error) {
    rejected = /invalid_token|42501/.test(String(error.message));
  }
  if (!rejected) throw new Error('cross-quote submission was not rejected');

  // --- PM view and handling --------------------------------------------
  await sql(`
    insert into public.platform_user_profiles (email, auth_user_id, display_name, role, active, source)
    values ('${STAFF_EMAIL}', '${AUTH_UUID}', 'FDS14 測試PM', 'pm', true, 'pms');
  `);

  const [listed] = await sql(`
    select set_config('request.jwt.claims', '${CLAIMS}', false);
    select public.fds_quote_customer_requests('${quoteUuid}', 20) as rows;
  `);
  const requests = listed.rows;
  assertEqual(requests.length, 1, 'PM sees exactly one submission');
  assertEqual(requests[0].id, requestId, 'listed request id');
  assertEqual(requests[0].status, 'submitted', 'listed status');
  assertEqual(requests[0].lines.length, 2, 'listed lines');
  assertEqual(requests[0].lines[0].quantity, 3, 'listed quantity');
  assertEqual(requests[0].note, '希望下月送貨', 'listed note');
  assertEqual(requests[0].total_cents, 240000, 'listed reference total');

  await sql(`
    select set_config('request.jwt.claims', '${CLAIMS}', false);
    select public.fds_quote_customer_request_set_status('${requestId}', 'acknowledged');
  `);
  const [afterStatus] = await sql(`
    select status from public.bwf_quote_customer_request where id = '${requestId}';
  `);
  assertEqual(afterStatus.status, 'acknowledged', 'status updated by PM');

  let invalidStatus = false;
  try {
    await sql(`
      select set_config('request.jwt.claims', '${CLAIMS}', false);
      select public.fds_quote_customer_request_set_status('${requestId}', 'done');
    `);
  } catch (error) {
    invalidStatus = String(error.body ?? error.message).includes('invalid_status');
  }
  if (!invalidStatus) throw new Error('invalid request status was accepted');

  let nonStaffDenied = false;
  try {
    await sql(`
      select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
      select public.fds_quote_customer_requests('${quoteUuid}', 20);
    `);
  } catch (error) {
    nonStaffDenied = /permission_denied|42501/.test(String(error.body ?? error.message));
  }
  if (!nonStaffDenied) throw new Error('non staff read the customer requests');

  // The submission status never changes official quote numbers.
  const [official] = await sql(`
    select total_amount::text as total,
           (select string_agg(quantity::text, ',' order by sort_order) from public.bwf_quote_item where quote_uuid = '${quoteUuid}') as quantities
      from public.bwf_quote where id = '${quoteUuid}';
  `);
  assertEqual(official.total, '5000', 'official total still unchanged after PM handling');
  assertEqual(official.quantities, '10,2', 'official quantities still unchanged after PM handling');

  console.log('PASS customer submission recorded separately, official quote untouched, resend idempotent, cross-quote rejected, PM can view and handle');
} finally {
  if (quoteUuid) {
    // Cascades remove items, share links and customer requests.
    await sql(`delete from public.bwf_quote where id = '${quoteUuid}';`).catch((error) => {
      console.error('cleanup failed:', error.message);
      process.exitCode = 1;
    });
  }
  await sql(`delete from public.platform_user_profiles where auth_user_id = '${AUTH_UUID}';`).catch((error) => {
    console.error('profile cleanup failed:', error.message);
    process.exitCode = 1;
  });
}

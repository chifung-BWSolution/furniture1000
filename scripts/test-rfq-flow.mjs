#!/usr/bin/env node
/**
 * FDS Supplier RFQ section 7-9 live test (branch only; everything rolls back).
 *
 * Proves, with a real Postgres session and JWT claims impersonation:
 *   - draft can change currency; after publish currency is locked
 *   - publish needs close / items / invitations
 *   - sealed detail JSON has no bid unit price, history catalogue price remains
 *   - award before reveal is rejected
 *   - 0 is a valid price; blank / no_quote-only / negative are handled
 *   - idempotency key returns the same receipt and version
 *   - A token cannot read B prices; designer detail is rejected
 *   - line A to A, line B to B, line C no-award; header awarded only at the end
 *   - award writes nothing to supplier_prices or bwf_quote_item
 *   - cancel blocks submission and keeps the award snapshot
 *   - reopen returns the line to open and keeps the old award
 *   - revise bumps revision, old token fails, old submission cannot be awarded
 *
 *   node scripts/test-rfq-flow.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = Date.now().toString(36);

const PM_EMAIL = `fds-rfq-pm-${TAG}@example.invalid`;
const ADMIN_EMAIL = `fds-rfq-admin-${TAG}@example.invalid`;
const DESIGNER_EMAIL = `fds-rfq-designer-${TAG}@example.invalid`;
const FACTORY_A = `rfq-factory-a-${TAG}`;
const FACTORY_B = `rfq-factory-b-${TAG}`;
const FACTORY_C = `rfq-factory-c-${TAG}`;

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
  if (!res.ok) throw new Error(`SQL failed: ${text.slice(0, 4000)}`);
  return text ? JSON.parse(text) : [];
}

const sqlText = `
begin;

insert into public.platform_user_profiles (auth_user_id, email, role, active, display_name)
values
  ('a1111111-1111-4111-8111-111111111111', '${PM_EMAIL}', 'pm', true, 'RFQ test pm'),
  ('a2222222-2222-4222-8222-222222222222', '${ADMIN_EMAIL}', 'admin', true, 'RFQ test admin'),
  ('a3333333-3333-4333-8333-333333333333', '${DESIGNER_EMAIL}', 'designer', true, 'RFQ test designer');

-- Test product + catalogue price from factory A (history must stay visible while sealed).
do $$
declare
  v_product text;
begin
  select id into v_product from public.products order by created_at desc nulls last limit 1;
  if v_product is null then
    raise exception 'no product available for the catalogue-price check';
  end if;
  perform set_config('fds.rfq.product', v_product, true);
  insert into public.supplier_prices (
    product_id, factory_id, factory_name, currency, unit, cost_price, verified, quote_year
  ) values (
    v_product, '${FACTORY_A}', 'A 廠', 'CNY', '件', 88, true, 2026
  );
  perform set_config('fds.rfq.sp_count', (select count(*)::text from public.supplier_prices), true);
  perform set_config('fds.rfq.qi_count', (select count(*)::text from public.bwf_quote_item), true);
end $$;

-- PM creates and publishes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","email":"${PM_EMAIL}","role":"authenticated"}';

do $$
declare
  v_payload jsonb;
  v_items jsonb;
  v_no_inv jsonb;
  v_no_items jsonb;
  v_no_close jsonb;
  v jsonb;
  v_id uuid;
  v_draft2 uuid;
  v_draft3 uuid;
  v_draft4 uuid;
  v_rev integer;
  v_a_id uuid;
  v_b_id uuid;
  v_link_a jsonb;
  v_link_b jsonb;
begin
  -- Publish validation: no invitations / no items / no close.
  v_no_inv := jsonb_build_object(
    'title', '無廠家', 'currency', 'CNY', 'close_at', now() + interval '1 day',
    'items', jsonb_build_array(jsonb_build_object('name', 'A', 'quantity', 1)),
    'invitations', '[]'::jsonb
  );
  v := public.fds_rfq_save_draft(null, v_no_inv);
  v_draft2 := (v->>'id')::uuid;
  begin
    perform public.fds_rfq_publish(v_draft2);
    raise exception 'publish accepted without invitations';
  exception when others then
    if sqlerrm <> 'invitation_required' then raise; end if;
  end;

  v_no_items := jsonb_build_object(
    'title', '無行', 'currency', 'CNY', 'close_at', now() + interval '1 day',
    'items', '[]'::jsonb,
    'invitations', jsonb_build_array(jsonb_build_object('factory_id', '${FACTORY_A}', 'factory_name', 'A 廠'))
  );
  v := public.fds_rfq_save_draft(null, v_no_items);
  v_draft3 := (v->>'id')::uuid;
  begin
    perform public.fds_rfq_publish(v_draft3);
    raise exception 'publish accepted without items';
  exception when others then
    if sqlerrm <> 'items_required' then raise; end if;
  end;

  v_no_close := v_no_items || jsonb_build_object(
    'close_at', null,
    'items', jsonb_build_array(jsonb_build_object('name', 'A', 'quantity', 1))
  );
  v := public.fds_rfq_save_draft(null, v_no_close);
  v_draft4 := (v->>'id')::uuid;
  begin
    perform public.fds_rfq_publish(v_draft4);
    raise exception 'publish accepted without close_at';
  exception when others then
    if sqlerrm <> 'close_required' then raise; end if;
  end;

  -- Real draft: three lines, two factories.
  v_items := jsonb_build_array(
    jsonb_build_object(
      'name', '沙發 A', 'model', 'A-1', 'quantity', 2, 'unit', '件',
      'specifications', '布藝', 'dimensions', '2000x900x800',
      'product_id', current_setting('fds.rfq.product')
    ),
    jsonb_build_object(
      'name', '餐檯 B', 'model', 'B-1', 'quantity', 1, 'unit', '張',
      'specifications', '實木', 'dimensions', '1600x900x750'
    ),
    jsonb_build_object(
      'name', '椅子 C', 'model', 'C-1', 'quantity', 3, 'unit', '張',
      'specifications', '曲木'
    )
  );
  v_payload := jsonb_build_object(
    'title', 'RFQ 測試 ${TAG}', 'currency', 'CNY',
    'close_at', now() + interval '2 days', 'notes', 'rollback test',
    'items', v_items,
    'invitations', jsonb_build_array(
      jsonb_build_object('factory_id', '${FACTORY_A}', 'factory_name', 'A 廠'),
      jsonb_build_object('factory_id', '${FACTORY_B}', 'factory_name', 'B 廠')
    )
  );

  v := public.fds_rfq_save_draft(null, v_payload);
  v_id := (v->>'id')::uuid;
  perform set_config('fds.rfq.id', v_id::text, true);
  if (v->>'rfq_no') !~ '^RFQ-[0-9]{4}-[0-9]{4}$' then
    raise exception 'bad rfq_no %', v->>'rfq_no';
  end if;

  -- Draft can still change currency.
  v := public.fds_rfq_save_draft(v_id, v_payload || jsonb_build_object('currency', 'USD'));
  v := public.fds_rfq_save_draft(v_id, v_payload || jsonb_build_object('currency', 'CNY'));

  -- Items / invitations exist before publish.
  v := public.fds_rfq_detail(v_id);
  if (v->'counts'->>'item_count')::int <> 3 then
    raise exception 'draft did not save three items';
  end if;

  perform public.fds_rfq_publish(v_id);

  -- Published: draft edit is rejected.
  begin
    perform public.fds_rfq_save_draft(v_id, v_payload);
    raise exception 'saved a draft after publish';
  exception when others then
    if sqlerrm <> 'rfq_not_draft' then raise; end if;
  end;

  -- Adding one factory does not bump the revision.
  v := public.fds_rfq_detail(v_id);
  v_rev := (v->'rfq'->>'revision')::int;
  perform public.fds_rfq_invite_factory(v_id, '${FACTORY_C}', 'C 廠');
  v := public.fds_rfq_detail(v_id);
  if (v->'rfq'->>'revision')::int <> v_rev then
    raise exception 'inviting one factory bumped the revision';
  end if;

  -- Currency is frozen after publish.
  begin
    perform public.fds_rfq_revise(v_id, jsonb_build_object(
      'currency', 'HKD', 'close_at', now() + interval '3 days', 'items', v_items));
    raise exception 'changed currency after publish';
  exception when others then
    if sqlerrm <> 'currency_locked' then raise; end if;
  end;

  v := public.fds_rfq_detail(v_id);
  select
    (select (x->>'id')::uuid from jsonb_array_elements(v->'invitations') x
      where x->>'factory_id' = '${FACTORY_A}'),
    (select (x->>'id')::uuid from jsonb_array_elements(v->'invitations') x
      where x->>'factory_id' = '${FACTORY_B}')
  into v_a_id, v_b_id;

  v_link_a := public.fds_rfq_issue_link(v_a_id);
  v_link_b := public.fds_rfq_issue_link(v_b_id);
  perform set_config('fds.rfq.token_a', v_link_a->>'token', true);
  perform set_config('fds.rfq.token_b', v_link_b->>'token', true);

  -- Item ids for the anonymous token calls.
  perform set_config('fds.rfq.item1', (select (x->>'id') from jsonb_array_elements(v->'items') x
    where (x->>'sort_order')::int = 1), true);
  perform set_config('fds.rfq.item2', (select (x->>'id') from jsonb_array_elements(v->'items') x
    where (x->>'sort_order')::int = 2), true);
  perform set_config('fds.rfq.item3', (select (x->>'id') from jsonb_array_elements(v->'items') x
    where (x->>'sort_order')::int = 3), true);

  -- Sealed internal detail: catalogue history stays, no bid price anywhere.
  if (v->'rfq'->>'revealed')::boolean then
    raise exception 'detail is revealed before close';
  end if;
  if position('"unit_price"' in v::text) > 0 then
    raise exception 'sealed detail leaked a unit_price key';
  end if;
  if position('"total_amount"' in v::text) > 0 then
    raise exception 'sealed detail leaked a total_amount key';
  end if;
  if jsonb_array_length(v->'catalog_prices') = 0 then
    raise exception 'sealed detail lost the historical catalogue price';
  end if;
end $$;

-- Anonymous token page.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v_open jsonb;
  v_submit jsonb;
  v_again jsonb;
  v_token_a text := current_setting('fds.rfq.token_a');
  v_token_b text := current_setting('fds.rfq.token_b');
  v_item1 uuid := current_setting('fds.rfq.item1')::uuid;
  v_item2 uuid := current_setting('fds.rfq.item2')::uuid;
  v_item3 uuid := current_setting('fds.rfq.item3')::uuid;
begin
  v_open := public.fds_rfq_open_by_token(v_token_a);
  if v_open->'invitation'->>'factory_id' <> '${FACTORY_A}' then
    raise exception 'token opened the wrong factory';
  end if;
  if position('${FACTORY_B}' in v_open::text) > 0 then
    raise exception 'token A saw factory B';
  end if;
  if coalesce((v_open->'can_submit')::boolean, false) is not true then
    raise exception 'token cannot submit before close';
  end if;

  -- 0 is a valid price; blank / missing lines are simply not quoted.
  v_submit := public.fds_rfq_submit_by_token(
    v_token_a,
    jsonb_build_array(
      jsonb_build_object('rfq_item_id', v_item1, 'unit_price', 0, 'no_quote', false,
        'lead_time_days', 20, 'validity_days', 30, 'moq', 1, 'note', 'A 第一版'),
      jsonb_build_object('rfq_item_id', v_item3, 'no_quote', true)
    ),
    '${TAG}-a@example.invalid',
    'idem-a-${TAG}'
  );
  if (v_submit->>'version')::int <> 1 then
    raise exception 'first submission was not version 1: %', v_submit;
  end if;
  perform set_config('fds.rfq.receipt_a', v_submit->>'receipt_code', true);
  perform set_config('fds.rfq.sub_a', v_submit->>'id', true);

  -- Same idempotency key, different body: same receipt, same version.
  v_again := public.fds_rfq_submit_by_token(
    v_token_a,
    jsonb_build_array(jsonb_build_object('rfq_item_id', v_item1, 'unit_price', 999)),
    '${TAG}-a@example.invalid',
    'idem-a-${TAG}'
  );
  if (v_again->>'version')::int <> 1
    or (v_again->>'receipt_code') <> (v_submit->>'receipt_code')
    or coalesce((v_again->>'duplicate')::boolean, false) is not true then
    raise exception 'idempotent retry created a new version: %', v_again;
  end if;

  begin
    perform public.fds_rfq_submit_by_token(
      v_token_a,
      jsonb_build_array(jsonb_build_object('rfq_item_id', v_item1, 'unit_price', -5)),
      '${TAG}-a@example.invalid',
      'neg-${TAG}'
    );
    raise exception 'negative price was accepted';
  exception when others then
    if sqlerrm <> 'negative_price' then raise; end if;
  end;

  begin
    perform public.fds_rfq_submit_by_token(
      v_token_a,
      jsonb_build_array(jsonb_build_object('rfq_item_id', v_item1, 'no_quote', true)),
      '${TAG}-a@example.invalid',
      'empty-${TAG}'
    );
    raise exception 'empty submission was accepted';
  exception when others then
    if sqlerrm <> 'empty_submission' then raise; end if;
  end;

  -- Factory B submits a distinctive price on every line.
  v_submit := public.fds_rfq_submit_by_token(
    v_token_b,
    jsonb_build_array(
      jsonb_build_object('rfq_item_id', v_item1, 'unit_price', 987654),
      jsonb_build_object('rfq_item_id', v_item2, 'unit_price', 200),
      jsonb_build_object('rfq_item_id', v_item3, 'unit_price', 300)
    ),
    '${TAG}-b@example.invalid',
    'idem-b-${TAG}'
  );
  perform set_config('fds.rfq.submission_b', (v_submit->>'id'), true);
  perform set_config('fds.rfq.sub_b', (v_submit->>'id'), true);
end $$;

-- PM sees the seal; admin reveals; line awards.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","email":"${PM_EMAIL}","role":"authenticated"}';

do $$
declare
  v_id uuid := current_setting('fds.rfq.id')::uuid;
  v_item1 uuid := current_setting('fds.rfq.item1')::uuid;
  v_sub_a uuid := current_setting('fds.rfq.sub_a')::uuid;
  v jsonb;
begin
  v := public.fds_rfq_detail(v_id);
  if (select count(*) from jsonb_array_elements(v->'invitations')) <> 3 then
    raise exception 'three factories were not invited';
  end if;
  if (select quoted_item_count from jsonb_to_recordset(v->'invitations')
      as x(factory_id text, quoted_item_count int) where factory_id = '${FACTORY_A}') <> 1 then
    raise exception 'factory A quoted-item count is wrong while sealed';
  end if;
  if (select quoted_item_count from jsonb_to_recordset(v->'invitations')
      as x(factory_id text, quoted_item_count int) where factory_id = '${FACTORY_B}') <> 3 then
    raise exception 'factory B quoted-item count is wrong while sealed';
  end if;

  -- Sealed: award is refused.
  begin
    perform public.fds_rfq_award_line(v_id, v_item1, v_sub_a, 'test');
    raise exception 'award before reveal was accepted';
  exception when others then
    if sqlerrm <> 'sealed' then raise; end if;
  end;

  -- Reopen is admin-only; PM is refused.
  begin
    perform public.fds_rfq_reopen_line(v_id, v_item1, 'test');
    raise exception 'pm reopened a line';
  exception when others then
    if sqlerrm <> 'permission_denied' then raise; end if;
  end;
end $$;

set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","email":"${ADMIN_EMAIL}","role":"authenticated"}';

do $$
declare
  v_id uuid := current_setting('fds.rfq.id')::uuid;
  v_item1 uuid := current_setting('fds.rfq.item1')::uuid;
  v_item2 uuid := current_setting('fds.rfq.item2')::uuid;
  v_item3 uuid := current_setting('fds.rfq.item3')::uuid;
  v_sub_a uuid;
  v_sub_b uuid;
  v jsonb;
  v_status text;
begin
  begin
    perform public.fds_rfq_reveal(v_id, '');
    raise exception 'reveal without reason was accepted';
  exception when others then
    if sqlerrm <> 'reason_required' then raise; end if;
  end;

  perform public.fds_rfq_reveal(v_id, '測試提前揭標');

  v_sub_a := current_setting('fds.rfq.sub_a')::uuid;
  v_sub_b := current_setting('fds.rfq.sub_b')::uuid;
  perform set_config('fds.rfq.sub_a', v_sub_a::text, true);
  perform set_config('fds.rfq.sub_b', v_sub_b::text, true);

  v := public.fds_rfq_detail(v_id);
  if not (v->'rfq'->>'revealed')::boolean then
    raise exception 'detail still sealed after reveal';
  end if;
  if position('"total_amount"' in v::text) = 0 then
    raise exception 'revealed detail has no totals';
  end if;

  -- Line 1 to factory A (price 0 is valid), line 2 to factory B.
  perform public.fds_rfq_award_line(v_id, v_item1, v_sub_a, 'A 廠中標');
  perform public.fds_rfq_award_line(v_id, v_item2, v_sub_b, 'B 廠中標');

  v := public.fds_rfq_detail(v_id);
  v_status := v->'rfq'->>'status';
  if v_status = 'awarded' then
    raise exception 'header turned awarded before every line ended';
  end if;

  perform public.fds_rfq_no_award_line(v_id, v_item3, 'C 行不採購');

  v := public.fds_rfq_detail(v_id);
  v_status := v->'rfq'->>'status';
  if v_status <> 'awarded' then
    raise exception 'header did not turn awarded: %', v_status;
  end if;
  if jsonb_array_length(v->'awards') <> 2 then
    raise exception 'expected two active awards';
  end if;
end $$;

-- Award must not close the link: a new supplier version is still accepted before close.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v_token_b text := current_setting('fds.rfq.token_b');
  v_item1 uuid := current_setting('fds.rfq.item1')::uuid;
  v jsonb;
  v_open jsonb;
begin
  v_open := public.fds_rfq_open_by_token(v_token_b);
  if coalesce((v_open->'can_submit')::boolean, false) is not true then
    raise exception 'awarded rfq closed the link before the deadline';
  end if;
  v := public.fds_rfq_submit_by_token(
    v_token_b,
    jsonb_build_array(jsonb_build_object('rfq_item_id', v_item1, 'unit_price', 999)),
    '${TAG}-b@example.invalid',
    'post-award-${TAG}'
  );
  if (v->>'version')::int <> 2 then
    raise exception 'post-award submission did not create version 2: %', v;
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","email":"${ADMIN_EMAIL}","role":"authenticated"}';

do $$
declare
  v_id uuid := current_setting('fds.rfq.id')::uuid;
  v_item1 uuid := current_setting('fds.rfq.item1')::uuid;
  v_item2 uuid := current_setting('fds.rfq.item2')::uuid;
  v_sub_b uuid;
  v jsonb;
  v_status text;
begin
  -- The award stays with A even though B submitted a newer version.
  v := public.fds_rfq_detail(v_id);
  if (
    select x->'award'->>'factory_id'
    from jsonb_array_elements(v->'items') x
    where (x->>'sort_order')::int = 1
  ) <> '${FACTORY_A}' then
    raise exception 'a post-award submission changed the award';
  end if;
  if (
    select max((x->>'version')::int)
    from jsonb_array_elements(v->'submissions') x
    where x->>'factory_id' = '${FACTORY_B}'
  ) <> 2 then
    raise exception 'post-award submission is not in the comparison';
  end if;
  select (x->>'id')::uuid into v_sub_b
  from jsonb_array_elements(v->'submissions') x
  where x->>'factory_id' = '${FACTORY_B}' and (x->>'version')::int = 2;

  -- Reopening line 1 keeps the old award in history and puts the line back.
  perform public.fds_rfq_reopen_line(v_id, v_item1, '重新考慮 A 行');
  v := public.fds_rfq_detail(v_id);
  if (select x->>'resolution' from jsonb_array_elements(v->'items') x
      where (x->>'sort_order')::int = 1) <> 'open' then
    raise exception 'reopened line is not open';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v->'events') e
    where e->>'event_type' = 'line_reopened'
  ) then
    raise exception 'reopen event missing';
  end if;
  v_status := v->'rfq'->>'status';
  if v_status <> 'open' then
    raise exception 'header did not return to open before close: %', v_status;
  end if;

  -- Re-award line 1 to B's latest version, then cancel.
  perform public.fds_rfq_award_line(v_id, v_item1, v_sub_b, '改由 B 廠');
  perform public.fds_rfq_cancel(v_id, '測試取消');
end $$;

-- Cancel blocks the link; award snapshot survives.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v_token_a text := current_setting('fds.rfq.token_a');
  v_item1 uuid := current_setting('fds.rfq.item1')::uuid;
begin
  begin
    perform public.fds_rfq_open_by_token(v_token_a);
    raise exception 'cancelled token still opened';
  exception when others then
    if sqlerrm <> 'token_invalid' then raise; end if;
  end;
  begin
    perform public.fds_rfq_submit_by_token(
      v_token_a,
      jsonb_build_array(jsonb_build_object('rfq_item_id', v_item1, 'unit_price', 5)),
      '${TAG}-a@example.invalid',
      'cancel-${TAG}'
    );
    raise exception 'cancelled rfq still accepted a submission';
  exception when others then
    if sqlerrm <> 'token_invalid' then raise; end if;
  end;
end $$;

-- Revision: old token invalid, old submission not awardable.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","email":"${PM_EMAIL}","role":"authenticated"}';

do $$
declare
  v_payload jsonb;
  v jsonb;
  v_id uuid;
  v_inv_id uuid;
  v_token text;
  v_sub jsonb;
  v_item uuid;
  v_sub_old uuid;
begin
  v_payload := jsonb_build_object(
    'title', 'RFQ 修訂測試 ${TAG}', 'currency', 'CNY',
    'close_at', now() + interval '2 days',
    'items', jsonb_build_array(jsonb_build_object('name', '修訂前', 'quantity', 1, 'unit', '件')),
    'invitations', jsonb_build_array(jsonb_build_object('factory_id', '${FACTORY_A}', 'factory_name', 'A 廠'))
  );
  v := public.fds_rfq_save_draft(null, v_payload);
  v_id := (v->>'id')::uuid;
  perform set_config('fds.rfq.rev_id', v_id::text, true);
  perform public.fds_rfq_publish(v_id);

  v := public.fds_rfq_detail(v_id);
  v_inv_id := (
    select (x->>'id')::uuid from jsonb_array_elements(v->'invitations') x
    where x->>'factory_id' = '${FACTORY_A}'
  );
  v_token := public.fds_rfq_issue_link(v_inv_id)->>'token';
  perform set_config('fds.rfq.rev_token_old', v_token, true);

  v_item := (public.fds_rfq_open_by_token(v_token)->'items'->0->>'id')::uuid;
  perform set_config('fds.rfq.rev_item_old', v_item::text, true);
  v_sub := public.fds_rfq_submit_by_token(
    v_token,
    jsonb_build_array(jsonb_build_object('rfq_item_id', v_item, 'unit_price', 500)),
    '${TAG}-a@example.invalid',
    'rev-${TAG}'
  );
  v_sub_old := (v_sub->>'id')::uuid;
  perform set_config('fds.rfq.rev_sub_old', v_sub_old::text, true);

  -- Revise: new line set, same factory, new revision.
  v := public.fds_rfq_revise(v_id, jsonb_build_object(
    'close_at', now() + interval '3 days',
    'items', jsonb_build_array(jsonb_build_object('name', '修訂後', 'quantity', 3, 'unit', '件'))
  ));
  if (v->>'revision')::int <> 2 then
    raise exception 'revise did not bump the revision: %', v;
  end if;

  -- Old token is dead (revise revokes it; either stable code is acceptable).
  begin
    perform public.fds_rfq_open_by_token(v_token);
    raise exception 'old token survived a revision';
  exception when others then
    if sqlerrm not in ('token_invalid', 'revision_mismatch') then raise; end if;
  end;

  -- Old submission survives in history but is not part of the new comparison.
  v := public.fds_rfq_detail(v_id);
  if jsonb_array_length(v->'submissions') <> 0 then
    raise exception 'old-revision submission leaked into comparison';
  end if;
  if jsonb_array_length(v->'history') = 0 then
    raise exception 'old submission disappeared from history';
  end if;

  -- New revision issues a working link.
  v := public.fds_rfq_detail(v_id);
  v_inv_id := (
    select (x->>'id')::uuid from jsonb_array_elements(v->'invitations') x
    where x->>'factory_id' = '${FACTORY_A}'
  );
  v_token := public.fds_rfq_issue_link(v_inv_id)->>'token';
  perform set_config('fds.rfq.rev_token_new', v_token, true);

  v_item := (public.fds_rfq_open_by_token(v_token)->'items'->0->>'id')::uuid;
  perform set_config('fds.rfq.rev_item_new', v_item::text, true);
end $$;

-- Old submission cannot be awarded after reveal (different revision).
set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","email":"${ADMIN_EMAIL}","role":"authenticated"}';
do $$
declare
  v_id uuid := current_setting('fds.rfq.rev_id')::uuid;
  v_item uuid := current_setting('fds.rfq.rev_item_new')::uuid;
  v_sub_old uuid := current_setting('fds.rfq.rev_sub_old')::uuid;
begin
  perform public.fds_rfq_reveal(v_id, '修訂測試揭標');
  begin
    perform public.fds_rfq_award_line(v_id, v_item, v_sub_old, '不應成功');
    raise exception 'old-revision submission was awarded';
  exception when others then
    if sqlerrm <> 'invalid_items' then raise; end if;
  end;
end $$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v_token text := current_setting('fds.rfq.rev_token_new');
  v_item uuid := current_setting('fds.rfq.rev_item_new')::uuid;
  v jsonb;
begin
  v := public.fds_rfq_submit_by_token(
    v_token,
    jsonb_build_array(jsonb_build_object('rfq_item_id', v_item, 'unit_price', 700)),
    '${TAG}-a@example.invalid',
    'rev-new-${TAG}'
  );
  if (v->>'version')::int <> 1 then
    raise exception 'new revision submission was not version 1: %', v;
  end if;
end $$;

-- Side effects, designer, snapshot.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3333333-3333-4333-8333-333333333333","email":"${DESIGNER_EMAIL}","role":"authenticated"}';

do $$
begin
  begin
    perform public.fds_rfq_detail(current_setting('fds.rfq.id')::uuid);
    raise exception 'designer read the RFQ detail';
  exception when others then
    if sqlerrm <> 'permission_denied' then raise; end if;
  end;
end $$;

reset role;
do $$
declare
  v_id uuid := current_setting('fds.rfq.id')::uuid;
begin
  if (select count(*)::text from public.supplier_prices) <> current_setting('fds.rfq.sp_count') then
    raise exception 'award wrote to supplier_prices';
  end if;
  if (select count(*)::text from public.bwf_quote_item) <> current_setting('fds.rfq.qi_count') then
    raise exception 'award wrote to bwf_quote_item';
  end if;

  if not exists (
    select 1 from public.fds_rfq_awards
    where rfq_id = v_id and status = 'cancelled'
  ) then
    raise exception 'cancel lost the award snapshot';
  end if;

  if not exists (
    select 1 from public.fds_rfq_events where rfq_id = v_id and event_type = 'cancelled'
  ) then
    raise exception 'cancel event missing';
  end if;

  -- 0 really stored as a price (not null / not skipped).
  if not exists (
    select 1 from public.fds_rfq_submission_items si
    join public.fds_rfq_submissions s on s.id = si.submission_id
    where s.rfq_id = v_id and s.factory_id = '${FACTORY_A}'
      and si.rfq_item_id = current_setting('fds.rfq.item1')::uuid
      and si.unit_price = 0 and si.no_quote = false
  ) then
    raise exception 'zero price was not stored';
  end if;

  -- Idempotent retry left one version, not two.
  if (select count(*) from public.fds_rfq_submissions
      where rfq_id = v_id and factory_id = '${FACTORY_A}') <> 1 then
    raise exception 'idempotent retry created a second submission';
  end if;
end $$;

select 'PASS supplier RFQ flow (branch, rolled back)';
rollback;
`;

try {
  const rows = await sql(sqlText);
  console.log(Object.values(rows[0] || {})[0] || rows);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

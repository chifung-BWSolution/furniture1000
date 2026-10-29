-- FDS-14 客戶互動報價：客戶提交「選品／數量／需求」時只寫入自己的提交記錄，
-- 絕不改寫正式報價的 bwf_quote_item 數量或 bwf_quote.total_amount。
-- 正式單價與明細只由 PM 確認後另行處理。
--
-- 每次提交保留：報價關聯、來源分享連結、選中產品、數量、需求、提交時間。
-- 同一報價 + 同一份內容（idempotency_key）只會有一筆，重送不會重複建立需求或通知。

create table if not exists public.bwf_quote_customer_request (
  id uuid primary key default gen_random_uuid(),
  quote_uuid uuid not null references public.bwf_quote (id) on delete cascade,
  quote_id text not null default '',
  share_link_id uuid references public.bwf_quote_share_links (id) on delete set null,
  request_type text not null default 'scheme'
    check (request_type in ('scheme', 'selection', 'quantity', 'additional', 'replacement')),
  lines jsonb not null default '[]'::jsonb,
  note text not null default '',
  -- 客戶自己看到的選品合計（以仙計），只作參考，不是正式報價金額。
  total_cents bigint not null default 0,
  status text not null default 'submitted'
    check (status in ('submitted', 'acknowledged', 'converted', 'declined')),
  idempotency_key text not null,
  submitted_at timestamptz not null default now(),
  pm_name text,
  pm_email text,
  pm_notified_at timestamptz,
  pm_notify_attempts integer not null default 0,
  pm_notify_error text,
  last_notify_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bwf_quote_customer_request_key_len check (char_length(idempotency_key) between 1 and 120),
  constraint bwf_quote_customer_request_note_len check (char_length(note) <= 1000),
  unique (quote_uuid, idempotency_key)
);

create index if not exists bwf_quote_customer_request_quote_idx
  on public.bwf_quote_customer_request (quote_uuid, submitted_at desc);

create index if not exists bwf_quote_customer_request_pending_idx
  on public.bwf_quote_customer_request (submitted_at)
  where pm_notified_at is null;

alter table public.bwf_quote_customer_request enable row level security;
revoke all on table public.bwf_quote_customer_request from public, anon, authenticated;
grant select on table public.bwf_quote_customer_request to authenticated;

drop policy if exists "bwf_quote_customer_request_select_staff" on public.bwf_quote_customer_request;
create policy "bwf_quote_customer_request_select_staff"
  on public.bwf_quote_customer_request
  for select
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

-- 客戶提交：只有 security definer 函式可以寫入，前端不能直接 insert／update。
create or replace function public.submit_customer_quote_request(
  p_token text,
  p_quote_id uuid,
  p_lines jsonb,
  p_note text default '',
  p_idempotency_key text default null,
  p_request_type text default 'scheme'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote uuid;
  v_from_token uuid;
  v_share_link uuid;
  v_note text;
  v_type text;
  v_lines jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_id text;
  v_qty numeric;
  v_selected boolean;
  v_line_note text;
  v_item record;
  v_total numeric := 0;
  v_selections jsonb := '{}'::jsonb;
  v_quantities jsonb := '{}'::jsonb;
  v_key text;
  v_request uuid;
  v_pd jsonb;
  v_pm_name text;
  v_pm_email text;
begin
  v_from_token := public.bwf_active_share_quote(p_token);
  if v_from_token is not null then
    if p_quote_id is not null and p_quote_id is distinct from v_from_token then
      raise exception 'invalid_token' using errcode = '42501';
    end if;
    v_quote := v_from_token;
    select l.id
      into v_share_link
      from public.bwf_quote_share_links l
     where l.share_token = btrim(p_token)
       and l.quote_uuid = v_quote
       and l.status = 'active'
     limit 1;
  elsif public.bwf_has_role(array['client', 'designer']) and p_quote_id is not null then
    v_quote := p_quote_id;
  else
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.bwf_quote q
     where q.id = v_quote
       and q.status is distinct from '回收桶'
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid_lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'too_many_lines' using errcode = '22023';
  end if;

  v_type := case
    when p_request_type in ('scheme', 'selection', 'quantity', 'additional', 'replacement')
      then p_request_type
    else 'scheme'
  end;
  v_note := left(btrim(coalesce(p_note, '')), 1000);

  for v_elem in select value from jsonb_array_elements(p_lines)
  loop
    v_id := left(btrim(coalesce(v_elem->>'id', '')), 80);
    if v_id = '' then
      continue;
    end if;
    begin
      v_qty := coalesce(nullif(v_elem->>'quantity', '')::numeric, 0);
    exception
      when others then
        raise exception 'invalid_quantity' using errcode = '22023';
    end;
    if v_qty < 0 or v_qty > 100000 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    v_selected := coalesce(v_elem->>'selected', '') in ('true', 't', '1');
    v_line_note := left(btrim(coalesce(v_elem->>'note', '')), 500);

    select
      it.id,
      it.name,
      it.unit,
      it.unit_price,
      coalesce(it.is_section_title, false) as is_section_title,
      coalesce(it.is_custom_term, false) as is_custom_term
      into v_item
      from public.bwf_quote_item it
     where it.quote_uuid = v_quote
       and (it.client_item_id = v_id or it.id::text = v_id)
       and coalesce(it.is_section_title, false) = false
     order by (it.client_item_id = v_id) desc
     limit 1;

    if not found then
      continue;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'itemId', v_item.id,
      'clientItemId', v_id,
      'name', v_item.name,
      'unit', v_item.unit,
      'unitPrice', v_item.unit_price,
      'quantity', v_qty,
      'selected', v_selected,
      'note', v_line_note
    ));
    v_selections := v_selections || jsonb_build_object(v_id, v_selected);
    v_quantities := v_quantities || jsonb_build_object(v_id, v_qty);
    if v_selected and not v_item.is_section_title and not v_item.is_custom_term then
      v_total := v_total + round(coalesce(v_item.unit_price, 0) * 100) * v_qty;
    end if;

    exit when jsonb_array_length(v_lines) >= 200;
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'empty_request' using errcode = '22023';
  end if;

  v_key := left(
    coalesce(
      nullif(btrim(coalesce(p_idempotency_key, '')), ''),
      md5(jsonb_build_object('lines', v_lines, 'note', v_note, 'type', v_type)::text)
    ),
    120
  );

  select nullif(btrim(coalesce(q.project_data->'formData'->>'projectManager', '')), '')
    into v_pm_name
    from public.bwf_quote q
   where q.id = v_quote;
  if v_pm_name is null then
    select nullif(btrim(q.submitter), '') into v_pm_name
      from public.bwf_quote q
     where q.id = v_quote;
  end if;
  if v_pm_name is not null then
    select p.email
      into v_pm_email
      from public.platform_user_profiles p
     where p.active
       and p.role in ('pm', 'admin', 'uploader')
       and lower(btrim(coalesce(p.display_name, ''))) = lower(v_pm_name)
     order by (p.role = 'pm') desc
     limit 1;
  end if;

  insert into public.bwf_quote_customer_request (
    quote_uuid, quote_id, share_link_id, request_type, lines, note,
    total_cents, idempotency_key, pm_name, pm_email
  )
  select
    v_quote,
    coalesce(q.quote_id, ''),
    v_share_link,
    v_type,
    v_lines,
    v_note,
    round(v_total)::bigint,
    v_key,
    v_pm_name,
    v_pm_email
    from public.bwf_quote q
   where q.id = v_quote
  on conflict (quote_uuid, idempotency_key) do nothing
  returning id into v_request;

  if v_request is null then
    select r.id
      into v_request
      from public.bwf_quote_customer_request r
     where r.quote_uuid = v_quote
       and r.idempotency_key = v_key
     limit 1;
  end if;

  if v_request is null then
    raise exception 'request_not_saved' using errcode = '22023';
  end if;

  -- 只記錄客戶自己的選擇，供客戶頁重新載入時還原；不動 items 與 total_amount。
  select case
           when jsonb_typeof(q.project_data) = 'object' then q.project_data
           else '{}'::jsonb
         end
    into v_pd
    from public.bwf_quote q
   where q.id = v_quote;

  update public.bwf_quote
     set project_data = coalesce(v_pd, '{}'::jsonb) || jsonb_build_object(
           'clientQuoteScheme', jsonb_build_object(
             'savedAt', now(),
             'submittedAt', now(),
             'selections', v_selections,
             'quantities', v_quantities,
             'requestId', v_request,
             'source', 'customer_request'
           )
         ),
         modified_date = now()
   where id = v_quote;

  return v_request;
end;
$$;

revoke all on function public.submit_customer_quote_request(text, uuid, jsonb, text, text, text) from public;
grant execute on function public.submit_customer_quote_request(text, uuid, jsonb, text, text, text) to anon, authenticated, service_role;

-- 舊 slug 保留同一個簽名（前端仍在用），但語意改為「提交客戶需求」：
-- 不再更新 bwf_quote_item.quantity 或 bwf_quote.total_amount。
create or replace function public.save_customer_quote_scheme(
  p_token text,
  p_quote_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.submit_customer_quote_request(p_token, p_quote_id, p_lines, '', null, 'scheme');
end;
$$;

revoke all on function public.save_customer_quote_scheme(text, uuid, jsonb) from public;
grant execute on function public.save_customer_quote_scheme(text, uuid, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

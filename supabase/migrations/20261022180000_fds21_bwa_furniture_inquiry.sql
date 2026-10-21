-- BWA → BWF furniture inquiry.
-- BWA PMs ask BWF's furniture department to price furniture lines taken from a
-- BWA engineering quotation. These tables have no cost, factory, or margin.
-- returned_unit_price is the selling price BWF formally sends back.
-- Role pm cannot read or write bwf_quote* (BWF internal quotes).
-- This file is not applied by the agent.

create table if not exists public.bwa_furniture_inquiry (
  id uuid primary key default gen_random_uuid(),
  bwa_project_ref text not null default '',
  bwa_project_name text not null default '',
  note text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'replied')),
  created_by uuid not null,
  sent_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bwa_furniture_inquiry_item (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.bwa_furniture_inquiry (id) on delete cascade,
  sort_order int not null default 0,
  name text not null default '',
  spec text not null default '',
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default '',
  returned_unit_price numeric check (returned_unit_price is null or returned_unit_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bwa_furniture_inquiry_created_by_idx
  on public.bwa_furniture_inquiry (created_by, created_at desc);

create index if not exists bwa_furniture_inquiry_item_inquiry_idx
  on public.bwa_furniture_inquiry_item (inquiry_id, sort_order);

comment on table public.bwa_furniture_inquiry is
  'Cross-organization request: a BWA PM asks BWF for a furniture quote. Not a bwf_quote.';

comment on column public.bwa_furniture_inquiry_item.returned_unit_price is
  'Selling price BWF formally returns. Null until BWF replies. Never cost, factory, or margin.';

alter table public.bwa_furniture_inquiry enable row level security;
alter table public.bwa_furniture_inquiry_item enable row level security;

revoke all on table public.bwa_furniture_inquiry from public, anon, authenticated;
revoke all on table public.bwa_furniture_inquiry_item from public, anon, authenticated;
grant select on table public.bwa_furniture_inquiry to authenticated;
grant select on table public.bwa_furniture_inquiry_item to authenticated;

drop policy if exists bwa_furniture_inquiry_select on public.bwa_furniture_inquiry;
create policy bwa_furniture_inquiry_select
  on public.bwa_furniture_inquiry
  for select
  to authenticated
  using (
    public.bwf_has_role(array['admin', 'uploader'])
    or (
      public.bwf_has_role(array['pm'])
      and created_by = auth.uid()
    )
  );

drop policy if exists bwa_furniture_inquiry_item_select on public.bwa_furniture_inquiry_item;
create policy bwa_furniture_inquiry_item_select
  on public.bwa_furniture_inquiry_item
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bwa_furniture_inquiry i
      where i.id = inquiry_id
        and (
          public.bwf_has_role(array['admin', 'uploader'])
          or (
            public.bwf_has_role(array['pm'])
            and i.created_by = auth.uid()
          )
        )
    )
  );

-- Writes go through the RPCs below. Triggers still reject a pm who reaches
-- these rows another way, including a security-definer quote function.

create or replace function public.bwa_inquiry_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pm boolean := public.bwf_has_role(array['pm']);
  v_bwf boolean := public.bwf_has_role(array['admin', 'uploader']);
begin
  if tg_op = 'INSERT' then
    if not v_pm or new.created_by is distinct from auth.uid() or new.status <> 'draft' then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    new.replied_at := null;
    new.sent_at := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_bwf then
      return old;
    end if;
    if v_pm and old.created_by = auth.uid() and old.status = 'draft' then
      return old;
    end if;
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if v_pm then
    if old.created_by is distinct from auth.uid() or old.status <> 'draft' then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (old.status = 'draft' and new.status = 'sent') then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.replied_at := null;
    return new;
  end if;

  if v_bwf then
    if old.status = 'draft' then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status <> 'replied' then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.bwa_project_ref := old.bwa_project_ref;
    new.bwa_project_name := old.bwa_project_name;
    new.note := old.note;
    new.sent_at := old.sent_at;
    return new;
  end if;

  raise exception 'permission_denied' using errcode = '42501';
end;
$$;

create or replace function public.bwa_inquiry_item_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pm boolean := public.bwf_has_role(array['pm']);
  v_bwf boolean := public.bwf_has_role(array['admin', 'uploader']);
  v_status text;
  v_owner uuid;
  v_inquiry uuid;
begin
  v_inquiry := case when tg_op = 'DELETE' then old.inquiry_id else new.inquiry_id end;
  select i.status, i.created_by
    into v_status, v_owner
  from public.bwa_furniture_inquiry i
  where i.id = v_inquiry;

  if tg_op = 'DELETE' then
    -- Parent already gone: this is the inquiry's ON DELETE CASCADE.
    if v_status is null or v_bwf or (v_pm and v_owner = auth.uid() and v_status = 'draft') then
      return old;
    end if;
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if v_pm then
    if v_owner is distinct from auth.uid() or v_status <> 'draft' then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if new.returned_unit_price is not null then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_bwf then
    if v_status = 'draft' then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      new.inquiry_id := old.inquiry_id;
      new.name := old.name;
      new.spec := old.spec;
      new.quantity := old.quantity;
      new.unit := old.unit;
      new.sort_order := old.sort_order;
    end if;
    return new;
  end if;

  raise exception 'permission_denied' using errcode = '42501';
end;
$$;

revoke all on function public.bwa_inquiry_guard() from public, anon, authenticated;
revoke all on function public.bwa_inquiry_item_guard() from public, anon, authenticated;

drop trigger if exists bwa_inquiry_guard on public.bwa_furniture_inquiry;
create trigger bwa_inquiry_guard
  before insert or update or delete on public.bwa_furniture_inquiry
  for each row
  execute function public.bwa_inquiry_guard();

drop trigger if exists bwa_inquiry_item_guard on public.bwa_furniture_inquiry_item;
create trigger bwa_inquiry_item_guard
  before insert or update or delete on public.bwa_furniture_inquiry_item
  for each row
  execute function public.bwa_inquiry_item_guard();

create or replace function public.bwa_reject_quote_keys(p_elem jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_elem ? 'cost_price'
    or p_elem ? 'hkd_cost_price'
    or p_elem ? 'exchange_rate'
    or p_elem ? 'factory_name'
    or p_elem ? 'factory'
    or p_elem ? 'margin'
    or p_elem ? 'gp'
    or p_elem ? 'returned_unit_price'
  then
    raise exception 'cost_not_accepted' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.bwa_reject_quote_keys(jsonb) from public, anon, authenticated;

create or replace function public.bwa_list_furniture_inquiries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pm boolean := public.bwf_has_role(array['pm']);
  v_bwf boolean := public.bwf_has_role(array['admin', 'uploader']);
begin
  if not v_pm and not v_bwf then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select
        i.id,
        i.bwa_project_ref,
        i.bwa_project_name,
        i.status,
        i.sent_at,
        i.replied_at,
        i.created_at,
        (
          select count(*)::int
          from public.bwa_furniture_inquiry_item it
          where it.inquiry_id = i.id
        ) as item_count,
        (
          select count(*)::int
          from public.bwa_furniture_inquiry_item it
          where it.inquiry_id = i.id
            and it.returned_unit_price is not null
        ) as returned_count
      from public.bwa_furniture_inquiry i
      where v_bwf or i.created_by = auth.uid()
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.bwa_get_furniture_inquiry(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pm boolean := public.bwf_has_role(array['pm']);
  v_bwf boolean := public.bwf_has_role(array['admin', 'uploader']);
  v_row public.bwa_furniture_inquiry%rowtype;
begin
  if p_id is null or (not v_pm and not v_bwf) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select *
    into v_row
  from public.bwa_furniture_inquiry i
  where i.id = p_id
    and (v_bwf or i.created_by = auth.uid());

  if not found then
    return 'null'::jsonb;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'bwa_project_ref', v_row.bwa_project_ref,
    'bwa_project_name', v_row.bwa_project_name,
    'note', v_row.note,
    'status', v_row.status,
    'sent_at', v_row.sent_at,
    'replied_at', v_row.replied_at,
    'created_at', v_row.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', it.id,
        'sort_order', it.sort_order,
        'name', it.name,
        'spec', it.spec,
        'quantity', it.quantity,
        'unit', it.unit,
        'returned_unit_price', it.returned_unit_price
      ) order by it.sort_order, it.created_at)
      from public.bwa_furniture_inquiry_item it
      where it.inquiry_id = v_row.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.bwa_save_furniture_inquiry(
  p_id uuid,
  p_project_ref text,
  p_project_name text,
  p_note text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  elem jsonb;
  idx int := 0;
  v_qty numeric;
begin
  perform public.bwf_assert_role(array['pm']);

  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if p_items is not null and jsonb_array_length(p_items) > 200 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.bwa_furniture_inquiry (
      bwa_project_ref,
      bwa_project_name,
      note,
      status,
      created_by
    ) values (
      left(coalesce(p_project_ref, ''), 120),
      left(coalesce(p_project_name, ''), 200),
      left(coalesce(p_note, ''), 2000),
      'draft',
      auth.uid()
    )
    returning id into v_id;
  else
    select i.status
      into v_status
    from public.bwa_furniture_inquiry i
    where i.id = p_id
      and i.created_by = auth.uid();
    if v_status is null or v_status <> 'draft' then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    update public.bwa_furniture_inquiry
      set bwa_project_ref = left(coalesce(p_project_ref, ''), 120),
          bwa_project_name = left(coalesce(p_project_name, ''), 200),
          note = left(coalesce(p_note, ''), 2000),
          updated_at = now()
    where id = p_id;
    delete from public.bwa_furniture_inquiry_item where inquiry_id = p_id;
    v_id := p_id;
  end if;

  if p_items is null then
    return v_id;
  end if;

  for elem in select value from jsonb_array_elements(p_items)
  loop
    perform public.bwa_reject_quote_keys(elem);
    begin
      v_qty := coalesce(nullif(elem->>'quantity', '')::numeric, 1);
    exception
      when others then
        raise exception 'invalid_quantity' using errcode = '22023';
    end;
    if v_qty < 0 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    insert into public.bwa_furniture_inquiry_item (
      inquiry_id,
      sort_order,
      name,
      spec,
      quantity,
      unit,
      returned_unit_price
    ) values (
      v_id,
      idx,
      left(coalesce(elem->>'name', ''), 200),
      left(coalesce(elem->>'spec', ''), 500),
      v_qty,
      left(coalesce(elem->>'unit', ''), 40),
      null
    );
    idx := idx + 1;
  end loop;

  return v_id;
end;
$$;

create or replace function public.bwa_send_furniture_inquiry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform public.bwf_assert_role(array['pm']);
  if p_id is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select count(*)::int
    into v_count
  from public.bwa_furniture_inquiry_item it
  join public.bwa_furniture_inquiry i on i.id = it.inquiry_id
  where it.inquiry_id = p_id
    and i.created_by = auth.uid()
    and i.status = 'draft'
    and btrim(it.name) <> '';

  if coalesce(v_count, 0) < 1 then
    raise exception 'need_items' using errcode = '22023';
  end if;

  update public.bwa_furniture_inquiry
    set status = 'sent',
        sent_at = now(),
        updated_at = now()
  where id = p_id
    and created_by = auth.uid()
    and status = 'draft';
end;
$$;

create or replace function public.bwf_reply_furniture_inquiry(
  p_id uuid,
  p_prices jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  elem jsonb;
  v_price numeric;
  v_item uuid;
  v_status text;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  if p_id is null or p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    raise exception 'invalid_prices' using errcode = '22023';
  end if;

  select i.status
    into v_status
  from public.bwa_furniture_inquiry i
  where i.id = p_id;

  if v_status is null or v_status = 'draft' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  for elem in select value from jsonb_array_elements(p_prices)
  loop
    if elem ? 'cost_price'
      or elem ? 'hkd_cost_price'
      or elem ? 'factory_name'
      or elem ? 'factory'
      or elem ? 'margin'
      or elem ? 'gp'
    then
      raise exception 'cost_not_accepted' using errcode = '22023';
    end if;
    begin
      v_item := (elem->>'id')::uuid;
      v_price := nullif(elem->>'returned_unit_price', '')::numeric;
    exception
      when others then
        raise exception 'invalid_prices' using errcode = '22023';
    end;
    if v_price is not null and v_price < 0 then
      raise exception 'invalid_prices' using errcode = '22023';
    end if;
    update public.bwa_furniture_inquiry_item
      set returned_unit_price = v_price,
          updated_at = now()
    where id = v_item
      and inquiry_id = p_id;
  end loop;

  update public.bwa_furniture_inquiry
    set status = 'replied',
        replied_at = now(),
        updated_at = now()
  where id = p_id
    and status in ('sent', 'replied');
end;
$$;

revoke all on function public.bwa_list_furniture_inquiries() from public, anon;
revoke all on function public.bwa_get_furniture_inquiry(uuid) from public, anon;
revoke all on function public.bwa_save_furniture_inquiry(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.bwa_send_furniture_inquiry(uuid) from public, anon;
revoke all on function public.bwf_reply_furniture_inquiry(uuid, jsonb) from public, anon;

grant execute on function public.bwa_list_furniture_inquiries() to authenticated;
grant execute on function public.bwa_get_furniture_inquiry(uuid) to authenticated;
grant execute on function public.bwa_save_furniture_inquiry(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.bwa_send_furniture_inquiry(uuid) to authenticated;
grant execute on function public.bwf_reply_furniture_inquiry(uuid, jsonb) to authenticated;

-- BWA role pm must not read or write BWF internal quotes.
-- Anon has no EXECUTE on bwf_has_role, so anon policies must not call it.
-- Customer share links stay allow-all for anon. Authenticated pm is blocked.
-- service_role still bypasses RLS.
-- Triggers also stop security-definer quote writers when the session is a pm.

create or replace function public.bwf_reject_bwa_pm_quote_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.bwf_has_role(array['pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.bwf_reject_bwa_pm_quote_write() from public, anon, authenticated;

drop trigger if exists bwf_quote_reject_bwa_pm on public.bwf_quote;
create trigger bwf_quote_reject_bwa_pm
  before insert or update or delete on public.bwf_quote
  for each row
  execute function public.bwf_reject_bwa_pm_quote_write();

drop trigger if exists bwf_quote_item_reject_bwa_pm on public.bwf_quote_item;
create trigger bwf_quote_item_reject_bwa_pm
  before insert or update or delete on public.bwf_quote_item
  for each row
  execute function public.bwf_reject_bwa_pm_quote_write();

drop trigger if exists bwf_quote_share_reject_bwa_pm on public.bwf_quote_share_links;
create trigger bwf_quote_share_reject_bwa_pm
  before insert or update or delete on public.bwf_quote_share_links
  for each row
  execute function public.bwf_reject_bwa_pm_quote_write();

drop policy if exists "Allow all access to bwf_quote" on public.bwf_quote;
drop policy if exists bwf_quote_block_bwa_pm on public.bwf_quote;
create policy bwf_quote_block_bwa_pm
  on public.bwf_quote
  for all
  to authenticated
  using (not public.bwf_has_role(array['pm']))
  with check (not public.bwf_has_role(array['pm']));

drop policy if exists bwf_quote_block_bwa_pm_anon on public.bwf_quote;
create policy bwf_quote_block_bwa_pm_anon
  on public.bwf_quote
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow all access to bwf_quote_item" on public.bwf_quote_item;
drop policy if exists bwf_quote_item_block_bwa_pm on public.bwf_quote_item;
create policy bwf_quote_item_block_bwa_pm
  on public.bwf_quote_item
  for all
  to authenticated
  using (not public.bwf_has_role(array['pm']))
  with check (not public.bwf_has_role(array['pm']));

drop policy if exists bwf_quote_item_block_bwa_pm_anon on public.bwf_quote_item;
create policy bwf_quote_item_block_bwa_pm_anon
  on public.bwf_quote_item
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow all access to bwf_quote_share_links" on public.bwf_quote_share_links;
drop policy if exists bwf_quote_share_block_bwa_pm on public.bwf_quote_share_links;
create policy bwf_quote_share_block_bwa_pm
  on public.bwf_quote_share_links
  for all
  to authenticated
  using (not public.bwf_has_role(array['pm']))
  with check (not public.bwf_has_role(array['pm']));

drop policy if exists bwf_quote_share_block_bwa_pm_anon on public.bwf_quote_share_links;
create policy bwf_quote_share_block_bwa_pm_anon
  on public.bwf_quote_share_links
  for all
  to anon
  using (true)
  with check (true);

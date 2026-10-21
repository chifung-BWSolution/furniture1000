-- Store the PMS BWA pitching / project chosen on a furniture inquiry.
-- These are cross-project UUIDs (no local FK). They are not BWF quote ids.
-- This file is not applied by the agent.

alter table public.bwa_furniture_inquiry
  add column if not exists bwa_pitching_id uuid,
  add column if not exists bwa_project_id uuid;

comment on column public.bwa_furniture_inquiry.bwa_pitching_id is
  'PMS public.bwa_pitchings.id. BWA reference only. No cost, factory, or margin.';

comment on column public.bwa_furniture_inquiry.bwa_project_id is
  'PMS public.bwa_projects.id. BWA reference only. No cost, factory, or margin.';

create index if not exists bwa_furniture_inquiry_pitching_idx
  on public.bwa_furniture_inquiry (bwa_pitching_id)
  where bwa_pitching_id is not null;

create index if not exists bwa_furniture_inquiry_project_idx
  on public.bwa_furniture_inquiry (bwa_project_id)
  where bwa_project_id is not null;

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
    new.bwa_pitching_id := old.bwa_pitching_id;
    new.bwa_project_id := old.bwa_project_id;
    new.note := old.note;
    new.sent_at := old.sent_at;
    return new;
  end if;

  raise exception 'permission_denied' using errcode = '42501';
end;
$$;

revoke all on function public.bwa_inquiry_guard() from public, anon, authenticated;

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
        i.bwa_pitching_id,
        i.bwa_project_id,
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
    'bwa_pitching_id', v_row.bwa_pitching_id,
    'bwa_project_id', v_row.bwa_project_id,
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

drop function if exists public.bwa_save_furniture_inquiry(uuid, text, text, text, jsonb);

create or replace function public.bwa_save_furniture_inquiry(
  p_id uuid,
  p_project_ref text,
  p_project_name text,
  p_note text,
  p_items jsonb,
  p_pitching_id uuid default null,
  p_project_id uuid default null
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
      bwa_pitching_id,
      bwa_project_id,
      note,
      status,
      created_by
    ) values (
      left(coalesce(p_project_ref, ''), 120),
      left(coalesce(p_project_name, ''), 200),
      p_pitching_id,
      p_project_id,
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
          bwa_pitching_id = p_pitching_id,
          bwa_project_id = p_project_id,
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

revoke all on function public.bwa_list_furniture_inquiries() from public, anon;
revoke all on function public.bwa_get_furniture_inquiry(uuid) from public, anon;
revoke all on function public.bwa_save_furniture_inquiry(uuid, text, text, text, jsonb, uuid, uuid) from public, anon;

grant execute on function public.bwa_list_furniture_inquiries() to authenticated;
grant execute on function public.bwa_get_furniture_inquiry(uuid) to authenticated;
grant execute on function public.bwa_save_furniture_inquiry(uuid, text, text, text, jsonb, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

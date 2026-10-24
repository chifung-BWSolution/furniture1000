-- FIX HIGH (QA): customer quote RPCs must not list/fetch arbitrary quotes for
-- client/designer. Scope to the caller's email (quote client fields + invited
-- design projects). Share-token path (get_shared_quote) is unchanged.

create or replace function public.bwf_caller_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(
    (
      select p.email
      from public.platform_user_profiles p
      where p.active is true
        and (
          p.auth_user_id = auth.uid()
          or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      order by (p.auth_user_id = auth.uid()) desc nulls last, p.updated_at desc nulls last
      limit 1
    ),
    auth.jwt() ->> 'email',
    ''
  ))), '');
$$;

create or replace function public.bwf_quote_client_emails(p_project_data jsonb)
returns text[]
language sql
immutable
security definer
set search_path = ''
as $$
  select array_remove(array[
    nullif(lower(btrim(coalesce(p_project_data #>> '{formData,clientEmail}', ''))), ''),
    nullif(lower(btrim(coalesce(p_project_data #>> '{clientInfo,email}', ''))), '')
  ], null);
$$;

create or replace function public.bwf_customer_can_access_quote(p_quote_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := public.bwf_caller_email();
  v_pd jsonb;
  v_project_id text;
begin
  if p_quote_id is null or auth.uid() is null then
    return false;
  end if;

  -- Staff with direct table access should not need these RPCs; keep strict.
  if v_email is null then
    return false;
  end if;

  select case
    when jsonb_typeof(q.project_data) = 'object' then q.project_data
    else '{}'::jsonb
  end
    into v_pd
  from public.bwf_quote q
  where q.id = p_quote_id
    and q.status is distinct from '回收桶';

  if not found then
    return false;
  end if;

  if v_email = any (public.bwf_quote_client_emails(v_pd)) then
    return true;
  end if;

  v_project_id := nullif(btrim(coalesce(v_pd->>'designProjectId', '')), '');
  if v_project_id is null
     or v_project_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  return exists (
    select 1
    from public.project_invitations i
    where i.project_id = v_project_id::uuid
      and i.status is distinct from 'revoked'
      and i.email is not null
      and lower(btrim(i.email)) = v_email
  );
end;
$$;

create or replace function public.get_customer_quote(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_id is null or not public.bwf_has_role(array['client', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not public.bwf_customer_can_access_quote(p_id) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return public.bwf_customer_quote_json(p_id);
end;
$$;

create or replace function public.list_customer_quotes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := public.bwf_caller_email();
begin
  if not public.bwf_has_role(array['client', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if v_email is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(payload.quote order by payload.created_at desc nulls last)
    from (
      select
        q.created_at,
        public.bwf_customer_quote_json(q.id) - 'items' as quote
      from public.bwf_quote q
      where q.status is distinct from '回收桶'
        and public.bwf_customer_can_access_quote(q.id)
      order by q.created_at desc nulls last
      limit 120
    ) payload
    where payload.quote is not null
  ), '[]'::jsonb);
end;
$$;

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
declare
  v_quote uuid;
  v_from_token uuid;
  v_item uuid;
  elem jsonb;
  v_id text;
  v_qty numeric;
  v_selected boolean;
  v_price numeric;
  v_section boolean;
  v_custom boolean;
  v_total numeric := 0;
  v_selections jsonb := '{}'::jsonb;
  v_quantities jsonb := '{}'::jsonb;
  v_pd jsonb;
begin
  v_from_token := public.bwf_active_share_quote(p_token);
  if v_from_token is not null then
    if p_quote_id is not null and p_quote_id is distinct from v_from_token then
      raise exception 'invalid_token' using errcode = '42501';
    end if;
    v_quote := v_from_token;
  elsif public.bwf_has_role(array['client', 'designer']) and p_quote_id is not null then
    if not public.bwf_customer_can_access_quote(p_quote_id) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
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

  for elem in select value from jsonb_array_elements(p_lines)
  loop
    v_id := left(btrim(coalesce(elem->>'id', '')), 80);
    if v_id = '' then
      continue;
    end if;
    begin
      v_qty := coalesce(nullif(elem->>'quantity', '')::numeric, 0);
    exception
      when others then
        raise exception 'invalid_quantity' using errcode = '22023';
    end;
    if v_qty < 0 or v_qty > 100000 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    v_selected := coalesce(elem->>'selected', '') in ('true', 't', '1');

    select it.id, it.unit_price, coalesce(it.is_section_title, false), coalesce(it.is_custom_term, false)
      into v_item, v_price, v_section, v_custom
    from public.bwf_quote_item it
    where it.quote_uuid = v_quote
      and (it.client_item_id = v_id or it.id::text = v_id)
      and coalesce(it.is_section_title, false) = false
    order by (it.client_item_id = v_id) desc
    limit 1;

    if v_item is null then
      continue;
    end if;

    update public.bwf_quote_item
      set quantity = v_qty,
          updated_at = now()
    where id = v_item;

    v_selections := v_selections || jsonb_build_object(v_id, v_selected);
    v_quantities := v_quantities || jsonb_build_object(v_id, v_qty);
    if v_selected and not v_section and not v_custom then
      v_total := v_total + coalesce(v_price, 0) * v_qty;
    end if;
  end loop;

  select case
    when jsonb_typeof(q.project_data) = 'object' then q.project_data
    else '{}'::jsonb
  end
    into v_pd
  from public.bwf_quote q
  where q.id = v_quote;

  update public.bwf_quote
    set total_amount = v_total,
        project_data = coalesce(v_pd, '{}'::jsonb) || jsonb_build_object(
          'clientQuoteScheme', jsonb_build_object(
            'savedAt', now(),
            'selections', v_selections,
            'quantities', v_quantities
          )
        ),
        modified_date = now()
  where id = v_quote;

  return v_quote;
end;
$$;

revoke all on function public.bwf_caller_email() from public, anon, authenticated;
revoke all on function public.bwf_quote_client_emails(jsonb) from public, anon, authenticated;
revoke all on function public.bwf_customer_can_access_quote(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

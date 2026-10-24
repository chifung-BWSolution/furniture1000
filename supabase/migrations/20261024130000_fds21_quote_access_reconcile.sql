-- Reconcile customer-safe quote RPCs with internal PM editing.
-- Self-contained because the safe-RPC migration is absent on FDS2.0.
-- Reuse existing FDS role/profile and quote contracts; no PMS schema changes.

-- Customer share links must not read bwf_quote cost, factory, or margin.
-- Anon loses direct table access. A token-checked RPC returns the customer fields.
-- admin / uploader keep direct access for the internal quote editor.
-- designer and client use the safe RPCs.

alter table public.bwf_quote_share_links
  add column if not exists expires_at timestamptz;

comment on column public.bwf_quote_share_links.expires_at is
  'Null means the link does not expire. Revoked links are status = revoked.';

revoke all on table public.bwf_quote from anon;
revoke all on table public.bwf_quote_item from anon;
revoke all on table public.bwf_quote_share_links from anon;

drop policy if exists "Allow all access to bwf_quote" on public.bwf_quote;
drop policy if exists bwf_quote_block_bwa_pm on public.bwf_quote;
drop policy if exists bwf_quote_block_bwa_pm_anon on public.bwf_quote;
drop policy if exists bwf_quote_staff_full on public.bwf_quote;
create policy bwf_quote_staff_full
  on public.bwf_quote
  for all
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']))
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm']));

drop policy if exists "Allow all access to bwf_quote_item" on public.bwf_quote_item;
drop policy if exists bwf_quote_item_block_bwa_pm on public.bwf_quote_item;
drop policy if exists bwf_quote_item_block_bwa_pm_anon on public.bwf_quote_item;
drop policy if exists bwf_quote_item_staff_full on public.bwf_quote_item;
create policy bwf_quote_item_staff_full
  on public.bwf_quote_item
  for all
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']))
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm']));

drop policy if exists "Allow all access to bwf_quote_share_links" on public.bwf_quote_share_links;
drop policy if exists bwf_quote_share_block_bwa_pm on public.bwf_quote_share_links;
drop policy if exists bwf_quote_share_block_bwa_pm_anon on public.bwf_quote_share_links;
drop policy if exists bwf_quote_share_staff_full on public.bwf_quote_share_links;
create policy bwf_quote_share_staff_full
  on public.bwf_quote_share_links
  for all
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']))
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm']));

create or replace function public.bwf_customer_terms(p_value jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) is distinct from 'object' then null
    else jsonb_strip_nulls(jsonb_build_object(
      'transport', left(p_value->>'transport', 4000),
      'extraFees', left(p_value->>'extraFees', 4000),
      'warranty', left(p_value->>'warranty', 4000),
      'other', left(p_value->>'other', 4000),
      'payment', left(p_value->>'payment', 4000),
      'fullHtml', left(p_value->>'fullHtml', 20000)
    ))
  end;
$$;

create or replace function public.bwf_customer_quote_json(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.bwf_quote%rowtype;
  pd jsonb;
  form jsonb;
  info jsonb;
  scheme jsonb;
begin
  select *
    into q
  from public.bwf_quote
  where id = p_quote_id;

  if not found or q.status = '回收桶' then
    return null;
  end if;

  pd := case when jsonb_typeof(q.project_data) = 'object' then q.project_data else '{}'::jsonb end;
  form := case when jsonb_typeof(pd->'formData') = 'object' then pd->'formData' else '{}'::jsonb end;
  info := case when jsonb_typeof(pd->'clientInfo') = 'object' then pd->'clientInfo' else '{}'::jsonb end;
  scheme := case when jsonb_typeof(pd->'clientQuoteScheme') = 'object' then pd->'clientQuoteScheme' else '{}'::jsonb end;

  return jsonb_build_object(
    'id', q.id,
    'quote_id', q.quote_id,
    'version', q.version,
    'status', q.status,
    'total_amount', q.total_amount,
    'created_at', q.created_at,
    'modified_date', q.modified_date,
    'project_data', jsonb_strip_nulls(jsonb_build_object(
      'formData', jsonb_strip_nulls(jsonb_build_object(
        'clientName', left(form->>'clientName', 200),
        'clientContactName', left(form->>'clientContactName', 200),
        'clientPhone', left(form->>'clientPhone', 80),
        'clientEmail', left(form->>'clientEmail', 200)
      )),
      'clientInfo', jsonb_strip_nulls(jsonb_build_object(
        'name', left(info->>'name', 200),
        'contactName', left(info->>'contactName', 200),
        'phone', left(info->>'phone', 80),
        'email', left(info->>'email', 200)
      )),
      'deliveryDetails', left(pd->>'deliveryDetails', 8000),
      'deliveryDetailsEn', left(pd->>'deliveryDetailsEn', 8000),
      'termsContent', public.bwf_customer_terms(coalesce(pd->'termsContent', q.terms_content)),
      'termsContentEn', public.bwf_customer_terms(pd->'termsContentEn'),
      'designProjectId', left(pd->>'designProjectId', 80),
      'clientQuoteScheme', jsonb_build_object(
        'savedAt', scheme->>'savedAt',
        'selections', case
          when jsonb_typeof(scheme->'selections') = 'object' then scheme->'selections'
          else '{}'::jsonb
        end,
        'quantities', case
          when jsonb_typeof(scheme->'quantities') = 'object' then scheme->'quantities'
          else '{}'::jsonb
        end
      )
    )),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', coalesce(it.client_item_id, it.id::text),
        'name', it.name,
        'spec', it.remarks,
        'remarks', it.remarks,
        'image', it.image,
        'reference_image', it.reference_image,
        'remarks_image', it.remarks_image,
        'quantity', it.quantity,
        'unit', it.unit,
        'unit_price', it.unit_price,
        'category', it.category,
        'material', it.material,
        'color', it.color,
        'dimension_l_mm', it.dimension_l_mm,
        'dimension_w_mm', it.dimension_w_mm,
        'dimension_h_mm', it.dimension_h_mm,
        'delivery_term_name', it.delivery_term_name,
        'is_custom_term', it.is_custom_term,
        'is_optional', it.is_optional,
        'hide_in_pdf', it.hide_in_pdf,
        'is_section_title', it.is_section_title,
        'sort_order', it.sort_order,
        'quote_uuid', it.quote_uuid,
        'product_id', it.product_id
      ) order by it.sort_order, it.created_at)
      from public.bwf_quote_item it
      where it.quote_uuid = q.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.bwf_active_share_quote(p_token text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_quote uuid;
begin
  if v_token = '' or length(v_token) > 80 or v_token ~ '[^A-Za-z0-9_-]' then
    return null;
  end if;

  select l.quote_uuid
    into v_quote
  from public.bwf_quote_share_links l
  where l.share_token = v_token
    and l.status = 'active'
    and (l.expires_at is null or l.expires_at > now());

  return v_quote;
end;
$$;

create or replace function public.get_shared_quote(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote uuid;
  v_body jsonb;
begin
  v_quote := public.bwf_active_share_quote(p_token);
  if v_quote is null then
    return 'null'::jsonb;
  end if;

  v_body := public.bwf_customer_quote_json(v_quote);
  if v_body is null then
    return 'null'::jsonb;
  end if;

  update public.bwf_quote_share_links
    set last_viewed_at = now()
  where share_token = btrim(p_token)
    and status = 'active';

  return v_body;
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
begin
  if not public.bwf_has_role(array['client', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(payload.quote order by payload.created_at desc nulls last)
    from (
      select
        q.created_at,
        public.bwf_customer_quote_json(q.id) - 'items' as quote
      from public.bwf_quote q
      where q.status is distinct from '回收桶'
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

create or replace function public.save_bwf_quote_items(
  p_quote_uuid uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  elem jsonb;
  idx int := 0;
begin
  if auth.role() is distinct from 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if p_quote_uuid is null then
    raise exception 'p_quote_uuid is required' using errcode = '22023';
  end if;

  delete from public.bwf_quote_item where quote_uuid = p_quote_uuid;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;

  for elem in select value from jsonb_array_elements(p_items)
  loop
    insert into public.bwf_quote_item (
      quote_uuid,
      sort_order,
      client_item_id,
      name,
      image,
      reference_image,
      remarks_image,
      unit_price,
      quantity,
      unit,
      cost_price,
      exchange_rate,
      hkd_cost_price,
      category,
      material,
      color,
      remarks,
      dimension_l_mm,
      dimension_w_mm,
      dimension_h_mm,
      delivery_term_name,
      factory_name,
      factory_from_catalog,
      is_custom_term,
      is_optional,
      is_section_title,
      sku,
      hide_in_pdf,
      product_id,
      product_category_id
    ) values (
      p_quote_uuid,
      coalesce((elem->>'sort_order')::int, idx),
      nullif(elem->>'client_item_id', ''),
      coalesce(elem->>'name', ''),
      coalesce(elem->>'image', ''),
      nullif(elem->>'reference_image', ''),
      nullif(elem->>'remarks_image', ''),
      coalesce((elem->>'unit_price')::numeric, 0),
      coalesce((elem->>'quantity')::numeric, 1),
      nullif(elem->>'unit', ''),
      case when elem ? 'cost_price' and elem->>'cost_price' is not null and elem->>'cost_price' <> ''
        then (elem->>'cost_price')::numeric else null end,
      case when elem ? 'exchange_rate' and elem->>'exchange_rate' is not null and elem->>'exchange_rate' <> ''
        then (elem->>'exchange_rate')::numeric else null end,
      case when elem ? 'hkd_cost_price' and elem->>'hkd_cost_price' is not null and elem->>'hkd_cost_price' <> ''
        then (elem->>'hkd_cost_price')::numeric else null end,
      nullif(elem->>'category', ''),
      nullif(elem->>'material', ''),
      nullif(elem->>'color', ''),
      elem->>'remarks',
      nullif(btrim(elem->>'dimension_l_mm'), ''),
      nullif(btrim(elem->>'dimension_w_mm'), ''),
      nullif(btrim(elem->>'dimension_h_mm'), ''),
      nullif(elem->>'delivery_term_name', ''),
      nullif(elem->>'factory_name', ''),
      coalesce((elem->>'factory_from_catalog')::boolean, false),
      coalesce((elem->>'is_custom_term')::boolean, false),
      coalesce((elem->>'is_optional')::boolean, false),
      coalesce((elem->>'is_section_title')::boolean, false),
      nullif(btrim(elem->>'sku'), ''),
      coalesce((elem->>'hide_in_pdf')::boolean, false),
      nullif(coalesce(elem->>'product_id', elem->>'productId'), ''),
      nullif(coalesce(elem->>'product_category_id', elem->>'productCategoryId'), '')::uuid
    );
    idx := idx + 1;
  end loop;
end;
$$;

revoke all on function public.bwf_customer_terms(jsonb) from public, anon, authenticated;
revoke all on function public.bwf_customer_quote_json(uuid) from public, anon, authenticated;
revoke all on function public.bwf_active_share_quote(text) from public, anon, authenticated;

revoke all on function public.get_shared_quote(text) from public;
revoke all on function public.get_customer_quote(uuid) from public, anon;
revoke all on function public.list_customer_quotes() from public, anon;
revoke all on function public.save_customer_quote_scheme(text, uuid, jsonb) from public;
revoke all on function public.save_bwf_quote_items(uuid, jsonb) from public, anon;

grant execute on function public.get_shared_quote(text) to anon, authenticated;
grant execute on function public.get_customer_quote(uuid) to authenticated;
grant execute on function public.list_customer_quotes() to authenticated;
grant execute on function public.save_customer_quote_scheme(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.save_bwf_quote_items(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

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

-- Remove the legacy blanket PM trigger; RLS now defines internal access.
DROP TRIGGER IF EXISTS bwf_quote_reject_bwa_pm ON public.bwf_quote;
DROP TRIGGER IF EXISTS bwf_quote_item_reject_bwa_pm ON public.bwf_quote_item;
DROP TRIGGER IF EXISTS bwf_quote_share_reject_bwa_pm ON public.bwf_quote_share_links;
DROP FUNCTION IF EXISTS public.bwf_reject_bwa_pm_quote_write();

ALTER TABLE public.bwf_quote ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bwf_quote FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.bwf_quote FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bwf_quote TO authenticated;
GRANT ALL ON TABLE public.bwf_quote TO service_role;
DROP POLICY IF EXISTS "Allow all access to bwf_quote" ON public.bwf_quote;
DROP POLICY IF EXISTS bwf_quote_block_bwa_pm ON public.bwf_quote;
DROP POLICY IF EXISTS bwf_quote_block_bwa_pm_anon ON public.bwf_quote;
DROP POLICY IF EXISTS bwf_quote_staff_full ON public.bwf_quote;
CREATE POLICY bwf_quote_staff_full ON public.bwf_quote
FOR ALL TO authenticated
USING (public.bwf_has_role(array['admin', 'uploader', 'pm']))
WITH CHECK (public.bwf_has_role(array['admin', 'uploader', 'pm']));

ALTER TABLE public.bwf_quote_item ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bwf_quote_item FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.bwf_quote_item FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bwf_quote_item TO authenticated;
GRANT ALL ON TABLE public.bwf_quote_item TO service_role;
DROP POLICY IF EXISTS "Allow all access to bwf_quote_item" ON public.bwf_quote_item;
DROP POLICY IF EXISTS bwf_quote_item_block_bwa_pm ON public.bwf_quote_item;
DROP POLICY IF EXISTS bwf_quote_item_block_bwa_pm_anon ON public.bwf_quote_item;
DROP POLICY IF EXISTS bwf_quote_item_staff_full ON public.bwf_quote_item;
CREATE POLICY bwf_quote_item_staff_full ON public.bwf_quote_item
FOR ALL TO authenticated
USING (public.bwf_has_role(array['admin', 'uploader', 'pm']))
WITH CHECK (public.bwf_has_role(array['admin', 'uploader', 'pm']));

ALTER TABLE public.bwf_quote_share_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bwf_quote_share_links FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.bwf_quote_share_links FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bwf_quote_share_links TO authenticated;
GRANT ALL ON TABLE public.bwf_quote_share_links TO service_role;
DROP POLICY IF EXISTS "Allow all access to bwf_quote_share_links" ON public.bwf_quote_share_links;
DROP POLICY IF EXISTS bwf_quote_share_block_bwa_pm ON public.bwf_quote_share_links;
DROP POLICY IF EXISTS bwf_quote_share_block_bwa_pm_anon ON public.bwf_quote_share_links;
DROP POLICY IF EXISTS bwf_quote_share_staff_full ON public.bwf_quote_share_links;
CREATE POLICY bwf_quote_share_staff_full ON public.bwf_quote_share_links
FOR ALL TO authenticated
USING (public.bwf_has_role(array['admin', 'uploader', 'pm']))
WITH CHECK (public.bwf_has_role(array['admin', 'uploader', 'pm']));

notify pgrst, 'reload schema';

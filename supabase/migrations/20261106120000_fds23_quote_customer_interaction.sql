-- FDS-14 / 客戶報價二維碼與家具互動
-- 1. 客戶提交可記錄「加選」「換款」及「確認所顯示的報價版本」。
-- 2. 加選／換款的商品由伺服器按客戶目錄（shopify_products 已上架）重新讀取，
--    前端傳入的價格與名稱只作顯示，不會寫入正式報價。
-- 3. 正式報價的明細、單價與總額在 PM 處理前完全不變。
--
-- 沿用既有 bwf_quote_customer_request：同一個請求內容（idempotency_key）只會有一筆。

-- ---------------------------------------------------------------------------
-- 1. 提交記錄：新增請求類型與報價版本
-- ---------------------------------------------------------------------------

alter table public.bwf_quote_customer_request
  drop constraint if exists bwf_quote_customer_request_request_type_check;

alter table public.bwf_quote_customer_request
  add constraint bwf_quote_customer_request_request_type_check
  check (request_type in (
    'scheme',
    'selection',
    'quantity',
    'additional',
    'replacement',
    'change',
    'confirm',
    'reject'
  ));

alter table public.bwf_quote_customer_request
  add column if not exists quote_version text not null default '';

comment on column public.bwf_quote_customer_request.quote_version is
  '客戶提交／確認時所看到的 bwf_quote.version；PM 面板與通知要顯示同一版本。';

-- ---------------------------------------------------------------------------
-- 2. 客戶讀回自己在這個分享連結下的提交（用於回執與待處理提示）
-- ---------------------------------------------------------------------------

create or replace function public.fds_shared_quote_requests(
  p_token text,
  p_quote_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quote uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  v_quote := public.bwf_active_share_quote(p_token);
  if v_quote is null then
    if p_quote_id is not null
       and public.bwf_has_role(array['client', 'designer'])
       and exists (
         select 1
           from public.bwf_quote q
          where q.id = p_quote_id
            and q.status is distinct from '回收桶'
       )
    then
      v_quote := p_quote_id;
    else
      raise exception 'invalid_token' using errcode = '42501';
    end if;
  elsif p_quote_id is not null and p_quote_id is distinct from v_quote then
    raise exception 'invalid_token' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(payload) order by payload.submitted_at desc)
    from (
      select
        r.id,
        r.quote_uuid,
        r.quote_id,
        r.quote_version,
        r.request_type,
        r.status,
        r.note,
        r.lines,
        r.total_cents,
        r.submitted_at
      from public.bwf_quote_customer_request r
      where r.quote_uuid = v_quote
      order by r.submitted_at desc
      limit v_limit
    ) payload
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_shared_quote_requests(text, uuid, integer) from public;
grant execute on function public.fds_shared_quote_requests(text, uuid, integer)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. 提交：原有明細選擇以外，支援加選、換款與確認
-- ---------------------------------------------------------------------------

drop function if exists public.submit_customer_quote_request(text, uuid, jsonb, text, text, text);

create or replace function public.submit_customer_quote_request(
  p_token text,
  p_quote_id uuid,
  p_lines jsonb,
  p_note text default '',
  p_idempotency_key text default null,
  p_request_type text default 'scheme',
  p_quote_version text default ''
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
  v_quote_id text;
  v_quote_version text;
  v_note text;
  v_type text;
  v_lines jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_kind text;
  v_id text;
  v_product_id text;
  v_original_id text;
  v_qty numeric;
  v_selected boolean;
  v_line_note text;
  v_item record;
  v_product record;
  v_original record;
  v_total numeric := 0;
  v_selections jsonb := '{}'::jsonb;
  v_quantities jsonb := '{}'::jsonb;
  v_key text;
  v_request uuid;
  v_created boolean := false;
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

  select q.quote_id, coalesce(nullif(q.version, ''), 'v1')
    into v_quote_id, v_quote_version
    from public.bwf_quote q
   where q.id = v_quote
     and q.status is distinct from '回收桶';

  if v_quote_id is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  v_type := case
    when p_request_type in ('scheme', 'selection', 'quantity', 'additional', 'replacement', 'change', 'confirm', 'reject')
      then p_request_type
    else 'scheme'
  end;
  v_note := left(btrim(coalesce(p_note, '')), 1000);
  v_quote_version := left(
    coalesce(
      nullif(btrim(coalesce(p_quote_version, '')), ''),
      v_quote_version,
      ''
    ),
    40
  );

  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid_lines' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 200 then
    raise exception 'too_many_lines' using errcode = '22023';
  end if;

  for v_elem in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_kind := case
      when v_elem->>'kind' in ('addition', 'replacement') then v_elem->>'kind'
      else 'original'
    end;
    if v_type = 'additional' and v_kind = 'original' then
      v_kind := 'addition';
    elsif v_type = 'replacement' and v_kind = 'original' then
      v_kind := 'replacement';
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
    v_line_note := left(btrim(coalesce(v_elem->>'note', '')), 500);

    if v_kind = 'original' then
      v_id := left(btrim(coalesce(v_elem->>'id', '')), 80);
      if v_id = '' then
        continue;
      end if;
      v_selected := coalesce(v_elem->>'selected', '') in ('true', 't', '1');

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
        'kind', 'original',
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

    elsif v_kind = 'addition' then
      v_product_id := left(btrim(coalesce(v_elem->>'productId', '')), 120);
      if v_product_id = '' or v_qty <= 0 then
        continue;
      end if;

      select
        sp.source_product_id,
        sp.shopify_product_id,
        sp.title,
        sp.price,
        sp.image_url
        into v_product
        from public.shopify_products sp
       where sp.status = 'active'
         and (sp.source_product_id = v_product_id or sp.shopify_product_id = v_product_id)
       order by (sp.source_product_id = v_product_id) desc
       limit 1;

      if not found then
        raise exception 'catalog_product_unavailable' using errcode = '22023';
      end if;

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'kind', 'addition',
        'itemId', null,
        'clientItemId', null,
        'productId', v_product_id,
        'catalogProductId', v_product.source_product_id,
        'shopifyProductId', v_product.shopify_product_id,
        'name', v_product.title,
        'image', v_product.image_url,
        'unit', '件',
        'unitPrice', v_product.price,
        'quantity', v_qty,
        'selected', true,
        'note', v_line_note
      ));
      v_total := v_total + round(coalesce(v_product.price, 0) * 100) * v_qty;

    else
      -- 換款：原項目必須屬於這張報價；替代品必須是已上架的目錄商品。
      v_original_id := left(btrim(coalesce(v_elem->>'originalItemId', '')), 80);
      v_product_id := left(btrim(coalesce(v_elem->>'productId', '')), 120);
      if v_original_id = '' or v_product_id = '' or v_qty <= 0 then
        continue;
      end if;

      select
        it.id,
        it.name,
        it.unit,
        it.unit_price
        into v_original
        from public.bwf_quote_item it
       where it.quote_uuid = v_quote
         and (it.client_item_id = v_original_id or it.id::text = v_original_id)
         and coalesce(it.is_section_title, false) = false
         and coalesce(it.is_custom_term, false) = false
       order by (it.client_item_id = v_original_id) desc
       limit 1;

      if not found then
        raise exception 'original_item_not_found' using errcode = '22023';
      end if;

      select
        sp.source_product_id,
        sp.shopify_product_id,
        sp.title,
        sp.price,
        sp.image_url
        into v_product
        from public.shopify_products sp
       where sp.status = 'active'
         and (sp.source_product_id = v_product_id or sp.shopify_product_id = v_product_id)
       order by (sp.source_product_id = v_product_id) desc
       limit 1;

      if not found then
        raise exception 'catalog_product_unavailable' using errcode = '22023';
      end if;

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'kind', 'replacement',
        'itemId', null,
        'clientItemId', null,
        'originalItemId', v_original.id,
        'originalClientItemId', v_original_id,
        'originalName', v_original.name,
        'originalUnit', v_original.unit,
        'originalUnitPrice', v_original.unit_price,
        'productId', v_product_id,
        'catalogProductId', v_product.source_product_id,
        'shopifyProductId', v_product.shopify_product_id,
        'name', v_product.title,
        'image', v_product.image_url,
        'unit', '件',
        'unitPrice', v_product.price,
        'quantity', v_qty,
        'selected', true,
        'note', v_line_note
      ));
      v_total := v_total + round(coalesce(v_product.price, 0) * 100) * v_qty;
    end if;

    exit when jsonb_array_length(v_lines) >= 200;
  end loop;

  if v_type in ('confirm', 'reject') then
    -- 確認／拒絕所顯示的版本：不帶明細，也不必改動任何正式報價金額。
    v_lines := '[]'::jsonb;
    v_total := 0;
  elsif jsonb_array_length(v_lines) = 0 then
    raise exception 'empty_request' using errcode = '22023';
  end if;

  v_key := left(
    coalesce(
      nullif(btrim(coalesce(p_idempotency_key, '')), ''),
      md5(jsonb_build_object(
        'type', v_type,
        'version', v_quote_version,
        'lines', v_lines,
        'note', v_note
      )::text)
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
    quote_uuid, quote_id, quote_version, share_link_id, request_type, lines, note,
    total_cents, idempotency_key, pm_name, pm_email
  )
  values (
    v_quote, coalesce(v_quote_id, ''), v_quote_version, v_share_link, v_type, v_lines, v_note,
    round(v_total)::bigint, v_key, v_pm_name, v_pm_email
  )
  on conflict (quote_uuid, idempotency_key) do nothing
  returning id into v_request;

  v_created := v_request is not null;

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

  -- 重送的同一請求不再重寫報價內容（避免回執時間被覆蓋）。
  if not v_created then
    return v_request;
  end if;

  select case
           when jsonb_typeof(q.project_data) = 'object' then q.project_data
           else '{}'::jsonb
         end
    into v_pd
    from public.bwf_quote q
   where q.id = v_quote;

  if v_type in ('confirm', 'reject') then
    update public.bwf_quote
       set project_data = coalesce(v_pd, '{}'::jsonb) || jsonb_build_object(
             'customerConfirmation', jsonb_build_object(
               'status', case when v_type = 'reject' then 'rejected' else 'confirmed' end,
               'quoteId', coalesce(v_quote_id, ''),
               'version', v_quote_version,
               'note', v_note,
               'requestId', v_request,
               'confirmedAt', now()
             )
           ),
           modified_date = now()
     where id = v_quote;
  elsif jsonb_typeof(v_selections) = 'object' and v_selections <> '{}'::jsonb then
    -- 只記錄客戶自己的選擇，供客戶頁重新載入時還原；不動 items 與 total_amount。
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
  end if;

  return v_request;
end;
$$;

revoke all on function public.submit_customer_quote_request(text, uuid, jsonb, text, text, text, text) from public;
grant execute on function public.submit_customer_quote_request(text, uuid, jsonb, text, text, text, text)
  to anon, authenticated, service_role;

-- 舊 slug 保留同一個簽名（前端仍在用），語意仍是「提交客戶需求」。
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
  return public.submit_customer_quote_request(p_token, p_quote_id, p_lines, '', null, 'scheme', '');
end;
$$;

revoke all on function public.save_customer_quote_scheme(text, uuid, jsonb) from public;
grant execute on function public.save_customer_quote_scheme(text, uuid, jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 客戶頁讀回的報價：加入客戶行業與確認回執
--    （「相關家具」推薦用途由客戶頁讀 design_projects.meta.projectType）
-- ---------------------------------------------------------------------------

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
  confirm jsonb;
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
  confirm := case when jsonb_typeof(pd->'customerConfirmation') = 'object' then pd->'customerConfirmation' else '{}'::jsonb end;

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
        'clientEmail', left(form->>'clientEmail', 200),
        'clientIndustry', case
          when jsonb_typeof(form->'clientIndustry') = 'array' then form->'clientIndustry'
          else '[]'::jsonb
        end
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
      'customerConfirmation', jsonb_strip_nulls(jsonb_build_object(
        'status', left(confirm->>'status', 20),
        'version', left(confirm->>'version', 40),
        'quoteId', left(confirm->>'quoteId', 120),
        'confirmedAt', left(confirm->>'confirmedAt', 40),
        'note', left(confirm->>'note', 1000)
      )),
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

revoke all on function public.bwf_customer_quote_json(uuid) from public, anon, authenticated;
grant execute on function public.bwf_customer_quote_json(uuid) to service_role, postgres;

-- ---------------------------------------------------------------------------
-- 5. PM 面板：回傳報價版本，方便核對同一版本
-- ---------------------------------------------------------------------------

create or replace function public.fds_quote_customer_requests(
  p_quote_uuid uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(payload) order by payload.submitted_at desc)
    from (
      select
        r.id,
        r.quote_uuid,
        r.quote_id,
        r.quote_version,
        r.request_type,
        r.note,
        r.lines,
        r.total_cents,
        r.status,
        r.submitted_at,
        r.pm_name,
        r.pm_notified_at,
        r.pm_notify_error,
        jsonb_array_length(r.lines) as line_count
      from public.bwf_quote_customer_request r
      where (p_quote_uuid is null or r.quote_uuid = p_quote_uuid)
      order by r.submitted_at desc
      limit v_limit
    ) payload
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_quote_customer_requests(uuid, integer) from public, anon;
grant execute on function public.fds_quote_customer_requests(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

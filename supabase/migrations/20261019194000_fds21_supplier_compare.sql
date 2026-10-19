-- Day 7（T-701～T-704）：同型號多供應商比較、報價歷史、同廠家去重。
-- 比較結果不排序價錢，也不標「最佳」。成本只回給 admin／uploader。

create or replace function public.fds_compare_supplier_prices(p_product_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cost boolean;
  v_key text;
  v_result jsonb;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_cost := public.bwf_has_role(array['admin', 'uploader']);

  select public.fds_model_key(p.model) into v_key
  from public.products p
  where p.id = p_product_id and not p.dismissed;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  with anchor as (
    select factory_id, factories_display_name
    from public.products
    where id = p_product_id
  ),
  peers as (
    select p.id, p.model, p.factories_display_name, p.factory_id,
           p.dimension_l_mm, p.dimension_w_mm, p.dimension_h_mm, p.material, p.color,
           p.id = p_product_id as is_current,
           case
             when coalesce(p.factory_id, '') <> '' and coalesce(a.factory_id, '') <> ''
               then p.factory_id = a.factory_id
             else lower(btrim(coalesce(p.factories_display_name, '')))
                  = lower(btrim(coalesce(a.factories_display_name, '')))
                  and btrim(coalesce(p.factories_display_name, '')) <> ''
           end as same_supplier
    from public.products p
    cross join anchor a
    where not p.dismissed
      and (p.id = p_product_id or (v_key is not null and public.fds_model_key(p.model) = v_key))
  ),
  ranked as (
    select sp.id, sp.product_id, sp.cost_price, sp.currency, sp.unit, sp.moq, sp.variant_label,
           sp.valid_from, sp.valid_to, sp.page_no, sp.document_id, sp.raw_ref, sp.created_at,
           d.title as document_title,
           row_number() over (
             partition by sp.product_id
             order by
               case
                 when (sp.valid_to is null or sp.valid_to >= current_date)
                  and (sp.valid_from is null or sp.valid_from <= current_date) then 0
                 else 1
               end,
               sp.created_at desc
           ) as rn
    from public.supplier_prices sp
    left join public.supplier_documents d on d.id = sp.document_id
    where sp.verified and sp.product_id in (select id from peers)
  )
  select jsonb_build_object(
    'model_key', v_key,
    'auto_selected', false,
    'can_view_cost', v_cost,
    'truncated', (select count(*) > 20 from peers),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'product_id', p.id,
        'is_current', p.is_current,
        'same_supplier', p.same_supplier,
        'model', nullif(p.model, ''),
        'factory_name', nullif(p.factories_display_name, ''),
        'dimension_l_mm', p.dimension_l_mm,
        'dimension_w_mm', p.dimension_w_mm,
        'dimension_h_mm', p.dimension_h_mm,
        'material', nullif(p.material, ''),
        'color', nullif(p.color, ''),
        'offers', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', r.id,
            'current', r.rn = 1,
            'cost', case when v_cost then r.cost_price end,
            'currency', nullif(r.currency, ''),
            'fx_recorded', public.fds_try_numeric(coalesce(
              r.raw_ref ->> 'exchange_rate', r.raw_ref ->> 'fx_rate')) is not null,
            'unit', nullif(r.unit, ''),
            'moq', r.moq,
            'variant_label', nullif(r.variant_label, ''),
            'valid_from', r.valid_from,
            'valid_to', r.valid_to,
            'validity', case
              when r.valid_to is not null and r.valid_to < current_date then 'expired'
              when r.valid_from is not null and r.valid_from > current_date then 'future'
              when r.valid_to is null then 'unmarked'
              else 'valid'
            end,
            'trend', case
              when v_cost and r.rn = 1 and prev.cost_price is not null and r.cost_price is not null then
                case
                  when r.cost_price > prev.cost_price then 'up'
                  when r.cost_price < prev.cost_price then 'down'
                  else 'flat'
                end
            end,
            'page_no', r.page_no,
            'document_id', r.document_id,
            'document_title', r.document_title,
            'created_at', r.created_at
          )) order by r.rn)
          from ranked r
          left join lateral (
            select p2.cost_price
            from ranked p2
            where p2.product_id = r.product_id
              and p2.rn > r.rn
              and coalesce(p2.currency, '') = coalesce(r.currency, '')
            order by p2.rn
            limit 1
          ) prev on true
          where r.product_id = p.id
        ), '[]'::jsonb)
      )) order by p.is_current desc, p.factories_display_name)
      from (select * from peers order by is_current desc, factories_display_name limit 20) p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.fds_compare_supplier_prices(text) from public, anon;
grant execute on function public.fds_compare_supplier_prices(text) to authenticated;

-- 只合併同廠家、同型號的重複列。不同供應商留作比較，不在這裡合併。
create or replace function public.fds_merge_duplicate_product(p_keep_id text, p_drop_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep public.products%rowtype;
  v_drop public.products%rowtype;
  v_prices int := 0;
  v_sources int := 0;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  if p_keep_id = p_drop_id then
    raise exception 'same_product' using errcode = '22023';
  end if;

  select * into v_keep from public.products where id = p_keep_id and not dismissed;
  if v_keep.id is null then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  select * into v_drop from public.products where id = p_drop_id and not dismissed;
  if v_drop.id is null then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if public.fds_model_key(v_keep.model) is null
     or public.fds_model_key(v_keep.model) is distinct from public.fds_model_key(v_drop.model) then
    raise exception 'model_mismatch' using errcode = '22023';
  end if;
  if not (
    case
      when coalesce(v_keep.factory_id, '') <> '' and coalesce(v_drop.factory_id, '') <> ''
        then v_keep.factory_id = v_drop.factory_id
      else lower(btrim(coalesce(v_keep.factories_display_name, '')))
           = lower(btrim(coalesce(v_drop.factories_display_name, '')))
           and btrim(coalesce(v_keep.factories_display_name, '')) <> ''
    end
  ) then
    raise exception 'different_supplier' using errcode = '22023';
  end if;
  if v_drop.shopify_product_id is not null then
    raise exception 'published_product' using errcode = '22023';
  end if;

  update public.supplier_prices set product_id = p_keep_id where product_id = p_drop_id;
  get diagnostics v_prices = row_count;

  insert into public.product_source_refs (product_id, document_id, extraction_item_id, page_no, bbox)
  select p_keep_id, document_id, extraction_item_id, page_no, bbox
  from public.product_source_refs
  where product_id = p_drop_id
  on conflict (product_id, document_id, page_no) do nothing;
  get diagnostics v_sources = row_count;
  delete from public.product_source_refs where product_id = p_drop_id;

  delete from public.search_embeddings
  where entity_type = 'product' and entity_id = p_drop_id;

  update public.products set dismissed = true, modified_date = now() where id = p_drop_id;

  return jsonb_build_object(
    'kept', p_keep_id,
    'merged', p_drop_id,
    'prices', v_prices,
    'sources', v_sources
  );
end;
$$;

revoke all on function public.fds_merge_duplicate_product(text, text) from public, anon;
grant execute on function public.fds_merge_duplicate_product(text, text) to authenticated;

notify pgrst, 'reload schema';

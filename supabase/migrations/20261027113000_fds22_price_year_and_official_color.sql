-- FDS 2.2：同年同型號價格不自動挑選；正式色只寫既有英文色名。
-- 歷史報價保留。有效價取最新年份、且未被標成衝突的報價。

alter table public.supplier_prices
  add column if not exists quote_year integer,
  add column if not exists price_conflict boolean not null default false;

alter table public.supplier_prices
  drop constraint if exists supplier_prices_quote_year_range;
alter table public.supplier_prices
  add constraint supplier_prices_quote_year_range
  check (quote_year is null or quote_year between 1990 and 2100);

create index if not exists supplier_prices_year_idx
  on public.supplier_prices (product_id, quote_year desc);

update public.supplier_prices sp
set quote_year = d.document_year
from public.supplier_documents d
where sp.document_id = d.id
  and sp.quote_year is null
  and d.document_year between 1990 and 2100;

update public.supplier_prices sp
set price_conflict = true
where sp.verified
  and sp.id in (
    select sp2.id
    from public.supplier_prices sp2
    join (
      select product_id, quote_year,
             coalesce(currency, '') as currency,
             coalesce(unit, '') as unit,
             coalesce(variant_label, '') as variant_label
      from public.supplier_prices
      where verified and quote_year is not null
      group by 1, 2, 3, 4, 5
      having count(distinct cost_price) > 1
    ) g
      on sp2.product_id = g.product_id
     and sp2.quote_year is not distinct from g.quote_year
     and coalesce(sp2.currency, '') = g.currency
     and coalesce(sp2.unit, '') = g.unit
     and coalesce(sp2.variant_label, '') = g.variant_label
    where sp2.verified
  );

create or replace function public.fds_refresh_price_year_conflict(
  p_product_id text,
  p_year int,
  p_currency text,
  p_unit text,
  p_variant text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distinct int;
begin
  select count(distinct sp.cost_price) into v_distinct
  from public.supplier_prices sp
  where sp.product_id = p_product_id
    and sp.verified
    and sp.quote_year is not distinct from p_year
    and coalesce(sp.currency, '') = coalesce(p_currency, '')
    and coalesce(sp.unit, '') = coalesce(p_unit, '')
    and coalesce(sp.variant_label, '') = coalesce(p_variant, '');

  update public.supplier_prices sp
  set price_conflict = (v_distinct > 1)
  where sp.product_id = p_product_id
    and sp.verified
    and sp.quote_year is not distinct from p_year
    and coalesce(sp.currency, '') = coalesce(p_currency, '')
    and coalesce(sp.unit, '') = coalesce(p_unit, '')
    and coalesce(sp.variant_label, '') = coalesce(p_variant, '');
end;
$$;

revoke all on function public.fds_refresh_price_year_conflict(text, int, text, text, text) from public, anon, authenticated;

create or replace function public.fds_lookup_year_prices(
  p_factory_id text,
  p_factory_name text,
  p_year int,
  p_model_keys text[]
) returns table (
  model_key text,
  currency text,
  unit text,
  variant_label text,
  cost_price numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select public.fds_model_key(p.model),
         coalesce(sp.currency, ''),
         coalesce(sp.unit, ''),
         coalesce(sp.variant_label, ''),
         sp.cost_price
  from public.supplier_prices sp
  join public.products p on p.id = sp.product_id
  left join public.supplier_documents d on d.id = sp.document_id
  where sp.verified
    and sp.cost_price is not null
    and coalesce(sp.quote_year, d.document_year) = p_year
    and not p.dismissed
    and public.fds_model_key(p.model) = any (p_model_keys)
    and case
          when coalesce(p_factory_id, '') <> '' then p.factory_id = p_factory_id
          else lower(btrim(coalesce(p.factories_display_name, ''))) = lower(btrim(coalesce(p_factory_name, '')))
        end;
$$;

revoke all on function public.fds_lookup_year_prices(text, text, int, text[]) from public, anon, authenticated;
grant execute on function public.fds_lookup_year_prices(text, text, int, text[]) to service_role;

create or replace function public.fds_resolve_supplier_price_conflict(p_price_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.supplier_prices%rowtype;
  v_cleared int;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  select * into v_row from public.supplier_prices where id = p_price_id;
  if v_row.id is null or not v_row.verified then
    raise exception 'price_not_found' using errcode = 'P0002';
  end if;

  update public.supplier_prices sp
  set price_conflict = (sp.id <> p_price_id)
  where sp.verified
    and sp.product_id = v_row.product_id
    and sp.quote_year is not distinct from v_row.quote_year
    and coalesce(sp.currency, '') = coalesce(v_row.currency, '')
    and coalesce(sp.unit, '') = coalesce(v_row.unit, '')
    and coalesce(sp.variant_label, '') = coalesce(v_row.variant_label, '');
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('id', p_price_id, 'group_size', v_cleared);
end;
$$;

revoke all on function public.fds_resolve_supplier_price_conflict(uuid) from public, anon;
grant execute on function public.fds_resolve_supplier_price_conflict(uuid) to authenticated;


create or replace function public.fds_import_extracted_products(
  p_document_id uuid,
  p_item_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.supplier_documents%rowtype;
  v_item public.extraction_items%rowtype;
  v_p jsonb;
  v_key text;
  v_product_id text;
  v_existing boolean;
  v_main_url text;
  v_images jsonb;
  v_variant text;
  v_currency text;
  v_price numeric;
  v_other jsonb;
  v_staff uuid := public.bwf_current_staff_id();
  v_created int := 0;
  v_linked int := 0;
  v_prices int := 0;
  v_n int;
  v_skipped jsonb := '[]'::jsonb;
  v_pending int;
  v_year int;
  v_other_variant text;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  select * into v_doc from public.supplier_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if coalesce(v_doc.factory_id, '') = '' and btrim(coalesce(v_doc.factory_name, '')) = '' then
    raise exception 'document_factory_missing' using errcode = '22023';
  end if;

  for v_item in
    select * from public.extraction_items e
    where e.document_id = p_document_id
      and e.status = 'approved'
      and e.imported_product_id is null
      and (p_item_ids is null or e.id = any (p_item_ids))
    order by e.seq
    for update
  loop
    v_p := v_item.raw_json || coalesce(v_item.corrected_json, '{}'::jsonb);
    if not public.fds_extraction_price_confirmed(v_doc.doc_type, v_item.raw_json, v_item.corrected_json, v_item.flags) then
      v_skipped := v_skipped || jsonb_build_object('id', v_item.id, 'reason', 'price_not_confirmed');
      continue;
    end if;
    v_key := public.fds_model_key(v_p ->> 'model');
    if v_key is null then
      v_skipped := v_skipped || jsonb_build_object('id', v_item.id, 'reason', 'missing_model');
      continue;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'fds-product:' || v_key || '|' ||
        case
          when coalesce(v_doc.factory_id, '') <> '' then 'id:' || v_doc.factory_id
          else 'name:' || lower(btrim(v_doc.factory_name))
        end,
        0
      )
    );

    select p.id into v_product_id
    from public.products p
    where public.fds_model_key(p.model) = v_key
      and not p.dismissed
      and case
            when coalesce(v_doc.factory_id, '') <> '' then p.factory_id = v_doc.factory_id
            else lower(btrim(coalesce(p.factories_display_name, ''))) = lower(btrim(v_doc.factory_name))
          end
    order by p.created_at
    limit 1;
    v_existing := v_product_id is not null;

    if not v_existing then
      select i.public_url into v_main_url
      from public.supplier_document_images i
      where i.id = coalesce(v_item.main_image_id, v_item.image_ids[1]) and i.image_type <> 'logo';

      select coalesce(jsonb_agg(jsonb_build_object('src', i.public_url, 'position', t.n, 'alt', coalesce(v_p ->> 'name', ''))
                                order by t.n), '[]'::jsonb)
        into v_images
      from unnest(v_item.image_ids) with ordinality as t(image_id, n)
      join public.supplier_document_images i on i.id = t.image_id
      where i.image_type <> 'logo';

      v_product_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 13);
      insert into public.products (
        id, title, description, model, factory_id, factories_display_name,
        dimension_l_mm, dimension_w_mm, dimension_h_mm, material, color, category,
        image_url, images, production_date, specifications, source, status,
        created_at, created_date, modified_date, creator_staff_id, editor_staff_id
      ) values (
        v_product_id,
        left(coalesce(nullif(btrim(v_p ->> 'name'), ''), btrim(v_p ->> 'model')), 500),
        coalesce(v_p ->> 'description', ''),
        btrim(v_p ->> 'model'),
        coalesce(v_doc.factory_id, ''),
        v_doc.factory_name,
        public.fds_try_numeric(v_p ->> 'width_mm'),
        public.fds_try_numeric(v_p ->> 'depth_mm'),
        public.fds_try_numeric(v_p ->> 'height_mm'),
        coalesce(v_p ->> 'material', ''),
        coalesce((select string_agg(c, ',') from jsonb_array_elements_text(
                    case when jsonb_typeof(v_p -> 'colors') = 'array' then v_p -> 'colors' else '[]'::jsonb end) c
                  where c ~ '^[A-Za-z]+$'), ''),
        coalesce(v_p ->> 'category', ''),
        coalesce(v_main_url, ''),
        v_images,
        round(public.fds_try_numeric(v_p ->> 'lead_time_days'))::int,
        nullif(concat_ws(E'\n',
                 nullif(v_p ->> 'series', '') ,
                 nullif(v_p ->> 'dimensions_text', '')), ''),
        'local',
        'draft',
        now(), now(), now(), v_staff, v_staff
      );
      v_created := v_created + 1;
    else
      v_linked := v_linked + 1;
    end if;

    v_currency := upper(nullif(btrim(coalesce(v_p ->> 'currency', v_doc.currency, '')), ''));
    v_year := v_doc.document_year;
    if v_year is null and coalesce(v_p ->> 'valid_from', '') ~ '^[0-9]{4}-' then
      v_year := substring(v_p ->> 'valid_from' from 1 for 4)::int;
    end if;
    if v_year is not null and (v_year < 1990 or v_year > 2100) then
      v_year := null;
    end if;
    v_price := public.fds_try_numeric(v_p ->> 'price');
    if exists (
      select 1 from public.supplier_prices sp
      where sp.product_id = v_product_id and sp.document_id = p_document_id
        and sp.extraction_item_id is distinct from v_item.id
    ) then
      v_variant := coalesce(
        nullif(left(concat_ws(' · ', nullif(v_p ->> 'name', ''), nullif(v_p ->> 'material', ''),
                              nullif(v_p ->> 'dimensions_text', '')), 200), ''),
        '#' || v_item.seq);
    else
      v_variant := null;
    end if;

    if v_price is not null and v_price >= 0 then
      insert into public.supplier_prices (
        product_id, factory_id, factory_name, document_id, extraction_item_id, page_no, variant_label,
        currency, unit, moq, cost_price, valid_from, valid_to, verified, raw_ref, creator_staff_id,
        quote_year, price_conflict
      ) values (
        v_product_id, nullif(v_doc.factory_id, ''), v_doc.factory_name, p_document_id, v_item.id, v_item.page_no,
        v_variant,
        v_currency, nullif(v_p ->> 'unit', ''), public.fds_try_numeric(v_p ->> 'moq'), v_price,
        public.fds_try_date(v_p ->> 'valid_from'), public.fds_try_date(v_p ->> 'valid_to'), true,
        jsonb_strip_nulls(jsonb_build_object('price_text', v_p ->> 'price_text', 'bbox', v_item.bbox)),
        v_staff, v_year, false
      )
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_prices := v_prices + v_n;
      if v_n > 0 then
        perform public.fds_refresh_price_year_conflict(
          v_product_id, v_year, v_currency, nullif(v_p ->> 'unit', ''), v_variant
        );
      end if;
    end if;

    if jsonb_typeof(v_p -> 'other_prices') = 'array' then
      for v_other in select * from jsonb_array_elements(v_p -> 'other_prices') loop
        continue when public.fds_try_numeric(v_other ->> 'price') is null
          or btrim(coalesce(v_other ->> 'label', '')) = '';
        v_other_variant := left(concat_ws(' · ', v_variant, btrim(v_other ->> 'label')), 200);
        insert into public.supplier_prices (
          product_id, factory_id, factory_name, document_id, extraction_item_id, page_no, variant_label,
          currency, unit, moq, cost_price, valid_from, valid_to, verified, raw_ref, creator_staff_id,
          quote_year, price_conflict
        ) values (
          v_product_id, nullif(v_doc.factory_id, ''), v_doc.factory_name, p_document_id, v_item.id, v_item.page_no,
          v_other_variant,
          v_currency, nullif(v_p ->> 'unit', ''), public.fds_try_numeric(v_p ->> 'moq'),
          public.fds_try_numeric(v_other ->> 'price'),
          public.fds_try_date(v_p ->> 'valid_from'), public.fds_try_date(v_p ->> 'valid_to'), true,
          jsonb_build_object('other_price', v_other), v_staff, v_year, false
        )
        on conflict do nothing;
        get diagnostics v_n = row_count;
        v_prices := v_prices + v_n;
        if v_n > 0 then
          perform public.fds_refresh_price_year_conflict(
            v_product_id, v_year, v_currency, nullif(v_p ->> 'unit', ''), v_other_variant
          );
        end if;
      end loop;
    end if;

    insert into public.product_source_refs (product_id, document_id, extraction_item_id, page_no, bbox)
    values (v_product_id, p_document_id, v_item.id, v_item.page_no, v_item.bbox)
    on conflict (product_id, document_id, page_no) do nothing;

    update public.extraction_items
    set imported_product_id = v_product_id, updated_at = now()
    where id = v_item.id;
  end loop;

  select count(*) into v_pending
  from public.extraction_items
  where document_id = p_document_id and status = 'pending';

  update public.supplier_documents
  set status = case when v_pending = 0 and status = 'review' then 'ready' else status end,
      editor_staff_id = v_staff,
      modified_date = now()
  where id = p_document_id;

  return jsonb_build_object(
    'created', v_created,
    'linked', v_linked,
    'prices', v_prices,
    'skipped', v_skipped,
    'pending', v_pending
  );
end;
$$;

create or replace function public.fds_search_products(
  p_query text default null,
  p_factory text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_colors text[] default null,
  p_materials text[] default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_l_min numeric default null,
  p_l_max numeric default null,
  p_w_min numeric default null,
  p_w_max numeric default null,
  p_h_min numeric default null,
  p_h_max numeric default null,
  p_in_stock boolean default null,
  p_scope text default 'all',
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0,
  p_since_days int default null,
  p_common boolean default null,
  p_document_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cost boolean;
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_terms text[];
  v_key text;
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_colors text[];
  v_materials text[];
  v_result jsonb;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_cost := public.bwf_has_role(array['admin', 'uploader']);
  v_terms := case when v_q = '' then '{}'::text[] else regexp_split_to_array(v_q, '\s+') end;
  v_key := public.fds_model_key(v_q);
  v_colors := public.fds_expand_color_terms(p_colors);
  v_materials := array(select lower(btrim(m)) from unnest(coalesce(p_materials, '{}')) m where btrim(m) <> '');

  with latest_quote as (
    -- 每個 quote_id 版本鏈的最新版本，排除回收桶（與報價一覽同一組語義）。
    select distinct on (btrim(q.quote_id)) q.id
    from public.bwf_quote q
    where q.quote_id is not null and btrim(q.quote_id) <> ''
      and coalesce(q.status, '') <> '回收桶'
    order by btrim(q.quote_id),
      case
        when q.version ~* '^v[0-9]+$' then substring(q.version from 2)::int
        when q.version ~* '^v[0-9]+[.][0-9]+$' then split_part(q.version, '.', 2)::int
        else 0
      end desc,
      q.created_at desc nulls last
  ),
  usage as (
    -- 每件產品在報價單裡的用量。p_common 為 false 時整段略過（planner 一時間過濾）。
    -- 欄名加 usage_ 前綴：quote_count 已被「供應商報價筆數」佔用。
    select
      qi.product_id,
      count(distinct qi.quote_uuid)::int as usage_quote_count,
      count(*)::int as usage_line_count,
      coalesce(sum(qi.quantity), 0)::numeric as usage_quantity_sum,
      coalesce(sum(qi.unit_price * qi.quantity), 0)::numeric as usage_amount_sum
    from public.bwf_quote_item qi
    join latest_quote lq on lq.id = qi.quote_uuid
    where p_common is true
      and qi.product_id is not null
      and coalesce(qi.is_section_title, false) = false
      and coalesce(qi.is_custom_term, false) = false
    group by qi.product_id
  ),
  demand as (
    -- 類別熱度：PMS 落單量經對照表落到 FDS level1。
    select
      m.fds_level1,
      sum(d.demand_qty * m.weight)::numeric as demand_qty,
      sum(d.order_lines * m.weight)::numeric as demand_lines
    from public.fds_pms_category_map m
    join public.fds_pms_category_demand d on d.pms_type = m.pms_type
    where p_common is true
    group by m.fds_level1
  ),
  base as (
    select p.id, p.title, p.model, p.sku, p.product_sku, p.image_url, p.image_url_2, p.image_url_3,
           p.lifestyle_image_url, p.factory_id, p.factories_display_name,
           p.dimension_l_mm, p.dimension_w_mm, p.dimension_h_mm, p.material, p.color, p.category,
           p.level1_category, p.level2_category, p.in_stock, p.customize, p.created_at,
           p.shopify_product_id, p.in_catalog, p.sale_price, p.cost_price,
           u.usage_quote_count, u.usage_line_count, u.usage_quantity_sum, u.usage_amount_sum,
           dm.demand_qty as category_demand_qty_raw, dm.demand_lines as category_demand_lines_raw,
           public.fds_product_haystack(p.title, p.model, p.sku, p.factories_display_name, p.color, p.material,
                                        p.category, p.level1_category, p.level2_category) as hay
    from public.products p
    left join usage u on u.product_id = p.id
    left join demand dm on dm.fds_level1 = coalesce(p.level1_category, '(未分類)')
    where not p.dismissed
      and (p_factory is null or p.factories_display_name = p_factory)
      and (p_level1 is null or p.level1_category = p_level1)
      and (p_level2 is null or p.level2_category = p_level2)
      and (p_in_stock is not true or p.in_stock is true)
      and (
        p_since_days is null or p_since_days <= 0
        or p.created_at >= now() - make_interval(days => least(p_since_days, 3650))
      )
      and (
        p_common is not true
        or coalesce(p_sort, '') = 'popular_demand'
        or (u.usage_quote_count is not null and u.usage_quote_count > 0)
      )
      and (
        p_document_id is null
        or exists (
          select 1 from public.product_source_refs src
          where src.product_id = p.id and src.document_id = p_document_id
        )
      )
      and (cardinality(v_colors) = 0 or exists (
            select 1 from unnest(v_colors) c where lower(coalesce(p.color, '')) like '%' || public.fds_like_escape(c) || '%'))
      and (cardinality(v_materials) = 0 or exists (
            select 1 from unnest(v_materials) m where lower(coalesce(p.material, '')) like '%' || public.fds_like_escape(m) || '%'))
      and (p_l_min is null or p.dimension_l_mm >= p_l_min)
      and (p_l_max is null or p.dimension_l_mm <= p_l_max)
      and (p_w_min is null or p.dimension_w_mm >= p_w_min)
      and (p_w_max is null or p.dimension_w_mm <= p_w_max)
      and (p_h_min is null or p.dimension_h_mm >= p_h_min)
      and (p_h_max is null or p.dimension_h_mm <= p_h_max)
      and case coalesce(p_scope, 'all')
            when 'catalog' then p.in_catalog
            when 'shopify' then p.shopify_product_id is not null
            when 'quoted' then exists (select 1 from public.supplier_prices sp where sp.product_id = p.id and sp.verified)
            else true
          end
  ),
  matched as (
    select b.*
    from base b
    where not exists (
      select 1 from unnest(v_terms) t
      where not (
        b.hay like '%' || public.fds_like_escape(t) || '%'
        or (public.fds_model_key(t) is not null and b.hay like '%' || public.fds_like_escape(public.fds_model_key(t)) || '%')
      )
    )
  ),
  priced as (
    select m.*,
           cur.id as price_id, cur.cost_price as quote_cost, cur.currency, cur.unit, cur.moq,
           cur.valid_from, cur.valid_to, cur.variant_label, cur.factory_name as quote_factory,
           (select count(*) from public.supplier_prices sp2 where sp2.product_id = m.id and sp2.verified) as quote_count,
           (select count(*) from public.supplier_prices spc where spc.product_id = m.id and spc.verified and spc.price_conflict) as conflict_count,
           case when m.sale_price > 0 then round(m.sale_price * 0.8, 2) end as middle_price,
           case
             when v_key is not null and (public.fds_model_key(m.model) = v_key
                                         or public.fds_model_key(m.sku) = v_key
                                         or public.fds_model_key(m.product_sku) = v_key) then 0
             when v_key is not null and public.fds_model_key(m.model) like public.fds_like_escape(v_key) || '%' then 1
             when v_q <> '' and lower(m.title) like public.fds_like_escape(v_q) || '%' then 2
             else 3
           end as rank,
           case when v_q = '' then 0 else public.similarity(m.hay, v_q) end as sim
    from matched m
    left join lateral (
      select sp.*
      from public.supplier_prices sp
      where sp.product_id = m.id and sp.verified and not sp.price_conflict
      order by sp.quote_year desc nulls last, (sp.variant_label is null) desc, sp.created_at desc
      limit 1
    ) cur on true
  ),
  shown as (
    select pr.*,
           pr.middle_price as display_price
    from priced pr
  ),
  filtered as (
    select s.*, count(*) over () as total
    from shown s
    where (p_price_min is null or s.display_price >= p_price_min)
      and (p_price_max is null or s.display_price <= p_price_max)
  ),
  page as (
    select f.*
    from filtered f
    order by
      case when p_common is true and p_sort = 'popular_demand' then f.category_demand_qty_raw end desc nulls last,
      case when p_common is true and p_sort = 'popular_demand' then f.usage_quote_count end desc nulls last,
      case when p_common is true and p_sort = 'popular_demand' then f.usage_quantity_sum end desc nulls last,
      case when p_common is true and p_sort = 'popular_quantity' then f.usage_quantity_sum end desc nulls last,
      case when p_common is true and p_sort = 'popular_amount' then f.usage_amount_sum end desc nulls last,
      case when p_common is true and coalesce(p_sort, 'relevance') not in ('popular_quantity', 'popular_amount') then f.usage_quote_count end desc nulls last,
      case when coalesce(p_sort, 'relevance') = 'relevance' then f.rank end,
      case when coalesce(p_sort, 'relevance') = 'relevance' then (f.in_stock is true) end desc,
      case when coalesce(p_sort, 'relevance') = 'relevance' then f.sim end desc,
      case when p_sort = 'price_asc' then f.display_price end asc nulls last,
      case when p_sort = 'price_desc' then f.display_price end desc nulls last,
      case when p_sort = 'size' then f.dimension_l_mm end asc nulls last,
      f.created_at desc,
      f.id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', coalesce((select max(total) from filtered), 0),
    'can_view_cost', false,
    'can_open_source', v_cost,
    'items', coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', pg.id,
        'title', pg.title,
        'model', nullif(pg.model, ''),
        'sku', nullif(pg.sku, ''),
        'image_url', nullif(pg.image_url, ''),
        'image_urls', (
          select coalesce(jsonb_agg(u order by ord), '[]'::jsonb)
          from (
            select t.u, t.ord
            from unnest(array[
              nullif(btrim(pg.image_url), ''),
              nullif(btrim(pg.image_url_2), ''),
              nullif(btrim(pg.image_url_3), ''),
              nullif(btrim(pg.lifestyle_image_url), '')
            ]) with ordinality as t(u, ord)
            where t.u ~* '^https?://'
          ) urls
        ),
        'factory_id', nullif(pg.factory_id, ''),
        'factory_name', nullif(pg.factories_display_name, ''),
        'dimension_l_mm', pg.dimension_l_mm,
        'dimension_w_mm', pg.dimension_w_mm,
        'dimension_h_mm', pg.dimension_h_mm,
        'material', nullif(pg.material, ''),
        'color', nullif(pg.color, ''),
        'category', nullif(pg.category, ''),
        'level1_category', pg.level1_category,
        'level2_category', pg.level2_category,
        'in_stock', pg.in_stock,
        'lead_time', nullif(pg.customize, ''),
        'created_at', pg.created_at,
        'on_shopify', pg.shopify_product_id is not null,
        'in_catalog', pg.in_catalog,
        'middle_price', pg.middle_price,
        'sale_price', case when pg.sale_price > 0 then pg.sale_price end,
        'legacy_cost', null,
        'exact', pg.rank = 0,
        'price_status', case
          when pg.price_id is not null then 'matched'
          when coalesce(pg.conflict_count, 0) > 0 then 'conflict'
          else 'unmatched'
        end,
        'usage_quote_count', pg.usage_quote_count,
        'usage_line_count', pg.usage_line_count,
        'usage_quantity', pg.usage_quantity_sum,
        'usage_amount', pg.usage_amount_sum,
        'category_demand_qty', case when pg.category_demand_qty_raw is null then null else round(pg.category_demand_qty_raw)::int end,
        'category_demand_lines', case when pg.category_demand_lines_raw is null then null else round(pg.category_demand_lines_raw)::int end,
        'quote', case when pg.price_id is not null then jsonb_strip_nulls(jsonb_build_object(
          'cost', null,
          'currency', pg.currency,
          'unit', pg.unit,
          'moq', pg.moq,
          'variant_label', pg.variant_label,
          'factory_name', pg.quote_factory,
          'valid_from', pg.valid_from,
          'valid_to', pg.valid_to,
          'validity', case
            when pg.valid_to is not null and pg.valid_to < current_date then 'expired'
            when pg.valid_from is not null and pg.valid_from > current_date then 'future'
            when pg.valid_to is null then 'unmarked'
            else 'valid'
          end,
          'count', pg.quote_count
        )) end,
        'source', (
          select jsonb_build_object('document_id', d.id, 'title', d.title, 'page_no', r.page_no, 'doc_type', d.doc_type)
          from public.product_source_refs r
          join public.supplier_documents d on d.id = r.document_id
          where r.product_id = pg.id
          order by r.created_at desc
          limit 1
        )
      ))
      order by
        case when p_common is true and p_sort = 'popular_demand' then pg.category_demand_qty_raw end desc nulls last,
        case when p_common is true and p_sort = 'popular_demand' then pg.usage_quote_count end desc nulls last,
        case when p_common is true and p_sort = 'popular_demand' then pg.usage_quantity_sum end desc nulls last,
        case when p_common is true and p_sort = 'popular_quantity' then pg.usage_quantity_sum end desc nulls last,
        case when p_common is true and p_sort = 'popular_amount' then pg.usage_amount_sum end desc nulls last,
        case when p_common is true and coalesce(p_sort, 'relevance') not in ('popular_quantity', 'popular_amount') then pg.usage_quote_count end desc nulls last,
        case when coalesce(p_sort, 'relevance') = 'relevance' then pg.rank end,
        case when coalesce(p_sort, 'relevance') = 'relevance' then (pg.in_stock is true) end desc,
        case when coalesce(p_sort, 'relevance') = 'relevance' then pg.sim end desc,
        case when p_sort = 'price_asc' then pg.display_price end asc nulls last,
        case when p_sort = 'price_desc' then pg.display_price end desc nulls last,
        case when p_sort = 'size' then pg.dimension_l_mm end asc nulls last,
        pg.created_at desc,
        pg.id
    ), '[]'::jsonb)
  )
  into v_result
  from page pg;

  return v_result;
end;
$$;

create or replace function public.fds_product_detail(p_product_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cost boolean;
  v_result jsonb;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_cost := public.bwf_has_role(array['admin', 'uploader']);

  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'model', nullif(p.model, ''),
    'sku', nullif(p.sku, ''),
    'description', nullif(p.description, ''),
    'specifications', nullif(p.specifications, ''),
    'remarks', case when v_cost then nullif(p.remarks, '') end,
    'factory_id', nullif(p.factory_id, ''),
    'factory_name', nullif(p.factories_display_name, ''),
    'dimension_l_mm', p.dimension_l_mm,
    'dimension_w_mm', p.dimension_w_mm,
    'dimension_h_mm', p.dimension_h_mm,
    'material', nullif(p.material, ''),
    'color', nullif(p.color, ''),
    'category', nullif(p.category, ''),
    'level1_category', p.level1_category,
    'level2_category', p.level2_category,
    'in_stock', p.in_stock,
    'lead_time', nullif(p.customize, ''),
    'created_at', p.created_at,
    'on_shopify', p.shopify_product_id is not null,
    'in_catalog', p.in_catalog,
    'middle_price', case when p.sale_price > 0 then round(p.sale_price * 0.8, 2) end,
    'sale_price', case when p.sale_price > 0 then p.sale_price end,
    'legacy_cost', case when v_cost then p.cost_price end,
    'can_view_cost', v_cost,
    -- 私有原文只限 admin / uploader；pm / designer 拿不到檔案路徑。
    'can_open_source', v_cost,
    'usage', (
      select jsonb_build_object(
        'quote_count', count(distinct qi.quote_uuid)::int,
        'line_count', count(*)::int,
        'quantity_sum', coalesce(sum(qi.quantity), 0)::numeric,
        'amount_sum', coalesce(sum(qi.unit_price * qi.quantity), 0)::numeric
      )
      from public.bwf_quote_item qi
      join (
        select distinct on (btrim(q.quote_id)) q.id
        from public.bwf_quote q
        where q.quote_id is not null and btrim(q.quote_id) <> ''
          and coalesce(q.status, '') <> '回收桶'
        order by btrim(q.quote_id),
          case
            when q.version ~* '^v[0-9]+$' then substring(q.version from 2)::int
            when q.version ~* '^v[0-9]+[.][0-9]+$' then split_part(q.version, '.', 2)::int
            else 0
          end desc,
          q.created_at desc nulls last
      ) lq on lq.id = qi.quote_uuid
      where qi.product_id = p.id
        and coalesce(qi.is_section_title, false) = false
        and coalesce(qi.is_custom_term, false) = false
    ),
    'category_demand', (
      select jsonb_build_object(
        'level1', m.fds_level1,
        'qty', round(coalesce(sum(d.demand_qty * m.weight), 0))::int,
        'lines', round(coalesce(sum(d.order_lines * m.weight), 0))::int
      )
      from public.fds_pms_category_map m
      join public.fds_pms_category_demand d on d.pms_type = m.pms_type
      where m.fds_level1 = coalesce(p.level1_category, '(未分類)')
      group by m.fds_level1
    ),
    'images', (
      select coalesce(jsonb_agg(u.src order by u.ord), '[]'::jsonb)
      from (
        select distinct on (x.src) x.src, x.ord
        from (
          select p.image_url as src, 0 as ord
          union all
          select e ->> 'src', 1 + coalesce(public.fds_try_numeric(e ->> 'position'), n)
          from jsonb_array_elements(case when jsonb_typeof(p.images) = 'array' then p.images else '[]'::jsonb end)
               with ordinality as t(e, n)
          union all select p.image_url_2, 1000
          union all select p.image_url_3, 1001
          union all select p.lifestyle_image_url, 1002
        ) x
        where x.src like 'http%'
        order by x.src, x.ord
      ) u
    ),
    'prices', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', sp.id,
        'cost', case when v_cost then sp.cost_price end,
        'currency', sp.currency,
        'unit', sp.unit,
        'moq', sp.moq,
        'variant_label', sp.variant_label,
        'factory_name', sp.factory_name,
        'valid_from', sp.valid_from,
        'valid_to', sp.valid_to,
        'validity', case
          when sp.valid_to is not null and sp.valid_to < current_date then 'expired'
          when sp.valid_from is not null and sp.valid_from > current_date then 'future'
          when sp.valid_to is null then 'unmarked'
          else 'valid'
        end,
        'page_no', sp.page_no,
        'document_id', sp.document_id,
        'document_title', d.title,
        'bbox', sp.raw_ref -> 'bbox',
        'storage_path', case when v_cost then d.storage_path end,
        'quote_year', sp.quote_year,
        'price_conflict', sp.price_conflict,
        'created_at', sp.created_at
      )) order by sp.quote_year desc nulls last, sp.created_at desc), '[]'::jsonb)
      from public.supplier_prices sp
      left join public.supplier_documents d on d.id = sp.document_id
      where sp.product_id = p.id and sp.verified
    ),
    'sources', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'document_id', d.id,
        'title', d.title,
        'factory_name', d.factory_name,
        'doc_type', d.doc_type,
        'page_no', r.page_no,
        'bbox', coalesce(r.bbox, e.bbox),
        'storage_path', case when v_cost then d.storage_path end,
        'created_at', r.created_at
      )) order by r.created_at desc), '[]'::jsonb)
      from public.product_source_refs r
      join public.supplier_documents d on d.id = r.document_id
      left join public.extraction_items e on e.id = r.extraction_item_id
      where r.product_id = p.id
    )
  ))
  into v_result
  from public.products p
  where p.id = p_product_id;

  if v_result is null then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

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
           p.sale_price,
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
           -- 同規格（單位 + 規格標籤）才排在一起，漲跌只在同一組內比較。
           row_number() over (
             partition by sp.product_id,
                          coalesce(sp.unit, ''),
                          coalesce(sp.variant_label, '')
             order by
               sp.quote_year desc nulls last,
               case
                 when (sp.valid_to is null or sp.valid_to >= current_date)
                  and (sp.valid_from is null or sp.valid_from <= current_date) then 0
                 else 1
               end,
               sp.created_at desc
           ) as rn
    from public.supplier_prices sp
    left join public.supplier_documents d on d.id = sp.document_id
    where sp.verified and not sp.price_conflict and sp.product_id in (select id from peers)
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
        -- 中間價（售價 × 0.8）與原價：任何角色都看得到，成本才遮蔽。
        'middle_price', case when p.sale_price > 0 then round(p.sale_price * 0.8, 2) end,
        'sale_price', case when p.sale_price > 0 then p.sale_price end,
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
          )) order by coalesce(r.variant_label, ''), coalesce(r.unit, ''), r.rn)
          from ranked r
          left join lateral (
            -- 上一筆必須是同規格同單位的報價，否則不產生漲跌。
            select p2.cost_price
            from ranked p2
            where p2.product_id = r.product_id
              and coalesce(p2.unit, '') = coalesce(r.unit, '')
              and coalesce(p2.variant_label, '') = coalesce(r.variant_label, '')
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

notify pgrst, 'reload schema';

-- Quote catalog (A-class) used to scan shopify_products + ready_to_shopify in the
-- browser, then fan out products?id=in.(...) in chunks of 200 (each with a CORS
-- preflight). One RPC returns the current page already joined, filtered, and sorted.
-- PostgREST max-rows would truncate a set-returning list, so this returns one jsonb.

create or replace function public.catalog_split_product_type(p_type text)
returns table(level1 text, level2 text)
language sql
immutable
set search_path = public
as $$
  with parts as (
    select coalesce(
      array_agg(btrim(u.x) order by u.ord),
      array[]::text[]
    ) as parts
    from unnest(string_to_array(coalesce(p_type, ''), '/')) with ordinality as u(x, ord)
    where btrim(u.x) <> ''
  )
  select
    case when cardinality(parts) >= 2 then parts[1] else null end,
    case
      when cardinality(parts) >= 2 then parts[cardinality(parts)]
      when cardinality(parts) = 1 then parts[1]
      else null
    end
  from parts;
$$;

create or replace function public.get_quote_catalog_page(
  p_search text default null,
  p_factory text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_priority text[] default null,
  p_stock_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(coalesce(p_search, '')), '') as search,
      nullif(btrim(coalesce(p_factory, '')), '') as factory,
      nullif(btrim(coalesce(p_level1, '')), '') as level1,
      nullif(btrim(coalesce(p_level2, '')), '') as level2,
      coalesce(p_priority, array[]::text[]) as priority,
      coalesce(p_stock_only, false) as stock_only,
      greatest(1, least(coalesce(p_limit, 20), 100)) as lim,
      greatest(0, coalesce(p_offset, 0)) as off
  ),
  sp as (
    select
      sp.id::text as row_id,
      'shopify'::text as source_kind,
      0 as source_rank,
      nullif(btrim(sp.source_product_id), '') as product_id,
      nullif(btrim(sp.shopify_product_id), '') as shopify_product_id,
      coalesce(nullif(btrim(sp.title), ''), nullif(btrim(p.title), ''), '') as title,
      coalesce(
        nullif(btrim(sp.sku), ''),
        (
          select nullif(btrim(v->>'sku'), '')
          from jsonb_array_elements(
            case
              when jsonb_typeof(sp.variants) = 'array' then sp.variants
              else '[]'::jsonb
            end
          ) v
          where nullif(btrim(v->>'sku'), '') is not null
          limit 1
        ),
        nullif(btrim(p.sku), '')
      ) as sku,
      public.light_http_image_url(sp.image_url, p.image_url) as image_url,
      coalesce(sp.price, p.sale_price, p.price) as sale_price,
      coalesce(sp.cost, p.cost_price) as cost_price,
      coalesce(nullif(btrim(sp.vendor), ''), nullif(btrim(p.factories_display_name), '')) as factory_name,
      coalesce(nullif(btrim(p.level2_category), ''), lv.level2, nullif(btrim(p.category), '')) as category,
      coalesce(nullif(btrim(p.level1_category), ''), lv.level1) as level1_category,
      coalesce(nullif(btrim(p.level2_category), ''), lv.level2) as level2_category,
      nullif(btrim(p.product_category_id::text), '') as product_category_id,
      nullif(btrim(p.material), '') as material,
      p.dimension_l_mm as dimension_l_mm,
      p.dimension_w_mm as dimension_w_mm,
      p.dimension_h_mm as dimension_h_mm,
      nullif(btrim(p.color), '') as color,
      nullif(btrim(p.remarks), '') as remarks,
      nullif(btrim(p.delivery_term_name), '') as delivery_term_name,
      coalesce(sp.imported_at, sp.published_at, sp.shopify_updated_at) as sort_ts
    from public.shopify_products sp
    left join public.products p on p.id = sp.source_product_id
    left join lateral public.catalog_split_product_type(sp.product_type) lv on true
    cross join params
    where sp.configurable is null
      and (
        params.search is null
        or strpos(lower(coalesce(sp.title, '')), lower(params.search)) > 0
        or strpos(lower(coalesce(sp.sku, '')), lower(params.search)) > 0
      )
      and (
        params.factory is null
        or btrim(coalesce(sp.vendor, '')) = params.factory
      )
      and (
        not params.stock_only
        or btrim(coalesce(sp."my_fields.production_time", '')) in ('3-7天', '3-7天送貨')
        or btrim(coalesce(sp.customize, '')) in ('3-7天', '3-7天送貨')
        or sp.in_stock is true
      )
  ),
  rts as (
    select
      r.id::text as row_id,
      'rts'::text as source_kind,
      1 as source_rank,
      nullif(btrim(r.product_id), '') as product_id,
      nullif(btrim(r.shopify_product_id), '') as shopify_product_id,
      coalesce(nullif(btrim(r.title), ''), nullif(btrim(p.title), ''), '') as title,
      coalesce(nullif(btrim(r.sku), ''), nullif(btrim(p.sku), '')) as sku,
      public.light_http_image_url(r.image_url, p.image_url) as image_url,
      coalesce(r.price, p.sale_price, p.price) as sale_price,
      coalesce(r.cost, p.cost_price) as cost_price,
      coalesce(nullif(btrim(r.vendor), ''), nullif(btrim(p.factories_display_name), '')) as factory_name,
      coalesce(nullif(btrim(p.level2_category), ''), lv.level2, nullif(btrim(p.category), '')) as category,
      coalesce(nullif(btrim(p.level1_category), ''), lv.level1) as level1_category,
      coalesce(nullif(btrim(p.level2_category), ''), lv.level2) as level2_category,
      nullif(btrim(p.product_category_id::text), '') as product_category_id,
      coalesce(nullif(btrim(r.material), ''), nullif(btrim(p.material), '')) as material,
      coalesce(r.dimension_l_mm::numeric, p.dimension_l_mm) as dimension_l_mm,
      coalesce(r.dimension_w_mm::numeric, p.dimension_w_mm) as dimension_w_mm,
      coalesce(r.dimension_h_mm::numeric, p.dimension_h_mm) as dimension_h_mm,
      coalesce(nullif(btrim(r.color), ''), nullif(btrim(p.color), '')) as color,
      coalesce(nullif(btrim(r.remarks), ''), nullif(btrim(p.remarks), '')) as remarks,
      nullif(btrim(p.delivery_term_name), '') as delivery_term_name,
      r.imported_at as sort_ts
    from public.ready_to_shopify r
    left join public.products p on p.id = r.product_id
    left join lateral public.catalog_split_product_type(r.product_type) lv on true
    cross join params
    where (
        params.search is null
        or strpos(lower(coalesce(r.title, '')), lower(params.search)) > 0
        or strpos(lower(coalesce(r.sku, '')), lower(params.search)) > 0
      )
      and (
        params.factory is null
        or btrim(coalesce(r.vendor, '')) = params.factory
      )
      and (
        not params.stock_only
        or r.in_stock is true
        or btrim(coalesce(r.customize, '')) in ('3-7天', '3-7天送貨')
      )
  ),
  deduped as (
    select distinct on (dedupe_key)
      dedupe_key,
      row_id,
      source_kind,
      source_rank,
      product_id,
      shopify_product_id,
      title,
      sku,
      image_url,
      sale_price,
      cost_price,
      factory_name,
      category,
      level1_category,
      level2_category,
      product_category_id,
      material,
      dimension_l_mm,
      dimension_w_mm,
      dimension_h_mm,
      color,
      remarks,
      delivery_term_name,
      sort_ts
    from (
      select
        case
          when product_id is not null then 'pid:' || product_id
          when shopify_product_id is not null then 'shopify:' || shopify_product_id
          when nullif(btrim(sku), '') is not null then 'sku:' || lower(btrim(sku))
          else source_kind || ':' || row_id
        end as dedupe_key,
        u.*
      from (
        select * from sp
        union all
        select * from rts
      ) u
    ) tagged
    order by dedupe_key, source_rank
  ),
  filtered as materialized (
    select
      d.*,
      case
        when params.level1 is null and cardinality(params.priority) > 0 then
          coalesce(
            array_position(
              array(
                select btrim(x)
                from unnest(params.priority) as x
                where btrim(x) <> ''
              ),
              btrim(coalesce(d.level1_category, ''))
            ),
            9999
          )
        else d.source_rank
      end as sort_key
    from deduped d
    cross join params
    where btrim(coalesce(d.title, '')) <> ''
      and (
        params.level2 is not null
        or params.level1 is null
        or btrim(coalesce(d.level1_category, '')) = params.level1
      )
      and (
        params.level2 is null
        or btrim(coalesce(d.level2_category, d.category, '')) = params.level2
      )
  ),
  numbered as (
    select
      f.*,
      row_number() over (
        order by f.sort_key, f.sort_ts desc nulls last, f.source_kind, f.row_id
      ) as ord
    from filtered f
  )
  select jsonb_build_object(
    'total', (select count(*)::int from filtered),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.source_kind || ':' || n.row_id,
          'sourceKind', n.source_kind,
          'productId', n.product_id,
          'title', n.title,
          'sku', n.sku,
          'image_url', n.image_url,
          'sale_price', n.sale_price,
          'cost_price', n.cost_price,
          'factory_name', n.factory_name,
          'category', n.category,
          'level1_category', n.level1_category,
          'level2_category', n.level2_category,
          'product_category_id', n.product_category_id,
          'material', n.material,
          'dimension_l_mm', n.dimension_l_mm,
          'dimension_w_mm', n.dimension_w_mm,
          'dimension_h_mm', n.dimension_h_mm,
          'color', n.color,
          'remarks', n.remarks,
          'delivery_term_name', n.delivery_term_name,
          'shopify_product_id', n.shopify_product_id,
          'sort_ts', n.sort_ts
        )
        order by n.ord
      )
      from numbered n
      cross join params
      where n.ord > params.off
        and n.ord <= params.off + params.lim
    ), '[]'::jsonb)
  );
$$;

create or replace function public.quote_catalog_factory_names(p_source text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
  from (
    select distinct btrim(name) as name
    from (
      select vendor as name
      from public.shopify_products
      where p_source = 'shopify'
        and configurable is null
      union all
      select vendor
      from public.ready_to_shopify
      where p_source = 'shopify'
      union all
      select factories_display_name
      from public.products
      where p_source = 'system'
    ) raw
    where nullif(btrim(coalesce(name, '')), '') is not null
  ) names;
$$;

grant execute on function public.catalog_split_product_type(text) to anon, authenticated;
grant execute on function public.get_quote_catalog_page(text, text, text, text, text[], boolean, integer, integer) to anon, authenticated;
grant execute on function public.quote_catalog_factory_names(text) to anon, authenticated;

notify pgrst, 'reload schema';

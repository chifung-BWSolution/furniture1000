-- Server-side pagination RPCs for 傢俬組檢查 / 準備上載, plus lightweight factory lists.

create index if not exists ready_to_shopify_fg_check_idx
  on public.ready_to_shopify (furniture_group_checked, info_completed_at desc nulls last, imported_at desc)
  where furniture_group_checked = false;

create index if not exists ready_to_shopify_ready_publish_idx
  on public.ready_to_shopify (furniture_group_checked, ready_to_publish_at desc nulls last, imported_at desc)
  where furniture_group_checked = true;

create index if not exists ready_to_shopify_publish_queue_idx
  on public.ready_to_shopify (in_shopify_queue, copy_done, info_done);

-- A5: distinct factory/vendor names per publish queue stage
create or replace function public.get_publish_rts_factories(p_stage text)
returns setof text
language sql
stable
as $$
  select distinct coalesce(nullif(trim(r.vendor), ''), nullif(trim(p.factories_display_name), ''))
  from public.ready_to_shopify r
  join public.products p on p.id = r.product_id
  where p.shopify_product_id is null
    and coalesce(nullif(trim(r.vendor), ''), nullif(trim(p.factories_display_name), '')) is not null
    and (
      (p_stage = 'copywriting'
        and r.in_shopify_queue is true
        and coalesce(r.copy_done, false) = false)
      or (p_stage = 'product-info'
        and r.in_shopify_queue is true
        and r.info_done = false
        and r.copy_done = true)
      or (p_stage = 'fg-check'
        and r.furniture_group_checked = false)
      or (p_stage = 'ready-to-publish'
        and r.furniture_group_checked = true)
    )
  order by 1;
$$;

grant execute on function public.get_publish_rts_factories(text) to anon, authenticated;

-- A2: 傢俬組檢查 — dedupe by product_id, server-side filters + pagination
create or replace function public.get_fg_check_count(
  p_search text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_factory text default null
)
returns integer
language sql
stable
as $$
  with deduped as (
    select distinct on (r.product_id)
      r.id,
      r.product_id,
      r.title,
      r.sku,
      r.vendor,
      r.product_type
    from public.ready_to_shopify r
    join public.products p on p.id = r.product_id
    where r.furniture_group_checked = false
      and p.shopify_product_id is null
    order by r.product_id, r.info_completed_at desc nulls last, r.imported_at desc nulls last
  )
  select count(*)::integer
  from deduped d
  where (
      nullif(trim(coalesce(p_search, '')), '') is null
      or d.title ilike ('%' || trim(p_search) || '%')
      or d.sku ilike ('%' || trim(p_search) || '%')
    )
    and (nullif(trim(coalesce(p_level1, '')), '') is null or split_part(coalesce(d.product_type, ''), ' / ', 1) = p_level1)
    and (nullif(trim(coalesce(p_level2, '')), '') is null or split_part(coalesce(d.product_type, ''), ' / ', 2) = p_level2)
    and (
      nullif(trim(coalesce(p_factory, '')), '') is null
      or d.vendor = p_factory
    );
$$;

grant execute on function public.get_fg_check_count(text, text, text, text) to anon, authenticated;

create or replace function public.get_fg_check_rows(
  p_search text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_factory text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns setof jsonb
language sql
stable
as $$
  with deduped as (
    select distinct on (r.product_id)
      r.id,
      r.product_id,
      r.title,
      r.image_url,
      r.vendor,
      r.product_type,
      r.price,
      r.tags,
      r.sku,
      r.info_completed_at,
      r.imported_at
    from public.ready_to_shopify r
    join public.products p on p.id = r.product_id
    where r.furniture_group_checked = false
      and p.shopify_product_id is null
    order by r.product_id, r.info_completed_at desc nulls last, r.imported_at desc nulls last
  )
  select jsonb_build_object(
    'id', d.id,
    'product_id', d.product_id,
    'title', d.title,
    'image_url', d.image_url,
    'vendor', d.vendor,
    'product_type', d.product_type,
    'price', d.price,
    'tags', d.tags,
    'sku', d.sku,
    'info_completed_at', d.info_completed_at,
    'imported_at', d.imported_at
  )
  from deduped d
  where (
      nullif(trim(coalesce(p_search, '')), '') is null
      or d.title ilike ('%' || trim(p_search) || '%')
      or d.sku ilike ('%' || trim(p_search) || '%')
    )
    and (nullif(trim(coalesce(p_level1, '')), '') is null or split_part(coalesce(d.product_type, ''), ' / ', 1) = p_level1)
    and (nullif(trim(coalesce(p_level2, '')), '') is null or split_part(coalesce(d.product_type, ''), ' / ', 2) = p_level2)
    and (
      nullif(trim(coalesce(p_factory, '')), '') is null
      or d.vendor = p_factory
    )
  order by d.info_completed_at desc nulls last, d.imported_at desc nulls last
  limit greatest(0, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.get_fg_check_rows(text, text, text, text, integer, integer) to anon, authenticated;

-- A3: 準備上載 — lightweight list (no body_html / images jsonb)
create or replace function public.get_ready_to_publish_count(
  p_search text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_factory text default null
)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.ready_to_shopify r
  join public.products p on p.id = r.product_id
  where r.furniture_group_checked = true
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or r.title ilike ('%' || trim(p_search) || '%')
      or r.sku ilike ('%' || trim(p_search) || '%')
      or p.model ilike ('%' || trim(p_search) || '%')
      or p.factory_id ilike ('%' || trim(p_search) || '%')
    )
    and (nullif(trim(coalesce(p_level1, '')), '') is null or p.level1_category = p_level1)
    and (nullif(trim(coalesce(p_level2, '')), '') is null or p.level2_category = p_level2)
    and (
      nullif(trim(coalesce(p_factory, '')), '') is null
      or r.vendor = p_factory
      or p.factories_display_name = p_factory
    );
$$;

grant execute on function public.get_ready_to_publish_count(text, text, text, text) to anon, authenticated;

create or replace function public.get_ready_to_publish_rows(
  p_search text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_factory text default null,
  p_sort text default 'ready_at',
  p_sort_asc boolean default false,
  p_limit integer default 25,
  p_offset integer default 0
)
returns setof jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', r.id,
    'product_id', r.product_id,
    'title', r.title,
    'image_url', r.image_url,
    'vendor', r.vendor,
    'product_type', r.product_type,
    'variants', r.variants,
    'tags', r.tags,
    'price', r.price,
    'compare_at_price', r.compare_at_price,
    'shopify_product_id', r.shopify_product_id,
    'status', r.status,
    'ready_to_publish_at', r.ready_to_publish_at,
    'imported_at', r.imported_at,
    'sku', r.sku,
    'products', jsonb_build_object(
      'id', p.id,
      'sku', p.sku,
      'model', p.model,
      'factory_id', p.factory_id,
      'cost_price', p.cost_price,
      'sale_price', p.sale_price,
      'dimension_l_mm', p.dimension_l_mm,
      'dimension_w_mm', p.dimension_w_mm,
      'dimension_h_mm', p.dimension_h_mm,
      'tags', p.tags,
      'category', p.category,
      'level1_category', p.level1_category,
      'level2_category', p.level2_category,
      'material', p.material,
      'factory_id', p.factory_id,
      'bwf_master_id', p.bwf_master_id,
      'production_date', p.production_date,
      'shipping_days', p.shipping_days,
      'shipping_fee', p.shipping_fee,
      'remarks', p.remarks,
      'in_stock', p.in_stock,
      'customize', p.customize,
      'factories_display_name', p.factories_display_name
    )
  )
  from public.ready_to_shopify r
  join public.products p on p.id = r.product_id
  where r.furniture_group_checked = true
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or r.title ilike ('%' || trim(p_search) || '%')
      or r.sku ilike ('%' || trim(p_search) || '%')
      or p.model ilike ('%' || trim(p_search) || '%')
      or p.factory_id ilike ('%' || trim(p_search) || '%')
    )
    and (nullif(trim(coalesce(p_level1, '')), '') is null or p.level1_category = p_level1)
    and (nullif(trim(coalesce(p_level2, '')), '') is null or p.level2_category = p_level2)
    and (
      nullif(trim(coalesce(p_factory, '')), '') is null
      or r.vendor = p_factory
      or p.factories_display_name = p_factory
    )
  order by
    case when coalesce(p_sort, 'ready_at') = 'sku' and p_sort_asc then r.sku end asc nulls last,
    case when coalesce(p_sort, 'ready_at') = 'sku' and not p_sort_asc then r.sku end desc nulls last,
    case when coalesce(p_sort, 'ready_at') <> 'sku' then r.ready_to_publish_at end desc nulls last,
    r.imported_at desc nulls last
  limit greatest(0, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.get_ready_to_publish_rows(text, text, text, text, text, boolean, integer, integer) to anon, authenticated;

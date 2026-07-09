-- Parent SKU for rows merged as variants under a host product (mirrors shopify_products.configurable).
alter table public.ready_to_shopify
  add column if not exists configurable text;

comment on column public.ready_to_shopify.configurable is
  'When set, this RTS row was merged as a variant under the host product with this SKU.';

create index if not exists ready_to_shopify_configurable_idx
  on public.ready_to_shopify (configurable)
  where configurable is not null;

-- 準備上載 list: standalone / host rows only (configurable IS NULL), same as shopify_products.
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
        and r.furniture_group_checked = true
        and r.configurable is null)
    )
  order by 1;
$$;

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
    and r.configurable is null
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
    'configurable', r.configurable,
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
    and r.configurable is null
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

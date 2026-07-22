-- Expose products.error_message / status in 準備上載 list RPC for failed publish feedback.

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
      'bwf_master_id', p.bwf_master_id,
      'production_date', p.production_date,
      'shipping_days', p.shipping_days,
      'shipping_fee', p.shipping_fee,
      'remarks', p.remarks,
      'in_stock', p.in_stock,
      'customize', p.customize,
      'factories_display_name', p.factories_display_name,
      'status', p.status,
      'error_message', p.error_message
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
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

notify pgrst, 'reload schema';

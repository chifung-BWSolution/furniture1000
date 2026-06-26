create or replace function public.get_publish_rts_count(
  p_stage text,
  p_search text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_factories text[] default null
)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.ready_to_shopify r
  join public.products p on p.id = r.product_id
  where p.shopify_product_id is null
    and (
      (p_stage = 'copywriting'
        and r.in_shopify_queue is true
        and coalesce(r.copy_done, false) = false)
      or
      (p_stage = 'product-info'
        and r.in_shopify_queue is true
        and r.info_done = false
        and r.copy_done = true)
    )
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
      p_factories is null
      or cardinality(p_factories) = 0
      or r.vendor = any(p_factories)
      or p.factories_display_name = any(p_factories)
    );
$$;

grant execute on function public.get_publish_rts_count(text, text, text, text, text[]) to anon, authenticated;

create or replace function public.get_publish_rts_rows(
  p_stage text,
  p_search text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_factories text[] default null,
  p_limit integer default 20,
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
    'body_html', r.body_html,
    'image_url', r.image_url,
    'vendor', r.vendor,
    'product_type', r.product_type,
    'tags', r.tags,
    'price', r.price,
    'sku', r.sku,
    'cost', r.cost,
    'copy_done', r.copy_done,
    'copy_done_at', r.copy_done_at,
    'copy_queued_at', r.copy_queued_at,
    'info_done', r.info_done,
    'in_shopify_queue', r.in_shopify_queue,
    'revert_reason', r.revert_reason,
    'imported_at', r.imported_at,
    'material', r.material,
    'my_fields.materials', r."my_fields.materials",
    'products', jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'description', p.description,
      'description_html', p.description_html,
      'image_url', p.image_url,
      'factories_display_name', p.factories_display_name,
      'level1_category', p.level1_category,
      'level2_category', p.level2_category,
      'sale_price', p.sale_price,
      'price', p.price,
      'cost_price', p.cost_price,
      'sku', p.sku,
      'model', p.model,
      'factory_id', p.factory_id,
      'tags', p.tags,
      'dimension_l_mm', p.dimension_l_mm,
      'dimension_w_mm', p.dimension_w_mm,
      'dimension_h_mm', p.dimension_h_mm,
      'in_stock', p.in_stock,
      'customize', p.customize,
      'revert_reason', p.revert_reason,
      'shopify_product_id', p.shopify_product_id
    )
  )
  from public.ready_to_shopify r
  join public.products p on p.id = r.product_id
  where p.shopify_product_id is null
    and (
      (p_stage = 'copywriting'
        and r.in_shopify_queue is true
        and coalesce(r.copy_done, false) = false)
      or
      (p_stage = 'product-info'
        and r.in_shopify_queue is true
        and r.info_done = false
        and r.copy_done = true)
    )
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
      p_factories is null
      or cardinality(p_factories) = 0
      or r.vendor = any(p_factories)
      or p.factories_display_name = any(p_factories)
    )
  order by
    case when p_stage = 'product-info' then r.copy_done_at end desc nulls last,
    case when p_stage = 'copywriting' then r.copy_queued_at end desc nulls last,
    r.imported_at desc nulls last
  limit greatest(0, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.get_publish_rts_rows(text, text, text, text, text[], integer, integer) to anon, authenticated;

-- 產品文案「暫不考慮」：在 ready_to_shopify 以 rejected 標記，主列表排除 rejected=true。

alter table public.ready_to_shopify
  add column if not exists rejected boolean not null default false;

comment on column public.ready_to_shopify.rejected is
  'When true, product is temporarily excluded from 產品文案 active queue (不考慮產品 view).';

create index if not exists ready_to_shopify_copywriting_rejected_idx
  on public.ready_to_shopify (copy_queued_at desc nulls last, imported_at desc)
  where in_shopify_queue is true
    and coalesce(copy_done, false) = false
    and rejected = false;

-- Drop old signatures so we can add p_rejected_only (copywriting filter).
drop function if exists public.get_publish_rts_count(text, text, text, text, text[]);
drop function if exists public.get_publish_rts_rows(text, text, text, text, text[], integer, integer);
drop function if exists public.get_publish_rts_factories(text);

create or replace function public.get_publish_rts_count(
  p_stage text,
  p_search text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_factories text[] default null,
  p_rejected_only boolean default false
)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.ready_to_shopify r
  join public.products p on p.id = r.product_id
  where p.shopify_product_id is null
    and (
      (p_stage = 'copywriting'
        and r.in_shopify_queue is true
        and coalesce(r.copy_done, false) = false
        and coalesce(r.rejected, false) = coalesce(p_rejected_only, false))
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

grant execute on function public.get_publish_rts_count(text, text, text, text, text[], boolean) to anon, authenticated;

create or replace function public.get_publish_rts_rows(
  p_stage text,
  p_search text default null,
  p_level1 text default null,
  p_level2 text default null,
  p_factories text[] default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_rejected_only boolean default false
)
returns setof jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'product_id', r.product_id,
    'title', r.title,
    'description_preview', left(
      regexp_replace(coalesce(nullif(trim(p.description), ''), ''), '<[^>]+>', ' ', 'g'),
      320
    ),
    'image_url', public.light_http_image_url(r.image_url, p.image_url),
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
    'rejected', r.rejected,
    'revert_reason', r.revert_reason,
    'imported_at', r.imported_at,
    'material', r.material,
    'my_fields.materials', r."my_fields.materials",
    'dimension_l_mm', coalesce(r.dimension_l_mm, p.dimension_l_mm),
    'dimension_w_mm', coalesce(r.dimension_w_mm, p.dimension_w_mm),
    'dimension_h_mm', coalesce(r.dimension_h_mm, p.dimension_h_mm),
    'in_stock', coalesce(r.in_stock, p.in_stock),
    'customize', coalesce(r.customize, p.customize),
    'products', jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'description', left(coalesce(nullif(trim(p.description), ''), ''), 320),
      'image_url', public.light_http_image_url(null, p.image_url),
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
      'shopify_product_id', p.shopify_product_id
    )
  )
  from public.ready_to_shopify r
  join public.products p on p.id = r.product_id
  where p.shopify_product_id is null
    and (
      (p_stage = 'copywriting'
        and r.in_shopify_queue is true
        and coalesce(r.copy_done, false) = false
        and coalesce(r.rejected, false) = coalesce(p_rejected_only, false))
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

grant execute on function public.get_publish_rts_rows(text, text, text, text, text[], integer, integer, boolean) to anon, authenticated;

create or replace function public.get_publish_rts_factories(
  p_stage text,
  p_rejected_only boolean default false
)
returns setof text
language sql
stable
set search_path = public
as $$
  select distinct coalesce(nullif(trim(r.vendor), ''), nullif(trim(p.factories_display_name), ''))
  from public.ready_to_shopify r
  join public.products p on p.id = r.product_id
  where p.shopify_product_id is null
    and coalesce(nullif(trim(r.vendor), ''), nullif(trim(p.factories_display_name), '')) is not null
    and (
      (p_stage = 'copywriting'
        and r.in_shopify_queue is true
        and coalesce(r.copy_done, false) = false
        and coalesce(r.rejected, false) = coalesce(p_rejected_only, false))
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

grant execute on function public.get_publish_rts_factories(text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

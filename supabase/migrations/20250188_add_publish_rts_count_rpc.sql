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

-- Server-side category counts for the product list filter dropdowns.
-- Replaces the previous client-side approach that paged through the entire
-- products table (2x full scans) and counted in JS — very slow at 3k+ rows.
--
-- Mirrors the list visibility filters:
--   catalog mode:  in_catalog = true AND dismissed IS NOT TRUE
--   all mode:      applyPendingProductsFilters (NOT in_shopify_queue,
--                  NOT info_done, NOT ready_to_publish, NOT copy_done,
--                  NOT in_catalog, copy_done_at IS NULL, copy_queued_at IS NULL,
--                  NOT dismissed)
-- plus optional factory filter (expanded factory display names).
--
-- Apply in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';

create or replace function public.product_category_counts(
  p_mode text default 'all',
  p_factories text[] default null
)
returns table(level1 text, level2 text, cnt bigint)
language sql
stable
set search_path = public
as $$
  select
    btrim(level1_category) as level1,
    nullif(btrim(coalesce(level2_category, '')), '') as level2,
    count(*)::bigint as cnt
  from public.products
  where nullif(btrim(coalesce(level1_category, '')), '') is not null
    and (p_factories is null or factories_display_name = any(p_factories))
    and (
      case
        when p_mode = 'catalog' then
          in_catalog is true and coalesce(dismissed, false) = false
        else
          coalesce(in_shopify_queue, false) = false
          and coalesce(info_done, false) = false
          and coalesce(ready_to_publish, false) = false
          and coalesce(copy_done, false) = false
          and coalesce(in_catalog, false) = false
          and copy_done_at is null
          and copy_queued_at is null
          and coalesce(dismissed, false) = false
      end
    )
  group by 1, 2
$$;

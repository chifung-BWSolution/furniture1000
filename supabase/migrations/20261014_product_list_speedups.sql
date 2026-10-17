-- Server-side aggregates for the product list filters, to replace client-side
-- full-table scans (products table is large; scanning it in JS on every filter
-- change / dropdown open is slow).
--
-- Apply in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';

-- Distinct factory display names present in the current view (catalog / all),
-- so the 廠家 filter dropdown doesn't scan the whole products table.
create or replace function public.product_factory_names(
  p_mode text default 'all'
)
returns table(factory_name text, cnt bigint)
language sql
stable
set search_path = public
as $$
  select
    btrim(factories_display_name) as factory_name,
    count(*)::bigint as cnt
  from public.products
  where nullif(btrim(coalesce(factories_display_name, '')), '') is not null
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
  group by 1
  order by 1
$$;

-- product_sku values that appear more than once under the current view filters,
-- for the 重複商品 filter (previously fetched every product_sku and counted in JS).
create or replace function public.product_duplicate_skus(
  p_mode text default 'all'
)
returns table(product_sku text, cnt bigint)
language sql
stable
set search_path = public
as $$
  select
    btrim(product_sku) as product_sku,
    count(*)::bigint as cnt
  from public.products
  where nullif(btrim(coalesce(product_sku, '')), '') is not null
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
  group by 1
  having count(*) > 1
  order by 1
$$;

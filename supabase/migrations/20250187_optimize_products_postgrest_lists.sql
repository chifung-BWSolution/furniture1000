-- Keep product list endpoints fast under PostgREST prepared queries.
-- These match the hot publish/copywriting list filters seen in production logs.

create index if not exists idx_products_shopify_ready_queue_copy_done_order
on public.products (copy_done_at desc nulls last, created_at desc)
where in_shopify_queue = true
  and info_done = false
  and copy_done = true
  and shopify_product_id is null;

create index if not exists idx_products_shopify_ready_queue_created_order
on public.products (created_at desc)
where in_shopify_queue = true
  and info_done = false
  and copy_done = true
  and shopify_product_id is null;

create index if not exists idx_products_shopify_copy_pending_order
on public.products (copy_queued_at desc nulls last, created_at desc)
where in_shopify_queue = true
  and (copy_done is null or copy_done = false)
  and shopify_product_id is null;

-- PostgREST often uses parameterized prepared statements. Full composite
-- indexes keep those generic plans fast even when partial-index predicates
-- cannot be proven from $1/$2/$3 parameters.
create index if not exists idx_products_postgrest_ready_copy_done_order
on public.products (
  in_shopify_queue,
  info_done,
  copy_done,
  shopify_product_id,
  copy_done_at desc nulls last,
  created_at desc
);

create index if not exists idx_products_postgrest_ready_created_order
on public.products (
  in_shopify_queue,
  info_done,
  copy_done,
  shopify_product_id,
  created_at desc
);

create index if not exists idx_products_postgrest_copy_pending_order
on public.products (
  in_shopify_queue,
  shopify_product_id,
  copy_done,
  copy_queued_at desc nulls last,
  created_at desc
);

analyze public.products;

-- Dashboard aggregate endpoint: replaces several simultaneous browser-side
-- count queries with one stable SQL aggregate call.
create or replace function public.get_dashboard_stats(
  month_start timestamptz,
  month_end timestamptz
)
returns table (
  uploaded_this_month bigint,
  tier_a bigint,
  tier_b bigint,
  tier_c bigint,
  copywriting_pending bigint,
  catalog_count bigint,
  projects_this_month bigint,
  invites_this_month bigint,
  quotes_this_month bigint
)
language sql
stable
set search_path = public
as $$
  with product_stats as (
    select
      count(*) filter (where created_at >= month_start and created_at < month_end) as uploaded_this_month,
      count(*) filter (where coalesce(sale_price, price, 0) >= 4000) as tier_a,
      count(*) filter (where coalesce(sale_price, price, 0) >= 1500 and coalesce(sale_price, price, 0) < 4000) as tier_b,
      count(*) filter (where coalesce(sale_price, price, 0) < 1500) as tier_c,
      count(*) filter (where in_shopify_queue = true and copy_done = false) as copywriting_pending,
      count(*) filter (where in_catalog = true) as catalog_count
    from products
  )
  select
    ps.uploaded_this_month,
    ps.tier_a,
    ps.tier_b,
    ps.tier_c,
    ps.copywriting_pending,
    ps.catalog_count,
    (select count(*) from design_projects where created_at >= month_start and created_at < month_end) as projects_this_month,
    (select count(*) from project_invitations where created_at >= month_start and created_at < month_end) as invites_this_month,
    (select count(*) from bwf_quote where created_at >= month_start and created_at < month_end) as quotes_this_month
  from product_stats ps;
$$;

grant execute on function public.get_dashboard_stats(timestamptz, timestamptz) to anon, authenticated;

-- Aggregate RPCs for the report pages that previously paged through whole
-- tables in the client (slow). Apply in Supabase SQL Editor, then:
-- NOTIFY pgrst, 'reload schema';

-- Published Shopify products grouped by product_type ("L1 / L2").
create or replace function public.shopify_published_category_counts()
returns table(level1 text, level2 text, cnt bigint)
language sql
stable
set search_path = public
as $$
  select
    coalesce(nullif(btrim(split_part(product_type, ' / ', 1)), ''), '未分類') as level1,
    nullif(btrim(split_part(product_type, ' / ', 2)), '') as level2,
    count(*)::bigint as cnt
  from public.shopify_products
  where status = 'active'
    and configurable is null
  group by 1, 2
$$;

-- Factory product counts for products.factories_display_name /
-- shopify_products.vendor / ready_to_shopify.vendor.
create or replace function public.factory_counts(p_source text)
returns table(factory_name text, cnt bigint)
language plpgsql
stable
set search_path = public
as $$
declare
  v_table text;
  v_col text;
  stmt text;
begin
  if p_source not in ('products', 'shopify_products', 'ready_to_shopify') then
    return;
  end if;
  v_table := p_source;
  v_col := case when p_source = 'products' then 'factories_display_name' else 'vendor' end;

  stmt := format(
    'select btrim(%I) as factory_name, count(*)::bigint as cnt from public.%I where nullif(btrim(coalesce(%I, '''')), '''') is not null',
    v_col, v_table, v_col
  );
  if p_source = 'products' then
    stmt := stmt || ' and title is not null and title <> ''''';
  end if;
  stmt := stmt || ' group by 1';

  return query execute stmt;
end;
$$;

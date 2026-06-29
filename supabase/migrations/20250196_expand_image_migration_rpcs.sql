-- Expand ready_to_shopify image migration RPCs to cover image_url_2 / image_url_3.

create or replace function public.rts_row_needs_image_migration(
  p_image_url text,
  p_image_url_2 text,
  p_image_url_3 text,
  p_images jsonb
)
returns boolean
language sql
immutable
as $$
  select
    (coalesce(p_image_url, '') like 'data:%')
    or (p_image_url is not null and p_image_url not like 'http%' and length(p_image_url) > 100)
    or (coalesce(p_image_url_2, '') like 'data:%')
    or (p_image_url_2 is not null and p_image_url_2 not like 'http%' and length(p_image_url_2) > 100)
    or (coalesce(p_image_url_3, '') like 'data:%')
    or (p_image_url_3 is not null and p_image_url_3 not like 'http%' and length(p_image_url_3) > 100)
    or (coalesce(p_images::text, '') like '%data:image%');
$$;

create or replace function public.get_rts_image_migration_batch(p_limit integer default 10)
returns table(
  product_id text,
  image_url text,
  image_url_2 text,
  image_url_3 text,
  images jsonb
)
language sql
stable
as $$
  select
    r.product_id,
    r.image_url,
    r.image_url_2,
    r.image_url_3,
    r.images
  from public.ready_to_shopify r
  where public.rts_row_needs_image_migration(r.image_url, r.image_url_2, r.image_url_3, r.images)
  order by r.product_id
  limit greatest(1, least(coalesce(p_limit, 10), 10));
$$;

create or replace function public.get_rts_image_migration_count()
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.ready_to_shopify r
  where public.rts_row_needs_image_migration(r.image_url, r.image_url_2, r.image_url_3, r.images);
$$;

create or replace function public.get_products_image_migration_count()
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.products p
  where
    (coalesce(p.image_url, '') like 'data:%')
    or (p.image_url is not null and p.image_url not like 'http%' and length(p.image_url) > 100)
    or (coalesce(p.image_url_2, '') like 'data:%')
    or (p.image_url_2 is not null and p.image_url_2 not like 'http%' and length(p.image_url_2) > 100)
    or (coalesce(p.image_url_3, '') like 'data:%')
    or (p.image_url_3 is not null and p.image_url_3 not like 'http%' and length(p.image_url_3) > 100)
    or (coalesce(p.images::text, '') like '%data:image%');
$$;

grant execute on function public.rts_row_needs_image_migration(text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.get_rts_image_migration_batch(integer) to anon, authenticated, service_role;
grant execute on function public.get_rts_image_migration_count() to anon, authenticated, service_role;
grant execute on function public.get_products_image_migration_count() to anon, authenticated, service_role;

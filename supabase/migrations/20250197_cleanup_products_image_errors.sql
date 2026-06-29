-- Clean up stale image-related product errors and PDF SVG placeholders.
-- SVG data-URLs are catalog PDF icons, not product photos — clear them instead of migrating.

create or replace function public.is_pdf_svg_placeholder(p_url text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_url, '') like 'data:image/svg+xml%';
$$;

-- Remove PDF SVG placeholders from scalar columns and images[] JSONB.
update public.products
set
  image_url = case when public.is_pdf_svg_placeholder(image_url) then '' else image_url end,
  image_url_2 = case when public.is_pdf_svg_placeholder(image_url_2) then null else image_url_2 end,
  image_url_3 = case when public.is_pdf_svg_placeholder(image_url_3) then null else image_url_3 end,
  images = (
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    from jsonb_array_elements(coalesce(products.images, '[]'::jsonb)) as elem
    where not (
      (jsonb_typeof(elem) = 'string' and (elem #>> '{}') like 'data:image/svg+xml%')
      or (
        jsonb_typeof(elem) = 'object'
        and coalesce(elem->>'src', elem->>'url', '') like 'data:image/svg+xml%'
      )
    )
  )
where
  public.is_pdf_svg_placeholder(image_url)
  or public.is_pdf_svg_placeholder(image_url_2)
  or public.is_pdf_svg_placeholder(image_url_3)
  or coalesce(images::text, '') like '%data:image/svg+xml%';

-- Stale publish failures from oversized base64 payloads — images are now Storage URLs.
update public.products
set
  error_message = null,
  status = 'draft'
where
  status = 'error'
  and error_message = 'Failed to send a request to the Edge Function'
  and coalesce(image_url, '') like 'http%';

-- Count only real photo base64 left to migrate (exclude SVG placeholders).
create or replace function public.get_products_image_migration_count()
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.products p
  where
    (
      (coalesce(p.image_url, '') like 'data:%' and not public.is_pdf_svg_placeholder(p.image_url))
      or (p.image_url is not null and p.image_url not like 'http%' and length(p.image_url) > 100
          and not public.is_pdf_svg_placeholder(p.image_url))
    )
    or (
      (coalesce(p.image_url_2, '') like 'data:%' and not public.is_pdf_svg_placeholder(p.image_url_2))
      or (p.image_url_2 is not null and p.image_url_2 not like 'http%' and length(p.image_url_2) > 100
          and not public.is_pdf_svg_placeholder(p.image_url_2))
    )
    or (
      (coalesce(p.image_url_3, '') like 'data:%' and not public.is_pdf_svg_placeholder(p.image_url_3))
      or (p.image_url_3 is not null and p.image_url_3 not like 'http%' and length(p.image_url_3) > 100
          and not public.is_pdf_svg_placeholder(p.image_url_3))
    )
    or (
      coalesce(p.images::text, '') like '%data:image%'
      and coalesce(p.images::text, '') not like '%data:image/svg+xml%'
    );
$$;

grant execute on function public.is_pdf_svg_placeholder(text) to anon, authenticated, service_role;
grant execute on function public.get_products_image_migration_count() to anon, authenticated, service_role;

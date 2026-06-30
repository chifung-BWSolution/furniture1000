-- Backfill shopify_page_description from body_html when Shopify seo.description was unset.
-- Shopify Admin still displays product description as the Meta description preview.
update public.shopify_products
set shopify_page_description = trim(regexp_replace(body_html, '<[^>]+>', ' ', 'g'))
where (shopify_page_description is null or shopify_page_description = '')
  and body_html is not null
  and trim(body_html) <> '';

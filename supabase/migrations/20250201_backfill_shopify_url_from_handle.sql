-- Backfill shopify_url from handle for rows synced before SEO columns existed.
update public.shopify_products
set shopify_url = handle
where (shopify_url is null or shopify_url = '')
  and handle is not null
  and handle <> '';

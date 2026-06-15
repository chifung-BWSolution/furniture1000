-- Add sku, options, and metafields columns to shopify_products
alter table public.shopify_products
  add column if not exists sku text,
  add column if not exists options jsonb,
  add column if not exists metafields jsonb;

comment on column public.shopify_products.sku is 'SKU from first variant (for easy search/display)';
comment on column public.shopify_products.options is 'Product-level options array from Shopify (e.g. Size, Color)';
comment on column public.shopify_products.metafields is 'All product metafields fetched from Shopify Metafields API';

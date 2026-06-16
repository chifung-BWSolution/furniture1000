-- Add metafields column to shopify_products to store all Shopify product metafields
alter table public.shopify_products
  add column if not exists metafields jsonb;

comment on column public.shopify_products.metafields is 'Array of all Shopify product metafields: [{id, namespace, key, value, type, ...}]';

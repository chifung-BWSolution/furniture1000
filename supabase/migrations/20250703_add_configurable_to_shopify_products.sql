-- Parent SKU for rows merged as Shopify variants (child mirror rows point here).
alter table public.shopify_products
  add column if not exists configurable text;

comment on column public.shopify_products.configurable is
  'When set, this mirror row was merged as a variant under the parent product with this SKU.';

create index if not exists shopify_products_configurable_idx
  on public.shopify_products (configurable)
  where configurable is not null;

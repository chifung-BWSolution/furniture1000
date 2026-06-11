-- Add in_stock / customize columns to shopify_products (貨期類型 現貨 / 全訂製)
alter table public.shopify_products
  add column if not exists in_stock boolean,
  add column if not exists customize text;

-- Backfill from products. products has no shopify id; shopify_products is
-- derived from products and shares the same UUID id, so match on id.
update public.shopify_products sp
set in_stock = p.in_stock,
    customize = p.customize
-- shopify_products.id is uuid while products.id is text — cast to compare.
from public.products p
where sp.id::text = p.id;

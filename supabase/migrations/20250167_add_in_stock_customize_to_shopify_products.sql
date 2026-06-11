-- Add in_stock / customize columns to shopify_products (貨期類型 現貨 / 全訂製)
alter table public.shopify_products
  add column if not exists in_stock boolean,
  add column if not exists customize text;

-- Backfill from products where a matching record exists.
-- shopify_products.shopify_product_id maps to products.shopify_product_id.
update public.shopify_products sp
set in_stock = p.in_stock,
    customize = p.customize
from public.products p
where sp.shopify_product_id = p.shopify_product_id
  and sp.shopify_product_id is not null;

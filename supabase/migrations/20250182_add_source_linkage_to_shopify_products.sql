-- Link shopify_products back to the originating products row (and the staging
-- ready_to_shopify row) so the 產品目錄 page can tell whether a product has been
-- uploaded to Shopify and resolve its Shopify title / id.
alter table public.shopify_products
  add column if not exists source_product_id   text,
  add column if not exists ready_to_shopify_id uuid;

create index if not exists shopify_products_source_product_id_idx
  on public.shopify_products (source_product_id);

-- Backfill source_product_id for rows already published: match the Shopify id
-- stored on products.shopify_product_id.
update public.shopify_products sp
set source_product_id = p.id
from public.products p
where sp.source_product_id is null
  and p.shopify_product_id is not null
  and p.shopify_product_id = sp.shopify_product_id;

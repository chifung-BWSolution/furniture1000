-- Mirror ready_to_shopify SEO fields on shopify_products so 已上載產品 can show/edit them.
alter table public.shopify_products
  add column if not exists shopify_page_title text,
  add column if not exists shopify_page_description text,
  add column if not exists shopify_url text;

create index if not exists shopify_products_source_product_id_idx
  on public.shopify_products (source_product_id)
  where source_product_id is not null;

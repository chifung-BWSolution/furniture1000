-- Add product_id to ready_to_shopify to link back to the source products table
alter table public.ready_to_shopify
  add column if not exists product_id text unique references public.products(id) on delete cascade;

create index if not exists ready_to_shopify_product_id_idx on public.ready_to_shopify (product_id);

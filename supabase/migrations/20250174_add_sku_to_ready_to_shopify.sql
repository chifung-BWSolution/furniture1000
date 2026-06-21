-- Add sku column to ready_to_shopify so 產品文案 can save/display SKU
alter table public.ready_to_shopify
  add column if not exists sku text default null;

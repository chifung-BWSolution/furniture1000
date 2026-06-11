-- Add copy_done flag to products table.
-- copy_done = true means the copywriting step is complete; the product
-- moves from 產品文案 (copy_done=false) to 產品信息 (copy_done=true).
alter table products
  add column if not exists copy_done boolean not null default false;

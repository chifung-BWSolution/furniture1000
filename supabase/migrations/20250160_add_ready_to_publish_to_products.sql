-- Add ready_to_publish flag to products so 發佈前檢查 can move products to 準備上載
alter table public.products
  add column if not exists ready_to_publish boolean not null default false;

create index if not exists products_ready_to_publish_idx
  on public.products (ready_to_publish)
  where ready_to_publish = true;

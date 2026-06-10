-- Create ready_to_shopify table with the same columns as shopify_products
create table if not exists public.ready_to_shopify (
  id uuid primary key default gen_random_uuid(),
  shopify_product_id text unique,
  title text,
  body_html text,
  vendor text,
  product_type text,
  handle text,
  status text,                    -- active | archived | draft
  published_at timestamptz,
  image_url text,
  images jsonb,
  variants jsonb,
  tags text[],
  price numeric(12,2),
  compare_at_price numeric(12,2),
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  imported_at timestamptz default now() not null,
  shop_domain text
);

create index if not exists ready_to_shopify_shopify_id_idx on public.ready_to_shopify (shopify_product_id);
create index if not exists ready_to_shopify_imported_at_idx on public.ready_to_shopify (imported_at desc);

alter table public.ready_to_shopify enable row level security;
create policy "Allow all for authenticated users"
  on public.ready_to_shopify for all using (true) with check (true);

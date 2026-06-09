-- Create shopify_products table to store products imported from Shopify
create table if not exists public.shopify_products (
  id uuid primary key default gen_random_uuid(),
  shopify_product_id text not null unique,
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

create index if not exists shopify_products_shopify_id_idx on public.shopify_products (shopify_product_id);
create index if not exists shopify_products_imported_at_idx on public.shopify_products (imported_at desc);

alter table public.shopify_products enable row level security;
create policy "Allow all for authenticated users"
  on public.shopify_products for all using (true) with check (true);

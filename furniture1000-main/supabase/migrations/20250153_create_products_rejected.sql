-- Create products_rejected table to store products marked as "暫不考慮" (not considering)
create table if not exists public.products_rejected (
  id uuid primary key default gen_random_uuid(),
  -- Original product reference (if from the products table)
  original_product_id text,
  -- Core product fields
  title text,
  description text,
  description_html text,
  tags text[],
  price numeric(12, 2),
  compare_at_price numeric(12, 2),
  collection text,
  image_url text,
  -- Factory / manufacturer
  factory_id text,
  factories_display_name text,
  -- Pricing
  cost_price numeric(12, 2),
  sale_price numeric(12, 2),
  -- Logistics
  production_date integer,
  shipping_days integer,
  total_lead_time integer,
  shipping_fee numeric(12, 2),
  delivery_term_id text,
  delivery_term_name text,
  -- Physical
  color text,
  material text,
  dimension_l_mm integer,
  dimension_w_mm integer,
  dimension_h_mm integer,
  -- Metadata
  remarks text,
  category text,
  source text,
  shopify_product_id text,
  bwf_master_id text,
  -- Raw row data (for Excel-sourced rejections from ExcelPreviewTable)
  raw_row_data jsonb,
  -- Rejection metadata
  rejected_at timestamptz default now() not null,
  rejected_by text,
  rejection_source text -- 'listed_products' | 'excel_preview'
);

-- Indexes for common lookups
create index if not exists products_rejected_rejected_at_idx on public.products_rejected (rejected_at desc);
create index if not exists products_rejected_factory_idx on public.products_rejected (factory_id);
create index if not exists products_rejected_source_idx on public.products_rejected (rejection_source);

-- RLS: allow all authenticated operations
alter table public.products_rejected enable row level security;

create policy "Allow all for authenticated users"
  on public.products_rejected
  for all
  using (true)
  with check (true);

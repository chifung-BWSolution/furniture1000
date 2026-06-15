CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS bwf_product_master (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shopify_id TEXT UNIQUE,
  title TEXT,
  category TEXT,
  factory_name TEXT,
  image_url TEXT,
  description TEXT,
  material TEXT,
  dimension_l_mm NUMERIC,
  dimension_w_mm NUMERIC,
  dimension_h_mm NUMERIC,
  cost_price NUMERIC,
  sale_price NUMERIC,
  shopify_price NUMERIC,
  shopify_compare_at_price NUMERIC,
  delivery_days INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bwf_product_master_shopify_id ON bwf_product_master(shopify_id);
CREATE INDEX IF NOT EXISTS idx_bwf_product_master_factory_name ON bwf_product_master(factory_name);
CREATE INDEX IF NOT EXISTS idx_bwf_product_master_category ON bwf_product_master(category);

DROP POLICY IF EXISTS "Allow all access to bwf_product_master" ON bwf_product_master;
ALTER TABLE bwf_product_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to bwf_product_master" ON bwf_product_master FOR ALL USING (true) WITH CHECK (true);

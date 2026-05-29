-- ============================================================================
-- Consolidated Schema Migration for CORRECT project: kqwktnplkqucsbasyfjl
-- This migration creates ALL required tables, indexes, policies, and triggers
-- on the correct Supabase project.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. Products Table (from migrations 20250101 through 20250114)
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  compare_at_price NUMERIC(10,2),
  collection TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  image_url TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shopify_product_id TEXT,
  sku TEXT DEFAULT '',
  description_html TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  synced_at TIMESTAMPTZ,
  shopify_synced_data JSONB,
  images JSONB DEFAULT '[]'::jsonb,
  upload_session_id TEXT,
  factories_display_name TEXT DEFAULT ''
);

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shopify_product_id_key;
ALTER TABLE products ADD CONSTRAINT products_shopify_product_id_key UNIQUE (shopify_product_id);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_source ON products(source);
CREATE INDEX IF NOT EXISTS idx_products_title ON products(title);
CREATE INDEX IF NOT EXISTS idx_products_upload_session_id ON products(upload_session_id);
CREATE INDEX IF NOT EXISTS idx_products_factories_display_name ON products(factories_display_name);

-- ============================================================================
-- 2. Product Variants Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  inventory INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);

-- ============================================================================
-- 3. RLS + Realtime for products & product_variants
-- ============================================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to products" ON products;
CREATE POLICY "Allow all access to products" ON products FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to product_variants" ON product_variants;
CREATE POLICY "Allow all access to product_variants" ON product_variants FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE products;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'product_variants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE product_variants;
  END IF;
END;
$$;

-- ============================================================================
-- 4. Shopify Connections Table (from migrations 20250105 through 20250111)
-- ============================================================================
CREATE TABLE IF NOT EXISTS shopify_connections (
  shop_domain TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  scope TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  last_refresh_error TEXT,
  refresh_attempt_count INT DEFAULT 0
);

ALTER TABLE shopify_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to shopify_connections" ON shopify_connections;
CREATE POLICY "Allow all access to shopify_connections" ON shopify_connections FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_shopify_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shopify_connections_updated_at ON shopify_connections;
CREATE TRIGGER trg_shopify_connections_updated_at
  BEFORE UPDATE ON shopify_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_shopify_connections_updated_at();

-- ============================================================================
-- 5. BWF Product Master Table (from migration 20250115)
-- ============================================================================
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

ALTER TABLE bwf_product_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to bwf_product_master" ON bwf_product_master;
CREATE POLICY "Allow all access to bwf_product_master" ON bwf_product_master FOR ALL USING (true) WITH CHECK (true);

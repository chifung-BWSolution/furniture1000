-- Performance indexes for product catalog queries
-- The primary listing view sorts by created_at DESC and filters by title, shopify_product_id

-- Index on created_at for ORDER BY created_at DESC (most common sort)
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);

-- Composite index for the most common query pattern:
-- SELECT * FROM products ORDER BY created_at DESC with optional title ILIKE filter
CREATE INDEX IF NOT EXISTS idx_products_title_trgm ON products USING gin (title gin_trgm_ops);

-- Enable pg_trgm extension for ILIKE/trigram searches (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index on factory_id for filtering
CREATE INDEX IF NOT EXISTS idx_products_factory_id ON products(factory_id);

-- Index on category for filtering
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Index on bwf_master_id for join/lookup
CREATE INDEX IF NOT EXISTS idx_products_bwf_master_id ON products(bwf_master_id);

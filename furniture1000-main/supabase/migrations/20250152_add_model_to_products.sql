-- ============================================================================
-- Add model column to products — stores the 產品型號 (Model Number) mapped
-- during 上載PDF column mapping.
-- ============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS model TEXT;

CREATE INDEX IF NOT EXISTS idx_products_model ON products(model);

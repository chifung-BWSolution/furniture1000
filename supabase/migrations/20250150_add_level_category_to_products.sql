-- ============================================================================
-- Add 一級/二級分類 columns to products, sourced from product_category table.
-- Set on PDF/Excel upload ("上載PDF" → 上傳到產品目錄).
-- ============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS level1_category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS level2_category TEXT;

CREATE INDEX IF NOT EXISTS idx_products_level1_category ON products(level1_category);
CREATE INDEX IF NOT EXISTS idx_products_level2_category ON products(level2_category);

ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

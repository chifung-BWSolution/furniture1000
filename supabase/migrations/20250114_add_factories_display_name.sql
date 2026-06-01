ALTER TABLE products ADD COLUMN IF NOT EXISTS factories_display_name TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_products_factories_display_name ON products(factories_display_name);

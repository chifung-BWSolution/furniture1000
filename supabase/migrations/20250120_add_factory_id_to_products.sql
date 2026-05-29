ALTER TABLE products ADD COLUMN IF NOT EXISTS factory_id TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_products_factory_id ON products(factory_id);

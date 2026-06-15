ALTER TABLE products ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE products ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_synced_data JSONB;

CREATE INDEX IF NOT EXISTS idx_products_source ON products(source);

UPDATE products SET source = 'shopify' WHERE shopify_product_id IS NOT NULL AND source = 'local' AND id LIKE 'shopify-%';

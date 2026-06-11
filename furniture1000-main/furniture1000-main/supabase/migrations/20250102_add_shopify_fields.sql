-- Add Shopify integration fields to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_product_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS description_html TEXT DEFAULT '';

-- Create unique index on shopify_product_id to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shopify_product_id
  ON products(shopify_product_id)
  WHERE shopify_product_id IS NOT NULL;

-- Create index for fast lookups by status
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

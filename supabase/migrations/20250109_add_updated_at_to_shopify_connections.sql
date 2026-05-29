ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE shopify_connections SET updated_at = connected_at WHERE updated_at IS NULL;

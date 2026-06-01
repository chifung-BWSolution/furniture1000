ALTER TABLE products ADD COLUMN IF NOT EXISTS upload_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_products_upload_session_id ON products(upload_session_id);

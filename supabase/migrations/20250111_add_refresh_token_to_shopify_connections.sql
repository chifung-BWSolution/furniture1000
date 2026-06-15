ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ;
ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS last_refresh_error TEXT;
ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS refresh_attempt_count INT DEFAULT 0;

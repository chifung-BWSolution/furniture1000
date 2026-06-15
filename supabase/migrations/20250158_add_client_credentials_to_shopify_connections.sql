-- Add client_id and client_secret columns to shopify_connections
-- Required for Shopify client_credentials OAuth flow to auto-refresh shpat_ tokens
ALTER TABLE shopify_connections
ADD COLUMN IF NOT EXISTS client_id text,
ADD COLUMN IF NOT EXISTS client_secret text;

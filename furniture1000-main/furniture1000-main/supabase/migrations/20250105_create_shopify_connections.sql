CREATE TABLE IF NOT EXISTS shopify_connections (
  shop_domain TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  scope TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

ALTER TABLE shopify_connections ENABLE ROW LEVEL SECURITY;

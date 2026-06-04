-- Trigger to automatically update updated_at on shopify_connections whenever a row is modified
CREATE OR REPLACE FUNCTION update_shopify_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shopify_connections_updated_at ON shopify_connections;
CREATE TRIGGER trg_shopify_connections_updated_at
  BEFORE UPDATE ON shopify_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_shopify_connections_updated_at();

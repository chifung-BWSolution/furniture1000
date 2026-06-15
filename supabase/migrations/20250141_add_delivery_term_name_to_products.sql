ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_term_name TEXT;

CREATE OR REPLACE FUNCTION sync_delivery_term_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.delivery_term_id IS NOT NULL THEN
    SELECT name INTO NEW.delivery_term_name
    FROM delivery_terms
    WHERE id = NEW.delivery_term_id;
  ELSE
    NEW.delivery_term_name := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_sync_delivery_term_name ON products;
CREATE TRIGGER products_sync_delivery_term_name
  BEFORE INSERT OR UPDATE OF delivery_term_id ON products
  FOR EACH ROW EXECUTE FUNCTION sync_delivery_term_name();

UPDATE products p
SET delivery_term_name = dt.name
FROM delivery_terms dt
WHERE p.delivery_term_id = dt.id
AND p.delivery_term_name IS NULL;

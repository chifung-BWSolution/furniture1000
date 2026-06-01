INSERT INTO delivery_terms (name, type, min_days, max_days, parent_id, sort_order)
SELECT '7天內', 'custom'::delivery_term_type, 1, 7, dt.id, 1
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM delivery_terms WHERE name = '7天內');

INSERT INTO delivery_terms (name, type, min_days, max_days, parent_id, sort_order)
SELECT '8-15天', 'custom'::delivery_term_type, 8, 15, dt.id, 2
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM delivery_terms WHERE name = '8-15天');

INSERT INTO delivery_terms (name, type, min_days, max_days, parent_id, sort_order)
SELECT '16-30天', 'custom'::delivery_term_type, 16, 30, dt.id, 3
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM delivery_terms WHERE name = '16-30天');

INSERT INTO delivery_terms (name, type, min_days, max_days, parent_id, sort_order)
SELECT '30天以上', 'custom'::delivery_term_type, 31, 999, dt.id, 4
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM delivery_terms WHERE name = '30天以上');

ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_term_id UUID REFERENCES delivery_terms(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_delivery_term_id ON products(delivery_term_id);

ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS delivery_term_id UUID REFERENCES delivery_terms(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bwf_master_delivery_term_id ON bwf_product_master(delivery_term_id);

CREATE OR REPLACE FUNCTION update_delivery_terms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS delivery_terms_updated_at ON delivery_terms;
CREATE TRIGGER delivery_terms_updated_at
  BEFORE UPDATE ON delivery_terms
  FOR EACH ROW EXECUTE FUNCTION update_delivery_terms_updated_at();

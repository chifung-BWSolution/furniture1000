DO $$ BEGIN
  CREATE TYPE delivery_term_type AS ENUM ('stock', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS delivery_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type delivery_term_type NOT NULL DEFAULT 'custom',
  min_days INT NOT NULL DEFAULT 0,
  max_days INT NOT NULL DEFAULT 0,
  parent_id UUID REFERENCES delivery_terms(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_terms_type ON delivery_terms(type);
CREATE INDEX IF NOT EXISTS idx_delivery_terms_parent_id ON delivery_terms(parent_id);

INSERT INTO delivery_terms (name, type, min_days, max_days, parent_id, sort_order)
VALUES
  ('現貨', 'stock'::delivery_term_type, 0, 0, NULL, 1),
  ('定制', 'custom'::delivery_term_type, 0, 0, NULL, 2);

INSERT INTO delivery_terms (name, type, min_days, max_days, parent_id, sort_order)
SELECT '7天內', 'custom'::delivery_term_type, 1, 7, dt.id, 1
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
UNION ALL
SELECT '8-15天', 'custom'::delivery_term_type, 8, 15, dt.id, 2
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
UNION ALL
SELECT '16-30天', 'custom'::delivery_term_type, 16, 30, dt.id, 3
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
UNION ALL
SELECT '30天以上', 'custom'::delivery_term_type, 31, 999, dt.id, 4
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL;

ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_term_id UUID REFERENCES delivery_terms(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_delivery_term_id ON products(delivery_term_id);

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

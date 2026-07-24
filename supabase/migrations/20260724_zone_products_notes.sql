-- Allow staff remarks on products selected inside design-project zones.
ALTER TABLE zone_products
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN zone_products.notes IS '設計專案產品備註（意見／說明）';

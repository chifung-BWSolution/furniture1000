-- Project-local product dimensions on 設計專案 zone_products.
-- Overrides catalog products.dimension_*_mm for this project only.
ALTER TABLE zone_products
  ADD COLUMN IF NOT EXISTS dimension_l_mm integer,
  ADD COLUMN IF NOT EXISTS dimension_w_mm integer,
  ADD COLUMN IF NOT EXISTS dimension_h_mm integer;

COMMENT ON COLUMN zone_products.dimension_l_mm IS '設計專案產品長度 mm（僅本專案，不改產品目錄）';
COMMENT ON COLUMN zone_products.dimension_w_mm IS '設計專案產品闊度 mm（僅本專案，不改產品目錄）';
COMMENT ON COLUMN zone_products.dimension_h_mm IS '設計專案產品高度 mm（僅本專案，不改產品目錄）';

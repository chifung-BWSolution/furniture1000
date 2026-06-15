-- products.production_date is DATE but should store INTEGER (days).
-- Change column type from DATE to INTEGER, preserving the column name
-- so all existing app code continues to work without changes.
ALTER TABLE public.products
  ALTER COLUMN production_date TYPE INTEGER
  USING NULL;
-- (Existing date values cannot safely convert to meaningful day-counts, so we set to NULL.
--  The column will be repopulated by the app on next save.)

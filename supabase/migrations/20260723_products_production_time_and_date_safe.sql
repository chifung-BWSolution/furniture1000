-- Excel「生產週期」maps to day-counts (e.g. 12), not calendar dates.
-- Live DB still has products.production_date as DATE in some environments, which
-- rejects integer writes ("invalid input syntax for type date: \"12\"").
-- 1) Prefer INTEGER day-counts when the column is still DATE.
-- 2) Ensure production_time text exists for the 4-bucket Production Time field.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'production_date'
      AND data_type = 'date'
  ) THEN
    ALTER TABLE public.products
      ALTER COLUMN production_date TYPE integer
      USING NULL;
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS production_time text;

NOTIFY pgrst, 'reload schema';

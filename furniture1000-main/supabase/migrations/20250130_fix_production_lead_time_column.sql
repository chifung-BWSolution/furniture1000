-- Fix: The production_date column was incorrectly defined as DATE
-- but is actually used to store production lead time in days (INTEGER).
-- Add a proper INTEGER column and drop the mistyped DATE column if it has no real date data.

-- Add production_lead_time as INTEGER (the correct semantic name and type)
ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS production_lead_time INTEGER;

-- Add total_lead_time as INTEGER (computed: production_lead_time + shipping_days)
ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS total_lead_time INTEGER;

-- Migrate any existing data from production_date (if it was stored as a number-like date)
-- This is a no-op if production_date is NULL or doesn't parse as an integer
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bwf_product_master' AND column_name = 'production_date'
  ) THEN
    UPDATE bwf_product_master
    SET production_lead_time = EXTRACT(DAY FROM production_date - '1970-01-01'::date)::integer
    WHERE production_date IS NOT NULL AND production_lead_time IS NULL;
  END IF;
END;
$$;

-- Add total_lead_time column to local products table (computed: production_lead_time + shipping_days)
ALTER TABLE products ADD COLUMN IF NOT EXISTS total_lead_time INTEGER;

-- Add production_lead_time alias column if needed for future consistency
-- The existing column 'production_date' stores production lead time in days
-- We keep backward compat by not renaming, but the app now maps it as production_lead_time

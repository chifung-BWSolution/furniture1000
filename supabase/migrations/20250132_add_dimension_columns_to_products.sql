-- Add dimension columns to local products table to match bwf_product_master fields
-- These are received from the master DB sync and need to be stored locally.

ALTER TABLE products ADD COLUMN IF NOT EXISTS dimension_l_mm NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS dimension_w_mm NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS dimension_h_mm NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS material TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS lifestyle_image_url TEXT;

NOTIFY pgrst, 'reload schema';

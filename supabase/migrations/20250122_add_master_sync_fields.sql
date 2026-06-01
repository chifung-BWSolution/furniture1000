-- Run this migration on the GLOBAL MASTER project: kqwktnplkqucsbasyfjl
-- Adds new fields to bwf_product_master for expanded sync

ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS production_date DATE;
ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS shipping_days INTEGER;
ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC;
ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Run this migration on the GLOBAL MASTER project: kqwktnplkqucsbasyfjl
-- This adds an images JSONB column to bwf_product_master for storing multiple product images.

ALTER TABLE bwf_product_master ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;

-- Create storage bucket for product images (if not exists)
-- Note: This needs to be done via the Supabase Dashboard or the Management API
-- Bucket name: product-images
-- Public: true (for serving images via public URLs)

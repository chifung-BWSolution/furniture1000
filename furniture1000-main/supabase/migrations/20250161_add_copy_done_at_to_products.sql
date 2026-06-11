-- Add copy_done_at to track when a product was submitted from 產品文案 to 產品信息.
-- Used to sort 產品信息 by most recently submitted first.
ALTER TABLE products ADD COLUMN IF NOT EXISTS copy_done_at TIMESTAMPTZ;

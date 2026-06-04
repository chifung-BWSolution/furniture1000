-- Run this migration on the GLOBAL MASTER project: kqwktnplkqucsbasyfjl
-- Adds a unique constraint on (title, factory_name) so the edge function
-- can UPSERT by business key instead of relying on the UUID id column.

-- Add unique constraint for upsert conflict resolution
-- Using COALESCE to handle NULLs: treat NULL factory_name as empty string
CREATE UNIQUE INDEX IF NOT EXISTS idx_bwf_unique_title_factory
  ON bwf_product_master (COALESCE(title, ''), COALESCE(factory_name, ''));

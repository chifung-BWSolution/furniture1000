-- ============================================================================
-- Add factory_highlights to products — accumulates ALL highlights ever uploaded
-- for a given factory (merged across uploads), as a text array.
-- ============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS factory_highlights TEXT[] DEFAULT '{}';

-- Add color column to products table
-- Stores the English W3C color name (e.g., 'SaddleBrown', 'White', 'Black')
-- Chinese display names are handled in the frontend via color-map.ts

ALTER TABLE products ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '';

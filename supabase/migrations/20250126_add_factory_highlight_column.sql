ALTER TABLE bwf_product_master
ADD COLUMN IF NOT EXISTS factory_highlight JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bwf_product_master_factory_highlight ON bwf_product_master USING gin (factory_highlight);

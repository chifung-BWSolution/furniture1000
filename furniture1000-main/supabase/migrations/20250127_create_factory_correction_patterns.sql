CREATE TABLE IF NOT EXISTS factory_correction_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id TEXT NOT NULL,
  factory_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  original_value TEXT,
  corrected_value TEXT NOT NULL,
  model_number TEXT,
  correction_context JSONB DEFAULT '{}',
  confidence NUMERIC DEFAULT 1.0,
  occurrence_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fcp_factory_id ON factory_correction_patterns(factory_id);
CREATE INDEX IF NOT EXISTS idx_fcp_factory_field ON factory_correction_patterns(factory_id, field_name);
CREATE INDEX IF NOT EXISTS idx_fcp_model ON factory_correction_patterns(factory_id, model_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fcp_unique_correction
  ON factory_correction_patterns(factory_id, field_name, original_value, model_number)
  WHERE original_value IS NOT NULL AND model_number IS NOT NULL;

CREATE OR REPLACE FUNCTION update_factory_correction_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fcp_updated_at ON factory_correction_patterns;
CREATE TRIGGER trg_fcp_updated_at
  BEFORE UPDATE ON factory_correction_patterns
  FOR EACH ROW EXECUTE FUNCTION update_factory_correction_updated_at();

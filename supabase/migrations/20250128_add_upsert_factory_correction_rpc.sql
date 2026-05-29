-- RPC: upsert_factory_correction
-- Atomically inserts or updates a factory correction pattern,
-- incrementing occurrence_count on conflict.

CREATE OR REPLACE FUNCTION upsert_factory_correction(
  p_factory_id     TEXT,
  p_factory_name   TEXT,
  p_field_name     TEXT,
  p_original_value TEXT,
  p_corrected_value TEXT,
  p_model_number   TEXT DEFAULT NULL,
  p_context        JSONB DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO factory_correction_patterns (
    factory_id,
    factory_name,
    field_name,
    original_value,
    corrected_value,
    model_number,
    correction_context,
    occurrence_count
  ) VALUES (
    p_factory_id,
    p_factory_name,
    p_field_name,
    p_original_value,
    p_corrected_value,
    p_model_number,
    COALESCE(p_context, '{}'),
    1
  )
  ON CONFLICT (factory_id, field_name, original_value, model_number)
  WHERE original_value IS NOT NULL AND model_number IS NOT NULL
  DO UPDATE SET
    corrected_value    = EXCLUDED.corrected_value,
    occurrence_count   = factory_correction_patterns.occurrence_count + 1,
    correction_context = EXCLUDED.correction_context,
    updated_at         = NOW();
END;
$$;

-- Allow authenticated users to call this function
GRANT EXECUTE ON FUNCTION upsert_factory_correction TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_factory_correction TO anon;

-- RLS policies for factory_correction_patterns (if not already set)
ALTER TABLE factory_correction_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fcp_select_all ON factory_correction_patterns;
CREATE POLICY fcp_select_all ON factory_correction_patterns
  FOR SELECT USING (true);

DROP POLICY IF EXISTS fcp_insert_authenticated ON factory_correction_patterns;
CREATE POLICY fcp_insert_authenticated ON factory_correction_patterns
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS fcp_update_authenticated ON factory_correction_patterns;
CREATE POLICY fcp_update_authenticated ON factory_correction_patterns
  FOR UPDATE USING (true);

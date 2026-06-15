CREATE TABLE IF NOT EXISTS bwf_quote (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id TEXT UNIQUE NOT NULL,
  version TEXT NOT NULL DEFAULT 'v1.1',
  status TEXT NOT NULL DEFAULT '待審核',
  total_amount NUMERIC NOT NULL DEFAULT 0,
  submitter TEXT NOT NULL,
  project_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bwf_quote ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to bwf_quote" ON bwf_quote;
CREATE POLICY "Allow all access to bwf_quote"
  ON bwf_quote FOR ALL
  USING (true)
  WITH CHECK (true);

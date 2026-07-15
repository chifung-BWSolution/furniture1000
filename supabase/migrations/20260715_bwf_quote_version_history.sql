-- Allow multiple version rows per quote_id (version history snapshots).

ALTER TABLE public.bwf_quote
  DROP CONSTRAINT IF EXISTS bwf_quote_quote_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bwf_quote_quote_id_version
  ON public.bwf_quote (quote_id, version);

CREATE INDEX IF NOT EXISTS idx_bwf_quote_quote_id_modified
  ON public.bwf_quote (quote_id, modified_date DESC NULLS LAST, created_at DESC);

COMMENT ON INDEX public.idx_bwf_quote_quote_id_version IS
  'Each quote_id may have many immutable version rows (v1.1, v1.2, …).';

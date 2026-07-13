-- bwf_quote.bwf_project_id may already exist (added by PMS). Ensure column + index.
ALTER TABLE public.bwf_quote
  ADD COLUMN IF NOT EXISTS bwf_project_id uuid;

CREATE INDEX IF NOT EXISTS idx_bwf_quote_bwf_project_id
  ON public.bwf_quote (bwf_project_id);

COMMENT ON COLUMN public.bwf_quote.bwf_project_id IS
  'PMS v3 bwf_projects.id (cross-project UUID, no local FK). Set when quote is linked to a PMS project; often accompanies bwf_pitching_id.';

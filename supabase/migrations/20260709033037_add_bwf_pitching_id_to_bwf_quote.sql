-- Link Furniture quotes to PMS pitching rows (cross-DB uuid, no FK).
-- Safe to re-run: column/index already exist on some environments.

ALTER TABLE public.bwf_quote
  ADD COLUMN IF NOT EXISTS bwf_pitching_id uuid;

CREATE INDEX IF NOT EXISTS idx_bwf_quote_bwf_pitching_id
  ON public.bwf_quote (bwf_pitching_id);

COMMENT ON COLUMN public.bwf_quote.bwf_pitching_id IS
  'PMS bwf_pitching.id (uuid in PMS DB). No cross-database FK.';

-- Best-effort backfill: reuse pitching_id already known for the same projectName
-- (PMS pitching_code stored in project_data.formData.projectName).
UPDATE public.bwf_quote AS q
SET bwf_pitching_id = src.bwf_pitching_id
FROM (
  SELECT DISTINCT ON (project_data->'formData'->>'projectName')
    project_data->'formData'->>'projectName' AS project_name,
    bwf_pitching_id
  FROM public.bwf_quote
  WHERE bwf_pitching_id IS NOT NULL
    AND COALESCE(project_data->'formData'->>'projectName', '') <> ''
  ORDER BY project_data->'formData'->>'projectName', created_at DESC NULLS LAST
) AS src
WHERE q.bwf_pitching_id IS NULL
  AND q.project_data->'formData'->>'projectName' = src.project_name;

-- Keep formData.pmsPitchingId in sync when the column is set but JSON lacks it.
UPDATE public.bwf_quote
SET project_data = jsonb_set(
  COALESCE(project_data, '{}'::jsonb),
  '{formData,pmsPitchingId}',
  to_jsonb(bwf_pitching_id::text),
  true
)
WHERE bwf_pitching_id IS NOT NULL
  AND COALESCE(project_data->'formData'->>'pmsPitchingId', '') = '';

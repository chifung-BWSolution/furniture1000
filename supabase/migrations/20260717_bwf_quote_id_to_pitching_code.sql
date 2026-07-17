-- Migrate bwf_quote.quote_id from legacy QYYYY-MMDD-NNN to PMS pitching_code.
-- One pitching code = one version chain; versions renumbered chronologically (v1, v2, …).
-- Rows with no resolvable pitching code are left unchanged (still Q… or other).

-- Drop unique (quote_id, version) while we rewrite keys/versions.
DROP INDEX IF EXISTS public.idx_bwf_quote_quote_id_version;

WITH resolved AS (
  SELECT
    q.id,
    COALESCE(
      NULLIF(BTRIM(q.pitching_code), ''),
      NULLIF(BTRIM(q.project_data #>> '{formData,pitchingCode}'), ''),
      -- Legacy handoff stuffed the code into formData.projectName
      NULLIF(BTRIM(q.project_data #>> '{formData,projectName}'), '')
    ) AS raw_code,
    COALESCE(q.modified_date, q.created_at, NOW()) AS sort_ts,
    q.created_at
  FROM public.bwf_quote q
),
normalized AS (
  SELECT
    id,
    sort_ts,
    created_at,
    CASE
      WHEN raw_code IS NULL THEN NULL
      -- Never treat legacy Q-format as a pitching code target
      WHEN raw_code ~ '^Q[0-9]{4}-[0-9]{4}-[0-9]{3}$' THEN NULL
      ELSE raw_code
    END AS target_code
  FROM resolved
),
ranked AS (
  SELECT
    id,
    target_code,
    ROW_NUMBER() OVER (
      PARTITION BY target_code
      ORDER BY sort_ts ASC, created_at ASC NULLS LAST, id ASC
    ) AS seq
  FROM normalized
  WHERE target_code IS NOT NULL
)
UPDATE public.bwf_quote q
SET
  quote_id = r.target_code,
  version = 'v' || r.seq::text,
  pitching_code = COALESCE(NULLIF(BTRIM(q.pitching_code), ''), r.target_code),
  project_data = jsonb_set(
    COALESCE(q.project_data, '{}'::jsonb),
    '{formData,pitchingCode}',
    to_jsonb(r.target_code),
    true
  ),
  modified_date = COALESCE(q.modified_date, NOW())
FROM ranked r
WHERE q.id = r.id
  AND (
    q.quote_id IS DISTINCT FROM r.target_code
    OR q.version IS DISTINCT FROM ('v' || r.seq::text)
    OR NULLIF(BTRIM(q.pitching_code), '') IS NULL
  );

-- Recreate uniqueness: one version label per pitching-code chain.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bwf_quote_quote_id_version
  ON public.bwf_quote (quote_id, version);

COMMENT ON INDEX public.idx_bwf_quote_quote_id_version IS
  'Each quote_id (= pitching_code) may have many version rows (v1, v2, …).';

COMMENT ON COLUMN public.bwf_quote.quote_id IS
  'Version-chain key = PMS pitching_code (BWF-…). Deep link /quote/<quote_id>. Legacy QYYYY-MMDD-NNN removed.';

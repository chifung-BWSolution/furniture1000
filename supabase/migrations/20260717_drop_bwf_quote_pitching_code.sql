-- Single source of truth for quote number / chain key: bwf_quote.quote_id.
-- Drop redundant bwf_quote.pitching_code column and stop mirroring into project_data.formData.pitchingCode.

-- 1) Ensure quote_id is populated from the column before drop (safety net).
UPDATE public.bwf_quote q
SET quote_id = BTRIM(q.pitching_code)
WHERE (q.quote_id IS NULL OR BTRIM(q.quote_id) = '')
  AND q.pitching_code IS NOT NULL
  AND BTRIM(q.pitching_code) <> ''
  AND q.pitching_code !~ '^Q[0-9]{4}-[0-9]{4}-[0-9]{3}$';

UPDATE public.bwf_quote q
SET quote_id = BTRIM(q.project_data #>> '{formData,pitchingCode}')
WHERE (q.quote_id IS NULL OR BTRIM(q.quote_id) = '')
  AND NULLIF(BTRIM(q.project_data #>> '{formData,pitchingCode}'), '') IS NOT NULL
  AND (q.project_data #>> '{formData,pitchingCode}') !~ '^Q[0-9]{4}-[0-9]{4}-[0-9]{3}$';

-- 2) Strip JSON mirrors (keep pitchingName / other form fields).
UPDATE public.bwf_quote q
SET project_data = jsonb_set(
  COALESCE(q.project_data, '{}'::jsonb),
  '{formData}',
  COALESCE(q.project_data->'formData', '{}'::jsonb)
    - 'pitchingCode'
    - 'projectName',
  true
)
WHERE q.project_data->'formData' ? 'pitchingCode'
   OR q.project_data->'formData' ? 'projectName';

-- 3) Replace extract-items trigger: no longer sync pitching_code.
CREATE OR REPLACE FUNCTION public.bwf_quote_extract_embedded_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_items JSONB;
  rpc_items JSONB;
  pname TEXT;
  next_pd JSONB;
BEGIN
  IF TG_NARGS >= 0 AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  next_pd := COALESCE(NEW.project_data, '{}'::jsonb);

  pname := COALESCE(
    NULLIF(NEW.pitching_name, ''),
    NULLIF(next_pd->'formData'->>'pitchingName', '')
  );

  -- Drop legacy code mirrors if an old client still sends them.
  IF next_pd ? 'formData' THEN
    next_pd := jsonb_set(
      next_pd,
      '{formData}',
      COALESCE(next_pd->'formData', '{}'::jsonb) - 'pitchingCode' - 'projectName',
      true
    );
  END IF;

  raw_items := CASE
    WHEN next_pd ? 'items' THEN next_pd->'items'
    ELSE NULL
  END;

  IF raw_items IS NOT NULL OR next_pd IS DISTINCT FROM NEW.project_data OR NEW.pitching_name IS DISTINCT FROM pname THEN
    next_pd := next_pd - 'items';

    UPDATE public.bwf_quote
    SET
      project_data = next_pd,
      pitching_name = pname
    WHERE id = NEW.id
      AND (
        project_data IS DISTINCT FROM next_pd
        OR pitching_name IS DISTINCT FROM pname
      );
  END IF;

  IF raw_items IS NULL OR jsonb_typeof(raw_items) <> 'array' OR jsonb_array_length(raw_items) = 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.bwf_quote_item i WHERE i.quote_uuid = NEW.id LIMIT 1) THEN
    RETURN NEW;
  END IF;

  rpc_items := public.bwf_quote_items_json_to_rpc(raw_items);
  PERFORM public.save_bwf_quote_items(NEW.id, rpc_items);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bwf_quote_extract_embedded_items ON public.bwf_quote;
CREATE TRIGGER trg_bwf_quote_extract_embedded_items
  AFTER INSERT OR UPDATE OF project_data ON public.bwf_quote
  FOR EACH ROW
  EXECUTE FUNCTION public.bwf_quote_extract_embedded_items();

-- 4) Drop redundant column.
ALTER TABLE public.bwf_quote DROP COLUMN IF EXISTS pitching_code;

COMMENT ON COLUMN public.bwf_quote.quote_id IS
  'Sole quote number / version-chain key (= PMS pitching_code, e.g. BWF-…). Deep link /quote/<quote_id>.';

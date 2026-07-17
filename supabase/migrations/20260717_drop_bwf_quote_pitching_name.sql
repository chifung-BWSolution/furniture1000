-- List titles come from live PMS pitching; do not store name on bwf_quote.

-- 1) Strip JSON mirror
UPDATE public.bwf_quote q
SET project_data = jsonb_set(
  COALESCE(q.project_data, '{}'::jsonb),
  '{formData}',
  COALESCE(q.project_data->'formData', '{}'::jsonb) - 'pitchingName',
  true
)
WHERE q.project_data->'formData' ? 'pitchingName';

-- 2) Trigger: only extract embedded items + strip legacy code/name mirrors
CREATE OR REPLACE FUNCTION public.bwf_quote_extract_embedded_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_items JSONB;
  rpc_items JSONB;
  next_pd JSONB;
BEGIN
  IF TG_NARGS >= 0 AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  next_pd := COALESCE(NEW.project_data, '{}'::jsonb);

  -- Drop legacy mirrors if an old client still sends them.
  IF next_pd ? 'formData' THEN
    next_pd := jsonb_set(
      next_pd,
      '{formData}',
      COALESCE(next_pd->'formData', '{}'::jsonb)
        - 'pitchingCode'
        - 'projectName'
        - 'pitchingName',
      true
    );
  END IF;

  raw_items := CASE
    WHEN next_pd ? 'items' THEN next_pd->'items'
    ELSE NULL
  END;

  IF raw_items IS NOT NULL OR next_pd IS DISTINCT FROM NEW.project_data THEN
    next_pd := next_pd - 'items';

    UPDATE public.bwf_quote
    SET project_data = next_pd
    WHERE id = NEW.id
      AND project_data IS DISTINCT FROM next_pd;
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

-- 3) Drop column
ALTER TABLE public.bwf_quote DROP COLUMN IF EXISTS pitching_name;

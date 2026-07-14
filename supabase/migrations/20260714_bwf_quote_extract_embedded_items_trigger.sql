-- Safety net: if any client still writes project_data.items, extract to bwf_quote_item and strip.
-- Uses AFTER trigger so FK to bwf_quote.id is valid.

CREATE OR REPLACE FUNCTION public.bwf_quote_items_json_to_rpc(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  elem JSONB;
  out_arr JSONB := '[]'::jsonb;
  idx INT := 0;
  row_obj JSONB;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    row_obj := jsonb_build_object(
      'sort_order', COALESCE((elem->>'sort_order')::INT, idx),
      'client_item_id', COALESCE(NULLIF(elem->>'client_item_id', ''), NULLIF(elem->>'id', '')),
      'name', COALESCE(elem->>'name', ''),
      'image', COALESCE(elem->>'image', ''),
      'reference_image', COALESCE(NULLIF(elem->>'reference_image', ''), NULLIF(elem->>'referenceImage', '')),
      'remarks_image', COALESCE(NULLIF(elem->>'remarks_image', ''), NULLIF(elem->>'remarksImage', '')),
      'unit_price', COALESCE(
        NULLIF(elem->>'unit_price', '')::NUMERIC,
        NULLIF(elem->>'unitPrice', '')::NUMERIC,
        0
      ),
      'quantity', COALESCE(NULLIF(elem->>'quantity', '')::NUMERIC, 1),
      'unit', NULLIF(elem->>'unit', ''),
      'cost_price', COALESCE(
        NULLIF(elem->>'cost_price', '')::NUMERIC,
        NULLIF(elem->>'costPrice', '')::NUMERIC
      ),
      'exchange_rate', COALESCE(
        NULLIF(elem->>'exchange_rate', '')::NUMERIC,
        NULLIF(elem->>'exchangeRate', '')::NUMERIC
      ),
      'hkd_cost_price', COALESCE(
        NULLIF(elem->>'hkd_cost_price', '')::NUMERIC,
        NULLIF(elem->>'hkdCostPrice', '')::NUMERIC
      ),
      'category', NULLIF(elem->>'category', ''),
      'material', NULLIF(elem->>'material', ''),
      'color', NULLIF(elem->>'color', ''),
      'remarks', elem->>'remarks',
      'dimension_l_mm', COALESCE(
        NULLIF(elem->>'dimension_l_mm', '')::NUMERIC,
        NULLIF(elem->>'dimensionLMm', '')::NUMERIC
      ),
      'dimension_w_mm', COALESCE(
        NULLIF(elem->>'dimension_w_mm', '')::NUMERIC,
        NULLIF(elem->>'dimensionWMm', '')::NUMERIC
      ),
      'dimension_h_mm', COALESCE(
        NULLIF(elem->>'dimension_h_mm', '')::NUMERIC,
        NULLIF(elem->>'dimensionHMm', '')::NUMERIC
      ),
      'delivery_term_name', COALESCE(
        NULLIF(elem->>'delivery_term_name', ''),
        NULLIF(elem->>'deliveryTermName', '')
      ),
      'factory_name', COALESCE(
        NULLIF(elem->>'factory_name', ''),
        NULLIF(elem->>'factoryName', '')
      ),
      'factory_from_catalog', COALESCE(
        (elem->>'factory_from_catalog')::BOOLEAN,
        (elem->>'factoryFromCatalog')::BOOLEAN,
        false
      ),
      'is_custom_term', COALESCE(
        (elem->>'is_custom_term')::BOOLEAN,
        (elem->>'isCustomTerm')::BOOLEAN,
        false
      )
    );
    out_arr := out_arr || jsonb_build_array(row_obj);
    idx := idx + 1;
  END LOOP;

  RETURN out_arr;
END;
$$;

CREATE OR REPLACE FUNCTION public.bwf_quote_extract_embedded_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_items JSONB;
  rpc_items JSONB;
  code TEXT;
  pname TEXT;
  next_pd JSONB;
BEGIN
  -- Prevent recursive re-entry from our own UPDATE below
  IF TG_NARGS >= 0 AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  next_pd := COALESCE(NEW.project_data, '{}'::jsonb);

  code := COALESCE(
    NULLIF(NEW.pitching_code, ''),
    NULLIF(next_pd->'formData'->>'pitchingCode', ''),
    NULLIF(next_pd->'formData'->>'projectName', ''),
    NULLIF(next_pd->'quoteMeta'->>'projectName', '')
  );
  pname := COALESCE(
    NULLIF(NEW.pitching_name, ''),
    NULLIF(next_pd->'formData'->>'pitchingName', '')
  );

  raw_items := CASE
    WHEN next_pd ? 'items' THEN next_pd->'items'
    ELSE NULL
  END;

  IF raw_items IS NOT NULL OR NEW.pitching_code IS DISTINCT FROM code OR NEW.pitching_name IS DISTINCT FROM pname THEN
    next_pd := next_pd - 'items';

    UPDATE public.bwf_quote
    SET
      project_data = next_pd,
      pitching_code = code,
      pitching_name = pname
    WHERE id = NEW.id
      AND (
        project_data IS DISTINCT FROM next_pd
        OR pitching_code IS DISTINCT FROM code
        OR pitching_name IS DISTINCT FROM pname
      );
  END IF;

  IF raw_items IS NULL OR jsonb_typeof(raw_items) <> 'array' OR jsonb_array_length(raw_items) = 0 THEN
    RETURN NEW;
  END IF;

  -- Seed table only when empty (don't overwrite a correct replaceQuoteItems write)
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

-- One-shot repair for current bad rows
DO $$
DECLARE
  r RECORD;
  rpc_items JSONB;
  code TEXT;
  pname TEXT;
BEGIN
  FOR r IN
    SELECT id, project_data, pitching_code, pitching_name
    FROM public.bwf_quote
    WHERE project_data ? 'items'
      AND jsonb_typeof(project_data->'items') = 'array'
      AND jsonb_array_length(project_data->'items') > 0
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.bwf_quote_item i WHERE i.quote_uuid = r.id LIMIT 1) THEN
      rpc_items := public.bwf_quote_items_json_to_rpc(r.project_data->'items');
      PERFORM public.save_bwf_quote_items(r.id, rpc_items);
    END IF;

    code := COALESCE(
      NULLIF(r.pitching_code, ''),
      NULLIF(r.project_data->'formData'->>'pitchingCode', ''),
      NULLIF(r.project_data->'formData'->>'projectName', ''),
      NULLIF(r.project_data->'quoteMeta'->>'projectName', '')
    );
    pname := COALESCE(
      NULLIF(r.pitching_name, ''),
      NULLIF(r.project_data->'formData'->>'pitchingName', '')
    );

    UPDATE public.bwf_quote
    SET
      project_data = project_data - 'items',
      pitching_code = COALESCE(NULLIF(pitching_code, ''), code),
      pitching_name = COALESCE(NULLIF(pitching_name, ''), pname)
    WHERE id = r.id;
  END LOOP;
END $$;

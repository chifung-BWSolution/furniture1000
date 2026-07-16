-- Section title rows (e.g. 一、開放區) — not priced; span full table width in PDF.

ALTER TABLE public.bwf_quote_item
  ADD COLUMN IF NOT EXISTS is_section_title BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bwf_quote_item.is_section_title IS
  'When true, row is a section heading (一、二、三…) — not priced; PDF renders as full-width title.';

CREATE OR REPLACE FUNCTION public.save_bwf_quote_items(
  p_quote_uuid UUID,
  p_items JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  elem JSONB;
  idx INT := 0;
BEGIN
  IF p_quote_uuid IS NULL THEN
    RAISE EXCEPTION 'p_quote_uuid is required';
  END IF;

  DELETE FROM public.bwf_quote_item WHERE quote_uuid = p_quote_uuid;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN;
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.bwf_quote_item (
      quote_uuid,
      sort_order,
      client_item_id,
      name,
      image,
      reference_image,
      remarks_image,
      unit_price,
      quantity,
      unit,
      cost_price,
      exchange_rate,
      hkd_cost_price,
      category,
      material,
      color,
      remarks,
      dimension_l_mm,
      dimension_w_mm,
      dimension_h_mm,
      delivery_term_name,
      factory_name,
      factory_from_catalog,
      is_custom_term,
      is_optional,
      is_section_title
    ) VALUES (
      p_quote_uuid,
      COALESCE((elem->>'sort_order')::INT, idx),
      NULLIF(elem->>'client_item_id', ''),
      COALESCE(elem->>'name', ''),
      COALESCE(elem->>'image', ''),
      NULLIF(elem->>'reference_image', ''),
      NULLIF(elem->>'remarks_image', ''),
      COALESCE((elem->>'unit_price')::NUMERIC, 0),
      COALESCE((elem->>'quantity')::NUMERIC, 1),
      NULLIF(elem->>'unit', ''),
      CASE WHEN elem ? 'cost_price' AND elem->>'cost_price' IS NOT NULL AND elem->>'cost_price' <> ''
        THEN (elem->>'cost_price')::NUMERIC ELSE NULL END,
      CASE WHEN elem ? 'exchange_rate' AND elem->>'exchange_rate' IS NOT NULL AND elem->>'exchange_rate' <> ''
        THEN (elem->>'exchange_rate')::NUMERIC ELSE NULL END,
      CASE WHEN elem ? 'hkd_cost_price' AND elem->>'hkd_cost_price' IS NOT NULL AND elem->>'hkd_cost_price' <> ''
        THEN (elem->>'hkd_cost_price')::NUMERIC ELSE NULL END,
      NULLIF(elem->>'category', ''),
      NULLIF(elem->>'material', ''),
      NULLIF(elem->>'color', ''),
      elem->>'remarks',
      CASE WHEN elem ? 'dimension_l_mm' AND elem->>'dimension_l_mm' IS NOT NULL AND elem->>'dimension_l_mm' <> ''
        THEN (elem->>'dimension_l_mm')::NUMERIC ELSE NULL END,
      CASE WHEN elem ? 'dimension_w_mm' AND elem->>'dimension_w_mm' IS NOT NULL AND elem->>'dimension_w_mm' <> ''
        THEN (elem->>'dimension_w_mm')::NUMERIC ELSE NULL END,
      CASE WHEN elem ? 'dimension_h_mm' AND elem->>'dimension_h_mm' IS NOT NULL AND elem->>'dimension_h_mm' <> ''
        THEN (elem->>'dimension_h_mm')::NUMERIC ELSE NULL END,
      NULLIF(elem->>'delivery_term_name', ''),
      NULLIF(elem->>'factory_name', ''),
      COALESCE((elem->>'factory_from_catalog')::BOOLEAN, false),
      COALESCE((elem->>'is_custom_term')::BOOLEAN, false),
      COALESCE((elem->>'is_optional')::BOOLEAN, false),
      COALESCE((elem->>'is_section_title')::BOOLEAN, false)
    );
    idx := idx + 1;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_bwf_quote_items(UUID, JSONB) TO anon, authenticated, service_role;

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
      ),
      'is_optional', COALESCE(
        (elem->>'is_optional')::BOOLEAN,
        (elem->>'isOptional')::BOOLEAN,
        false
      ),
      'is_section_title', COALESCE(
        (elem->>'is_section_title')::BOOLEAN,
        (elem->>'isSectionTitle')::BOOLEAN,
        false
      )
    );
    out_arr := out_arr || jsonb_build_array(row_obj);
    idx := idx + 1;
  END LOOP;

  RETURN out_arr;
END;
$$;

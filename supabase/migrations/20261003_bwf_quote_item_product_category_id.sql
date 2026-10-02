-- Link quote line items to product_category registry (UUID FK).

ALTER TABLE public.bwf_quote_item
  ADD COLUMN IF NOT EXISTS product_category_id UUID
    REFERENCES public.product_category(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bwf_quote_item_product_category_id
  ON public.bwf_quote_item (product_category_id)
  WHERE product_category_id IS NOT NULL;

COMMENT ON COLUMN public.bwf_quote_item.product_category_id IS
  'FK to product_category.id. Locked when product_id is set and product has a category.';

-- Resolve free-text label to a registry row (exact or fuzzy); only when exactly one match.
CREATE OR REPLACE FUNCTION public.resolve_product_category_id_from_label(
  p_label TEXT,
  p_fuzzy BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_lbl TEXT := nullif(btrim(coalesce(p_label, '')), '');
  v_ids UUID[];
BEGIN
  IF v_lbl IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT p_fuzzy THEN
    SELECT array_agg(DISTINCT c.id ORDER BY c.id)
      INTO v_ids
    FROM public.product_category c
    WHERE btrim(c.level2) = v_lbl
       OR (btrim(c.level1) || ' / ' || btrim(c.level2)) = v_lbl
       OR btrim(c.level1) = v_lbl;
  ELSE
    SELECT array_agg(DISTINCT c.id ORDER BY c.id)
      INTO v_ids
    FROM public.product_category c
    WHERE btrim(c.level2) ILIKE ('%' || v_lbl || '%')
       OR btrim(c.level1) ILIKE ('%' || v_lbl || '%')
       OR (btrim(c.level1) || btrim(c.level2)) ILIKE ('%' || v_lbl || '%');
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) <> 1 THEN
    RETURN NULL;
  END IF;

  RETURN v_ids[1];
END;
$$;

-- Backfill (priority order; each step only fills NULL product_category_id).
-- 1) product_id → products.product_category_id
UPDATE public.bwf_quote_item qi
SET product_category_id = p.product_category_id
FROM public.products p
WHERE qi.product_category_id IS NULL
  AND qi.product_id IS NOT NULL
  AND p.id = qi.product_id
  AND p.product_category_id IS NOT NULL;

-- 2) category exact
UPDATE public.bwf_quote_item qi
SET product_category_id = public.resolve_product_category_id_from_label(qi.category, false)
WHERE qi.product_category_id IS NULL
  AND nullif(btrim(coalesce(qi.category, '')), '') IS NOT NULL
  AND public.resolve_product_category_id_from_label(qi.category, false) IS NOT NULL;

-- 3) name exact
UPDATE public.bwf_quote_item qi
SET product_category_id = public.resolve_product_category_id_from_label(qi.name, false)
WHERE qi.product_category_id IS NULL
  AND nullif(btrim(coalesce(qi.name, '')), '') IS NOT NULL
  AND public.resolve_product_category_id_from_label(qi.name, false) IS NOT NULL;

-- 4) category fuzzy
UPDATE public.bwf_quote_item qi
SET product_category_id = public.resolve_product_category_id_from_label(qi.category, true)
WHERE qi.product_category_id IS NULL
  AND nullif(btrim(coalesce(qi.category, '')), '') IS NOT NULL
  AND public.resolve_product_category_id_from_label(qi.category, true) IS NOT NULL;

-- 5) name fuzzy
UPDATE public.bwf_quote_item qi
SET product_category_id = public.resolve_product_category_id_from_label(qi.name, true)
WHERE qi.product_category_id IS NULL
  AND nullif(btrim(coalesce(qi.name, '')), '') IS NOT NULL
  AND public.resolve_product_category_id_from_label(qi.name, true) IS NOT NULL;

-- When a line links to a product with a registry category, follow the product.
CREATE OR REPLACE FUNCTION public.sync_bwf_quote_item_product_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cat UUID;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.product_category_id
    INTO v_cat
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_cat IS NOT NULL THEN
    NEW.product_category_id := v_cat;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bwf_quote_item_product_category ON public.bwf_quote_item;
CREATE TRIGGER trg_sync_bwf_quote_item_product_category
  BEFORE INSERT OR UPDATE OF product_id, product_category_id
  ON public.bwf_quote_item
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_bwf_quote_item_product_category();

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
      is_section_title,
      sku,
      hide_in_pdf,
      product_id,
      product_category_id
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
      NULLIF(BTRIM(elem->>'dimension_l_mm'), ''),
      NULLIF(BTRIM(elem->>'dimension_w_mm'), ''),
      NULLIF(BTRIM(elem->>'dimension_h_mm'), ''),
      NULLIF(elem->>'delivery_term_name', ''),
      NULLIF(elem->>'factory_name', ''),
      COALESCE((elem->>'factory_from_catalog')::BOOLEAN, false),
      COALESCE((elem->>'is_custom_term')::BOOLEAN, false),
      COALESCE((elem->>'is_optional')::BOOLEAN, false),
      COALESCE((elem->>'is_section_title')::BOOLEAN, false),
      NULLIF(BTRIM(elem->>'sku'), ''),
      COALESCE((elem->>'hide_in_pdf')::BOOLEAN, false),
      NULLIF(COALESCE(elem->>'product_id', elem->>'productId'), ''),
      NULLIF(COALESCE(elem->>'product_category_id', elem->>'productCategoryId'), '')::UUID
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
        NULLIF(BTRIM(elem->>'dimension_l_mm'), ''),
        NULLIF(BTRIM(elem->>'dimensionLMm'), '')
      ),
      'dimension_w_mm', COALESCE(
        NULLIF(BTRIM(elem->>'dimension_w_mm'), ''),
        NULLIF(BTRIM(elem->>'dimensionWMm'), '')
      ),
      'dimension_h_mm', COALESCE(
        NULLIF(BTRIM(elem->>'dimension_h_mm'), ''),
        NULLIF(BTRIM(elem->>'dimensionHMm'), '')
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
      ),
      'sku', NULLIF(BTRIM(COALESCE(elem->>'sku', '')), ''),
      'hide_in_pdf', COALESCE(
        (elem->>'hide_in_pdf')::BOOLEAN,
        (elem->>'hideInPdf')::BOOLEAN,
        false
      ),
      'product_id', NULLIF(COALESCE(elem->>'product_id', elem->>'productId'), ''),
      'product_category_id', NULLIF(COALESCE(elem->>'product_category_id', elem->>'productCategoryId'), '')
    );
    out_arr := out_arr || jsonb_build_array(row_obj);
    idx := idx + 1;
  END LOOP;

  RETURN out_arr;
END;
$$;

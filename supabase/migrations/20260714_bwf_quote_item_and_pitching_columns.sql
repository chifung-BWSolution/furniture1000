-- Promote pitching code/name onto bwf_quote; extract line items to bwf_quote_item.

ALTER TABLE public.bwf_quote
  ADD COLUMN IF NOT EXISTS pitching_code TEXT,
  ADD COLUMN IF NOT EXISTS pitching_name TEXT;

COMMENT ON COLUMN public.bwf_quote.pitching_code IS
  'PMS pitching_code (or project_code). Displayed as 報價單號; quote_id remains internal.';
COMMENT ON COLUMN public.bwf_quote.pitching_name IS
  'PMS pitching_name. List/search recognition only; not shown on quote form/PDF.';

CREATE TABLE IF NOT EXISTS public.bwf_quote_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_uuid UUID NOT NULL REFERENCES public.bwf_quote(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  client_item_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  reference_image TEXT,
  remarks_image TEXT,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT,
  cost_price NUMERIC,
  exchange_rate NUMERIC,
  hkd_cost_price NUMERIC,
  category TEXT,
  material TEXT,
  color TEXT,
  remarks TEXT,
  dimension_l_mm NUMERIC,
  dimension_w_mm NUMERIC,
  dimension_h_mm NUMERIC,
  delivery_term_name TEXT,
  factory_name TEXT,
  factory_from_catalog BOOLEAN DEFAULT false,
  is_custom_term BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bwf_quote_item_quote_sort
  ON public.bwf_quote_item (quote_uuid, sort_order);

ALTER TABLE public.bwf_quote_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to bwf_quote_item" ON public.bwf_quote_item;
CREATE POLICY "Allow all access to bwf_quote_item"
  ON public.bwf_quote_item FOR ALL
  USING (true)
  WITH CHECK (true);

-- Atomic replace-all for quote line items
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
      is_custom_term
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
      COALESCE((elem->>'is_custom_term')::BOOLEAN, false)
    );
    idx := idx + 1;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_bwf_quote_items(UUID, JSONB) TO anon, authenticated, service_role;

-- Backfill pitching_code from legacy formData.projectName / pitchingCode
UPDATE public.bwf_quote q
SET pitching_code = COALESCE(
  NULLIF(q.project_data->'formData'->>'pitchingCode', ''),
  NULLIF(q.project_data->'formData'->>'projectName', ''),
  NULLIF(q.project_data->'quoteMeta'->>'projectName', ''),
  q.pitching_code
)
WHERE q.pitching_code IS NULL
  OR q.pitching_code = '';

-- Migrate project_data.items → bwf_quote_item (skip quotes that already have rows)
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
  is_custom_term
)
SELECT
  q.id,
  (ord.ordinality - 1)::INT,
  NULLIF(elem->>'id', ''),
  COALESCE(elem->>'name', ''),
  COALESCE(elem->>'image', ''),
  NULLIF(elem->>'referenceImage', ''),
  NULLIF(elem->>'remarksImage', ''),
  COALESCE((elem->>'unitPrice')::NUMERIC, 0),
  COALESCE((elem->>'quantity')::NUMERIC, 1),
  NULLIF(elem->>'unit', ''),
  CASE WHEN elem ? 'costPrice' AND elem->>'costPrice' IS NOT NULL AND elem->>'costPrice' <> ''
    THEN (elem->>'costPrice')::NUMERIC ELSE NULL END,
  CASE WHEN elem ? 'exchangeRate' AND elem->>'exchangeRate' IS NOT NULL AND elem->>'exchangeRate' <> ''
    THEN (elem->>'exchangeRate')::NUMERIC ELSE NULL END,
  CASE WHEN elem ? 'hkdCostPrice' AND elem->>'hkdCostPrice' IS NOT NULL AND elem->>'hkdCostPrice' <> ''
    THEN (elem->>'hkdCostPrice')::NUMERIC ELSE NULL END,
  NULLIF(elem->>'category', ''),
  NULLIF(elem->>'material', ''),
  NULLIF(elem->>'color', ''),
  elem->>'remarks',
  CASE WHEN elem ? 'dimensionLMm' AND elem->>'dimensionLMm' IS NOT NULL AND elem->>'dimensionLMm' <> ''
    THEN (elem->>'dimensionLMm')::NUMERIC ELSE NULL END,
  CASE WHEN elem ? 'dimensionWMm' AND elem->>'dimensionWMm' IS NOT NULL AND elem->>'dimensionWMm' <> ''
    THEN (elem->>'dimensionWMm')::NUMERIC ELSE NULL END,
  CASE WHEN elem ? 'dimensionHMm' AND elem->>'dimensionHMm' IS NOT NULL AND elem->>'dimensionHMm' <> ''
    THEN (elem->>'dimensionHMm')::NUMERIC ELSE NULL END,
  NULLIF(elem->>'deliveryTermName', ''),
  NULLIF(elem->>'factoryName', ''),
  COALESCE((elem->>'factoryFromCatalog')::BOOLEAN, false),
  COALESCE((elem->>'isCustomTerm')::BOOLEAN, false)
FROM public.bwf_quote q
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(q.project_data->'items') = 'array' THEN q.project_data->'items'
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS ord(elem, ordinality)
WHERE jsonb_typeof(q.project_data->'items') = 'array'
  AND jsonb_array_length(q.project_data->'items') > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.bwf_quote_item i WHERE i.quote_uuid = q.id
  );

-- Strip items from project_data after migration
UPDATE public.bwf_quote
SET project_data = project_data - 'items'
WHERE project_data ? 'items';

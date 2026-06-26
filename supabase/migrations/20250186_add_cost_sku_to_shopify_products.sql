-- Cost + SKU on shopify_products mirror (已上載產品 list reads these columns).
ALTER TABLE public.shopify_products
  ADD COLUMN IF NOT EXISTS cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS sku text;

CREATE INDEX IF NOT EXISTS shopify_products_sku_idx
  ON public.shopify_products (sku)
  WHERE sku IS NOT NULL AND sku <> '';

-- SKU: first non-empty variant sku in variants jsonb array
UPDATE public.shopify_products sp
SET sku = NULLIF(TRIM(v.sku), '')
FROM (
  SELECT
    id,
    (
      SELECT NULLIF(TRIM(elem->>'sku'), '')
      FROM jsonb_array_elements(sp2.variants) AS elem
      WHERE NULLIF(TRIM(elem->>'sku'), '') IS NOT NULL
      LIMIT 1
    ) AS sku
  FROM public.shopify_products sp2
  WHERE sp2.variants IS NOT NULL
    AND jsonb_typeof(sp2.variants) = 'array'
    AND jsonb_array_length(sp2.variants) > 0
) v
WHERE sp.id = v.id
  AND (sp.sku IS NULL OR sp.sku = '')
  AND v.sku IS NOT NULL;

-- Cost: products.cost_price via source_product_id
UPDATE public.shopify_products sp
SET cost = p.cost_price
FROM public.products p
WHERE sp.source_product_id = p.id
  AND sp.cost IS NULL
  AND p.cost_price IS NOT NULL;

-- Cost: ready_to_shopify.cost (staging row may still exist for some products)
UPDATE public.shopify_products sp
SET cost = rts.cost
FROM public.ready_to_shopify rts
WHERE sp.source_product_id = rts.product_id
  AND sp.cost IS NULL
  AND rts.cost IS NOT NULL;

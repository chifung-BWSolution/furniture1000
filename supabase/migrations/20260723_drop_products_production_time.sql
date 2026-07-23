-- Remove unused products.production_time (always empty).
-- Excel「生產時間／生產週期」now writes products.customize.
-- Do NOT touch shopify_products."my_fields.production_time" (Shopify metafield).

ALTER TABLE public.products
  DROP COLUMN IF EXISTS production_time;

NOTIFY pgrst, 'reload schema';

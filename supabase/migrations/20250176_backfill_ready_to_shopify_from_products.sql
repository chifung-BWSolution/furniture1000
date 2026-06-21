-- Backfill ready_to_shopify rows for products that have copy_done=true
-- but are missing a corresponding ready_to_shopify entry.
--
-- Root cause: 140 of the 154 products in 產品信息 were imported directly
-- with copy_done=true set, bypassing the 產品文案 save flow that normally
-- creates ready_to_shopify rows. Without a row here, the image display in
-- 產品信息 only shows 1 image (products.image_url) instead of the full
-- image set from ready_to_shopify.image_url + ready_to_shopify.images.
--
-- This migration is safe to run multiple times (only INSERTs where missing).

INSERT INTO public.ready_to_shopify (
  product_id,
  title,
  body_html,
  vendor,
  product_type,
  handle,
  status,
  image_url,
  images,
  tags,
  price,
  cost,
  sku,
  shopify_page_title,
  imported_at,
  furniture_group_checked
)
SELECT
  p.id                                                                    AS product_id,
  p.title,
  COALESCE(NULLIF(p.description_html, ''), NULLIF(p.description, ''))   AS body_html,
  NULLIF(TRIM(COALESCE(p.factories_display_name, '')), '')               AS vendor,
  NULLIF(
    TRIM(
      COALESCE(p.level1_category, '') ||
      CASE
        WHEN p.level2_category IS NOT NULL AND p.level2_category <> ''
        THEN ' / ' || p.level2_category
        ELSE ''
      END
    ), ''
  )                                                                       AS product_type,
  NULLIF(COALESCE(NULLIF(TRIM(p.sku), ''), NULLIF(TRIM(p.model), '')), '') AS handle,
  'draft'                                                                 AS status,
  NULLIF(TRIM(p.image_url), '')                                          AS image_url,
  -- Copy images JSONB array (may contain {src, alt, position} objects or base64 strings)
  p.images,
  CASE WHEN array_length(p.tags, 1) > 0 THEN p.tags ELSE NULL END       AS tags,
  COALESCE(p.sale_price, p.price)                                        AS price,
  p.cost_price                                                            AS cost,
  NULLIF(COALESCE(NULLIF(TRIM(p.sku), ''), NULLIF(TRIM(p.model), '')), '') AS sku,
  p.title                                                                 AS shopify_page_title,
  NOW()                                                                   AS imported_at,
  false                                                                   AS furniture_group_checked
FROM public.products p
WHERE p.in_shopify_queue = true
  AND p.copy_done = true
  AND NOT EXISTS (
    SELECT 1
    FROM   public.ready_to_shopify rts
    WHERE  rts.product_id = p.id
  );

-- ─── Diagnostics: duplicate products ────────────────────────────────────────
-- Run the query below manually in the Supabase SQL editor to inspect duplicates
-- BEFORE doing any cleanup. Do NOT run DELETE from this migration.
--
-- SELECT
--   title,
--   factories_display_name,
--   COUNT(*) AS cnt,
--   array_agg(id ORDER BY created_at) AS ids,
--   array_agg(status ORDER BY created_at) AS statuses,
--   array_agg(created_at ORDER BY created_at) AS created_ats
-- FROM public.products
-- GROUP BY title, factories_display_name
-- HAVING COUNT(*) > 1
-- ORDER BY cnt DESC, title;

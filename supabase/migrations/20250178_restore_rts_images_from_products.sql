-- Restore ready_to_shopify.images from products.images
--
-- Root cause: The deduplication migration (20250177) used ON DELETE CASCADE,
-- which deleted ready_to_shopify rows for products removed as duplicates.
-- The backfill (20250176) then recreated RTS rows copying products.images,
-- but products.images was NULL/[] for most products, leaving images empty.
--
-- Fix: copy non-empty products.images into ready_to_shopify.images where the
-- RTS row is currently empty.  After this, run the Settings image migration
-- tool to convert any base64 entries to Supabase Storage URLs.

-- ─── STEP 1: Preview (count rows that will be updated) ──────────────────────
-- SELECT
--   COUNT(*) AS will_restore
-- FROM public.ready_to_shopify r
-- JOIN public.products p ON r.product_id = p.id
-- WHERE (r.images IS NULL OR r.images = '[]'::jsonb)
--   AND p.images IS NOT NULL
--   AND p.images != '[]'::jsonb
--   AND jsonb_typeof(p.images) = 'array';

-- ─── STEP 2: Restore images ──────────────────────────────────────────────────
UPDATE public.ready_to_shopify r
SET images = p.images
FROM public.products p
WHERE r.product_id = p.id
  AND (r.images IS NULL OR r.images = '[]'::jsonb)
  AND p.images IS NOT NULL
  AND p.images != '[]'::jsonb
  AND jsonb_typeof(p.images) = 'array';

-- ─── STEP 3: Also restore image_url from products where RTS has no URL ───────
-- (only fills rows where image_url is still NULL/empty, not where it's base64 —
--  base64 image_url is handled by the Settings → image migration tool)
UPDATE public.ready_to_shopify r
SET image_url = NULLIF(TRIM(p.image_url), '')
FROM public.products p
WHERE r.product_id = p.id
  AND (r.image_url IS NULL OR r.image_url = '')
  AND p.image_url IS NOT NULL
  AND p.image_url != '';

-- ─── STEP 4: Verification ─────────────────────────────────────────────────────
-- Run the query below to check results after applying this migration:
--
-- SELECT
--   COUNT(*)                                                                AS total_rts,
--   COUNT(CASE WHEN images IS NULL OR images = '[]'::jsonb THEN 1 END)     AS still_empty_images,
--   COUNT(CASE WHEN images IS NOT NULL AND images != '[]'::jsonb THEN 1 END) AS has_images,
--   COUNT(CASE WHEN image_url LIKE 'https://%' THEN 1 END)                 AS http_image_url,
--   COUNT(CASE WHEN image_url LIKE 'data:%' THEN 1 END)                    AS base64_image_url
-- FROM public.ready_to_shopify;

-- Deduplicate products table.
--
-- Root cause: products were imported multiple times from Excel/PDF uploads,
-- creating 2-4 identical rows per product (same title + same factory).
-- All duplicates have status='draft' — no live/published data is at risk.
--
-- Strategy: for each (title, factories_display_name) group with >1 row,
-- keep the row with the MOST workflow progress; break ties by newest created_at.
-- Workflow priority: info_done > copy_done > in_shopify_queue > created_at DESC
--
-- ON DELETE CASCADE on ready_to_shopify.product_id and
-- product_variants.product_id means child rows are cleaned up automatically.
--
-- STEP 1 — Preview what will be deleted (run this SELECT first to verify):
-- -------------------------------------------------------------------------
-- WITH ranked AS (
--   SELECT id, title, factories_display_name, created_at,
--     ROW_NUMBER() OVER (
--       PARTITION BY title, COALESCE(factories_display_name, '')
--       ORDER BY
--         COALESCE(info_done,         false) DESC,
--         COALESCE(copy_done,         false) DESC,
--         COALESCE(in_shopify_queue,  false) DESC,
--         created_at DESC
--     ) AS rn
--   FROM public.products
-- )
-- SELECT id, title, factories_display_name, created_at, rn
-- FROM ranked
-- WHERE rn > 1
-- ORDER BY title, rn;

-- STEP 2 — Delete loser duplicates
-- -------------------------------------------------------------------------
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY title, COALESCE(factories_display_name, '')
      ORDER BY
        COALESCE(info_done,         false) DESC,
        COALESCE(copy_done,         false) DESC,
        COALESCE(in_shopify_queue,  false) DESC,
        created_at DESC
    ) AS rn
  FROM public.products
)
DELETE FROM public.products
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- After this runs:
-- • products table should drop from ~2,496 → ~154 rows in the active workflow
--   plus whatever unique non-duplicate rows exist outside the workflow.
-- • ready_to_shopify rows for deleted products are cascade-deleted.
-- • product_variants rows for deleted products are cascade-deleted.

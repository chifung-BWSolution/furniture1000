-- Publish workflow flags on ready_to_shopify (source of truth for 產品文案 / 產品信息 lists).
-- products.in_shopify_queue / in_catalog remain for 待處理產品 & 產品目錄 visibility.

ALTER TABLE public.ready_to_shopify
  ADD COLUMN IF NOT EXISTS in_shopify_queue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS copy_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS copy_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS copy_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS info_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revert_reason jsonb;

-- Backfill from products for existing staging rows.
UPDATE public.ready_to_shopify r
SET
  in_shopify_queue = COALESCE(p.in_shopify_queue, false),
  copy_done = COALESCE(p.copy_done, false),
  copy_done_at = p.copy_done_at,
  copy_queued_at = p.copy_queued_at,
  info_done = COALESCE(p.info_done, false),
  revert_reason = p.revert_reason
FROM public.products p
WHERE r.product_id = p.id;

CREATE INDEX IF NOT EXISTS ready_to_shopify_copywriting_idx
  ON public.ready_to_shopify (copy_queued_at DESC NULLS LAST, imported_at DESC)
  WHERE in_shopify_queue = true
    AND copy_done = false;

CREATE INDEX IF NOT EXISTS ready_to_shopify_product_info_idx
  ON public.ready_to_shopify (copy_done_at DESC NULLS LAST, imported_at DESC)
  WHERE in_shopify_queue = true
    AND copy_done = true
    AND info_done = false;

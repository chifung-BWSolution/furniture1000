-- Track when products enter 傢俬組檢查 and 準備上載 so list pages can sort newest-first.
ALTER TABLE public.ready_to_shopify
  ADD COLUMN IF NOT EXISTS info_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_to_publish_at timestamptz;

-- Best-effort backfill for existing rows.
UPDATE public.ready_to_shopify
SET info_completed_at = imported_at
WHERE info_completed_at IS NULL
  AND furniture_group_checked IS NOT NULL;

UPDATE public.ready_to_shopify
SET ready_to_publish_at = imported_at
WHERE ready_to_publish_at IS NULL
  AND furniture_group_checked = true;

CREATE INDEX IF NOT EXISTS ready_to_shopify_info_completed_at_idx
  ON public.ready_to_shopify (info_completed_at DESC NULLS LAST)
  WHERE furniture_group_checked = false;

CREATE INDEX IF NOT EXISTS ready_to_shopify_ready_to_publish_at_idx
  ON public.ready_to_shopify (ready_to_publish_at DESC NULLS LAST)
  WHERE furniture_group_checked = true;

-- Backfill upload_log from workflow timestamps that predate upload_log logging.
-- User is labelled 歷史紀錄 when no per-action user was captured.

-- 產品文案：products.copy_done_at
INSERT INTO public.upload_log (product_id, stage, action, user_name, logged_at)
SELECT p.id, 'copywriting', 'submit', '歷史紀錄', p.copy_done_at
FROM public.products p
WHERE p.copy_done = true
  AND p.copy_done_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = p.id
      AND u.stage = 'copywriting'
      AND u.action = 'submit'
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (p.copy_done_at AT TIME ZONE 'Asia/Hong_Kong')::date
  );

-- 產品信息：ready_to_shopify.info_completed_at
INSERT INTO public.upload_log (product_id, rts_id, stage, action, user_name, logged_at)
SELECT r.product_id, r.id, 'product_info', 'complete', '歷史紀錄', r.info_completed_at
FROM public.ready_to_shopify r
WHERE r.info_done = true
  AND r.info_completed_at IS NOT NULL
  AND r.product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = r.product_id
      AND u.stage = 'product_info'
      AND u.action IN ('save', 'complete')
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (r.info_completed_at AT TIME ZONE 'Asia/Hong_Kong')::date
  );

-- 傢俬組檢查：checked_edited_at（儲存）
INSERT INTO public.upload_log (product_id, rts_id, stage, action, user_name, logged_at)
SELECT r.product_id, r.id, 'furniture_group_check', 'save', '歷史紀錄', r.checked_edited_at
FROM public.ready_to_shopify r
WHERE r.checked_edited_at IS NOT NULL
  AND r.product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = r.product_id
      AND u.stage = 'furniture_group_check'
      AND u.action = 'save'
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (r.checked_edited_at AT TIME ZONE 'Asia/Hong_Kong')::date
  );

-- 傢俬組檢查：ready_to_publish_at（加入準備上載）
INSERT INTO public.upload_log (product_id, rts_id, stage, action, user_name, logged_at)
SELECT r.product_id, r.id, 'furniture_group_check', 'add_to_ready', '歷史紀錄', r.ready_to_publish_at
FROM public.ready_to_shopify r
WHERE r.ready_to_publish_at IS NOT NULL
  AND r.product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = r.product_id
      AND u.stage = 'furniture_group_check'
      AND u.action = 'add_to_ready'
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (r.ready_to_publish_at AT TIME ZONE 'Asia/Hong_Kong')::date
  );

-- 準備上載：products.synced_at（成功上傳 Shopify）
INSERT INTO public.upload_log (product_id, stage, action, user_name, logged_at)
SELECT p.id, 'ready_to_publish', 'upload', '歷史紀錄', p.synced_at
FROM public.products p
WHERE p.synced_at IS NOT NULL
  AND p.shopify_product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = p.id
      AND u.stage = 'ready_to_publish'
      AND u.action = 'upload'
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (p.synced_at AT TIME ZONE 'Asia/Hong_Kong')::date
  );

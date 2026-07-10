-- Expand historical recovery: products.info_done + synced_at for furniture_group_check

-- 產品信息：products.info_done + modified_date（合併 ready_to_shopify 未覆蓋的紀錄）
INSERT INTO public.upload_log (product_id, stage, action, user_name, logged_at)
SELECT p.id, 'product_info', 'complete', '（無用戶紀錄）', p.modified_date
FROM public.products p
WHERE p.info_done = true
  AND p.copy_done = true
  AND p.modified_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = p.id
      AND u.stage = 'product_info'
      AND u.action IN ('save', 'complete')
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (p.modified_date AT TIME ZONE 'Asia/Hong_Kong')::date
  );

-- 傢俬組檢查：已上傳產品視為曾通過檢查並加入準備上載（以 synced_at 日期）
INSERT INTO public.upload_log (product_id, stage, action, user_name, logged_at)
SELECT p.id, 'furniture_group_check', 'add_to_ready', '（無用戶紀錄）', p.synced_at
FROM public.products p
WHERE p.synced_at IS NOT NULL
  AND p.shopify_product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = p.id
      AND u.stage = 'furniture_group_check'
      AND u.action IN ('save', 'add_to_ready')
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (p.synced_at AT TIME ZONE 'Asia/Hong_Kong')::date
  );

-- ready_to_shopify：info_done 但缺 info_completed_at 時用 imported_at
INSERT INTO public.upload_log (product_id, rts_id, stage, action, user_name, logged_at)
SELECT r.product_id, r.id, 'product_info', 'complete', '（無用戶紀錄）', COALESCE(r.info_completed_at, r.imported_at)
FROM public.ready_to_shopify r
WHERE r.info_done = true
  AND r.product_id IS NOT NULL
  AND COALESCE(r.info_completed_at, r.imported_at) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = r.product_id
      AND u.stage = 'product_info'
      AND u.action IN ('save', 'complete')
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (COALESCE(r.info_completed_at, r.imported_at) AT TIME ZONE 'Asia/Hong_Kong')::date
  );

-- ready_to_shopify：furniture_group_checked 用 ready_to_publish_at / imported_at
INSERT INTO public.upload_log (product_id, rts_id, stage, action, user_name, logged_at)
SELECT r.product_id, r.id, 'furniture_group_check', 'add_to_ready', '（無用戶紀錄）',
       COALESCE(r.ready_to_publish_at, r.imported_at)
FROM public.ready_to_shopify r
WHERE r.furniture_group_checked = true
  AND r.product_id IS NOT NULL
  AND COALESCE(r.ready_to_publish_at, r.imported_at) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.upload_log u
    WHERE u.product_id = r.product_id
      AND u.stage = 'furniture_group_check'
      AND u.action IN ('save', 'add_to_ready')
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (COALESCE(r.ready_to_publish_at, r.imported_at) AT TIME ZONE 'Asia/Hong_Kong')::date
  );

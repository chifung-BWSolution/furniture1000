-- Attribute July 10 copywriting / product_info upload_log rows to chifung.login@gmail.com (Branding Works).
-- Fixes migration backfill rows that inserted user_name = '（無用戶紀錄）' without user_id.

UPDATE public.upload_log
SET
  user_id = '6971f828-2356-4073-b722-40caa3218d2b',
  user_email = 'chifung.login@gmail.com',
  user_name = 'Branding Works'
WHERE stage IN ('copywriting', 'product_info')
  AND (logged_at AT TIME ZONE 'Asia/Hong_Kong')::date = (
    (now() AT TIME ZONE 'Asia/Hong_Kong')::date
  );

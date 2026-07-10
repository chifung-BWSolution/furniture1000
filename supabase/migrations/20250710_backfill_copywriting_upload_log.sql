-- Backfill missing copywriting upload_log rows from products.copy_done_at.
-- Uses chifung.login@gmail.com → Branding Works (PMS staff for today's session).

INSERT INTO public.upload_log (product_id, stage, action, user_id, user_email, user_name, logged_at)
SELECT
  p.id,
  'copywriting',
  'submit',
  '6971f828-2356-4073-b722-40caa3218d2b',
  'chifung.login@gmail.com',
  'Branding Works',
  p.copy_done_at
FROM public.products p
WHERE p.copy_done = true
  AND p.copy_done_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.upload_log u
    WHERE u.product_id = p.id
      AND u.stage = 'copywriting'
      AND u.action = 'submit'
      AND (u.logged_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (p.copy_done_at AT TIME ZONE 'Asia/Hong_Kong')::date
  );

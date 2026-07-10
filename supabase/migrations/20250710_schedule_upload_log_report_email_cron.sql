-- Daily 18:00 HKT (10:00 UTC) email digest for 上載產品紀錄.
-- Requires Edge Function secrets: RESEND_API_KEY, UPLOAD_LOG_REPORT_FROM_EMAIL (optional).
-- Requires vault secret: service_role_key (same as shopify-token-hourly-refresh).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('upload-log-report-daily-email')
  FROM cron.job WHERE jobname = 'upload-log-report-daily-email';
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'upload-log-report-daily-email',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://riaubhtruisbwdlwjzur.supabase.co/functions/v1/send-upload-log-report-email',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
        LIMIT 1
      )
    ),
    body    := jsonb_build_object(
      'to', 'brandingworks.ebiz@gmail.com',
      'include_all_dates', false
    )
  ) AS request_id;
  $$
);

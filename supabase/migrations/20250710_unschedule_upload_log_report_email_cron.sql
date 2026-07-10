-- Disable daily 18:00 HKT upload log report email (requested 2026-07-10).

DO $$
BEGIN
  PERFORM cron.unschedule('upload-log-report-daily-email')
  FROM cron.job WHERE jobname = 'upload-log-report-daily-email';
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

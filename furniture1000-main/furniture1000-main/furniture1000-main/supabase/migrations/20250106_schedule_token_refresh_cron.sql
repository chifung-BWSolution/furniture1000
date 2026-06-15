CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('refresh-shopify-token')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh-shopify-token'
);

SELECT cron.schedule(
  'refresh-shopify-token',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/supabase-functions-refresh-shopify-token',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

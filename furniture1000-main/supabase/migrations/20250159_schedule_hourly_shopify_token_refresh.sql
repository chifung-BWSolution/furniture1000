-- Schedule hourly cron job to refresh Shopify access tokens via client_credentials grant
-- Calls refresh-shopify-tokens edge function every hour at :00
SELECT cron.schedule(
  'refresh-shopify-tokens-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://riaubhtruisbwdlwjzur.supabase.co/functions/v1/refresh-shopify-tokens',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY_PLACEHOLDER"}'::jsonb,
    body := '{"grant_type":"client_credentials"}'::jsonb
  );
  $$
);

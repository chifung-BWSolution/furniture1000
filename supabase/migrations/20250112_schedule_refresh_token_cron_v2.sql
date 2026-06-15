-- Automated Shopify token refresh cron (v2 — refresh_token flow)
-- Runs every 60 minutes to keep Shopify access tokens fresh.
--
-- IMPORTANT: This migration requires pg_cron and pg_net extensions.
-- The service_role key is read from Supabase Vault for security.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any existing cron jobs for token refresh to avoid duplicates
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-shopify-token')
  FROM cron.job WHERE jobname = 'refresh-shopify-token';
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-shopify-tokens-hourly')
  FROM cron.job WHERE jobname = 'refresh-shopify-tokens-hourly';
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('shopify-token-auto-refresh')
  FROM cron.job WHERE jobname = 'shopify-token-auto-refresh';
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- Store the service_role_key in Vault if not already present
-- (You must manually insert your service role key into Vault first, or use the SQL Editor):
--
-- INSERT INTO vault.secrets (name, secret)
-- VALUES ('service_role_key', '<YOUR_SERVICE_ROLE_KEY>')
-- ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;

-- Schedule the Edge Function call every 60 minutes using pg_cron + pg_net
-- This calls the refresh-shopify-tokens function which uses the refresh_token grant flow
SELECT cron.schedule(
  'shopify-token-auto-refresh',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kqwktnplkqucsbasyfjl.supabase.co/functions/v1/supabase-functions-refresh-shopify-tokens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

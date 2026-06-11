-- Fix hourly Shopify token refresh cron job
-- Replaces all previous cron schedules with a single correct one
-- Uses correct Supabase project (kqwktnplkqucsbasyfjl) and Vault for service key
--
-- BEFORE RUNNING: execute the following in SQL Editor to store the service role key:
--   SELECT vault.create_secret('<YOUR_SERVICE_ROLE_KEY>', 'service_role_key');
--   -- or update if it already exists:
--   UPDATE vault.secrets SET secret = '<YOUR_SERVICE_ROLE_KEY>' WHERE name = 'service_role_key';

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Remove all previous conflicting cron jobs ──────────────────────────────
DO $$
DECLARE
  job_names TEXT[] := ARRAY[
    'refresh-shopify-token',
    'refresh-shopify-tokens',
    'refresh-shopify-tokens-hourly',
    'shopify-token-auto-refresh'
  ];
  job_name TEXT;
BEGIN
  FOREACH job_name IN ARRAY job_names LOOP
    BEGIN
      PERFORM cron.unschedule(job_name);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- job didn't exist, skip
    END;
  END LOOP;
END;
$$;

-- ── Upsert client_id + client_secret into shopify_connections ─────────────
-- Run this separately in Supabase SQL Editor with your real values:
--
--   UPDATE shopify_connections
--   SET client_id     = '<YOUR_SHOPIFY_CLIENT_ID>',
--       client_secret = '<YOUR_SHOPIFY_CLIENT_SECRET>',
--       updated_at    = NOW()
--   WHERE is_active = TRUE;
--
-- (Do NOT commit real secrets to git — set them via SQL Editor only)

-- ── Schedule fresh hourly cron using Vault for auth ────────────────────────
-- Calls refresh-shopify-token (singular) which uses client_credentials flow
-- when no refresh_token is stored, exactly matching the Postman flow described.
SELECT cron.schedule(
  'shopify-token-hourly-refresh',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kqwktnplkqucsbasyfjl.supabase.co/functions/v1/supabase-functions-refresh-shopify-token',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
        LIMIT 1
      )
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

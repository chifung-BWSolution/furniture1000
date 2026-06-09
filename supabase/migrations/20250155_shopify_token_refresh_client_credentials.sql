-- ============================================================
-- Shopify Token Auto-Refresh (Client Credentials + Refresh Token)
-- ============================================================
--
-- Flow:
--   1. Reads shop_domain, client_id, client_secret from shopify_connections
--   2. If refresh_token exists: uses grant_type=refresh_token (preferred)
--   3. Fallback: uses grant_type=client_credentials (as per requirement)
--      POST https://{shop}.myshopify.com/admin/oauth/access_token
--        grant_type=client_credentials
--        client_id={client_id}
--        client_secret={client_secret}
--   4. Updates access_token and token_expires_at in shopify_connections
--
-- The edge function supabase-functions-refresh-shopify-tokens already
-- handles both flows. This migration ensures the hourly cron is scheduled
-- against the correct project (riaubhtruisbwdlwjzur).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any duplicate/stale cron jobs
DO $$
DECLARE
  job_names text[] := ARRAY[
    'refresh-shopify-token',
    'refresh-shopify-tokens-hourly',
    'shopify-token-auto-refresh',
    'shopify-token-refresh-v2'
  ];
  jn text;
BEGIN
  FOREACH jn IN ARRAY job_names LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = jn) THEN
        PERFORM cron.unschedule(jn);
        RAISE NOTICE 'Unscheduled cron job: %', jn;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$$;

-- Schedule: every hour at minute 0
-- Calls the refresh-shopify-tokens edge function which:
--   - Tries refresh_token grant first (Shopify 90-day refresh tokens)
--   - Falls back to client_credentials grant when no refresh_token is stored
--   - Updates shopify_connections.access_token and token_expires_at
SELECT cron.schedule(
  'shopify-token-auto-refresh',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://riaubhtruisbwdlwjzur.supabase.co/functions/v1/supabase-functions-refresh-shopify-tokens',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM   vault.decrypted_secrets
        WHERE  name = 'service_role_key'
        LIMIT  1
      )
    ),
    body    := '{"grant_type":"client_credentials"}'::jsonb
  ) AS request_id;
  $$
);

-- Verify the job was created
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shopify-token-auto-refresh') THEN
    RAISE NOTICE '✅ shopify-token-auto-refresh cron job scheduled (every hour)';
  ELSE
    RAISE WARNING '⚠️ Failed to schedule shopify-token-auto-refresh';
  END IF;
END;
$$;

-- PMS project: private config for internal cron (no client access).
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.sync_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.sync_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all on sync_config" ON private.sync_config;
CREATE POLICY "Deny all on sync_config"
  ON private.sync_config
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.sync_config FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres;
GRANT ALL ON TABLE private.sync_config TO postgres;

-- Run on PMS project (kqwktnplkqucsbasyfjl).
-- Schedule: sync PMS auth.users → Furniture every 15 minutes.

DO $$
BEGIN
  PERFORM cron.unschedule('sync-pms-auth-to-bwf')
  FROM cron.job WHERE jobname = 'sync-pms-auth-to-bwf';
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'sync-pms-auth-to-bwf',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kqwktnplkqucsbasyfjl.supabase.co/functions/v1/supabase-functions-sync-pms-auth-to-bwf',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (SELECT value FROM private.sync_config WHERE key = 'pms_sso_shared_secret' LIMIT 1)
    ),
    body := '{"action":"sync"}'::jsonb
  ) AS request_id;
  $$
);

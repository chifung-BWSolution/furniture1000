#!/usr/bin/env node
/**
 * One-time setup for continuous PMS → Furniture auth sync cron.
 * Requires SUPABASE_ACCESS_TOKEN and PMS_SSO_SHARED_SECRET.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PMS_REF = process.env.PMS_PROJECT_REF || 'kqwktnplkqucsbasyfjl';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SECRET = process.env.PMS_SSO_SHARED_SECRET || process.env.PMS_AUTH_SYNC_SECRET;

if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is required');
  process.exit(1);
}
if (!SECRET) {
  console.error('PMS_SSO_SHARED_SECRET is required');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function runQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PMS_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  }
  return data;
}

async function main() {
  console.log('Enabling pg_net...');
  await runQuery('CREATE EXTENSION IF NOT EXISTS pg_net;');

  console.log('Creating private.sync_config...');
  await runQuery(`
    CREATE SCHEMA IF NOT EXISTS private;
    CREATE TABLE IF NOT EXISTS private.sync_config (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE private.sync_config ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Deny all on sync_config" ON private.sync_config;
    CREATE POLICY "Deny all on sync_config"
      ON private.sync_config FOR ALL TO public USING (false) WITH CHECK (false);
    REVOKE ALL ON SCHEMA private FROM PUBLIC;
    REVOKE ALL ON TABLE private.sync_config FROM PUBLIC;
    GRANT USAGE ON SCHEMA private TO postgres;
    GRANT ALL ON TABLE private.sync_config TO postgres;
  `);

  const escaped = SECRET.replace(/'/g, "''");
  console.log('Storing sync secret in private.sync_config...');
  await runQuery(`
    INSERT INTO private.sync_config (key, value, updated_at)
    VALUES ('pms_sso_shared_secret', '${escaped}', now())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now();
  `);

  const cronSql = readFileSync(
    join(root, 'supabase/migrations/20250703_pms_auth_sync_cron.sql'),
    'utf8',
  );
  console.log('Scheduling cron job sync-pms-auth-to-bwf (every 15 min)...');
  await runQuery(cronSql);

  const jobs = await runQuery(
    "SELECT jobid, jobname, schedule FROM cron.job WHERE jobname = 'sync-pms-auth-to-bwf';",
  );
  console.log('Cron job:', JSON.stringify(jobs, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

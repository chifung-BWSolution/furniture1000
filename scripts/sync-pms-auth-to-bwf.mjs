#!/usr/bin/env node
/**
 * Sync PMS auth.users → Furniture auth.users (same UUID).
 * Uses the PMS edge function supabase-functions-sync-pms-auth-to-bwf.
 *
 * Env:
 *   PMS_SUPABASE_URL=https://kqwktnplkqucsbasyfjl.supabase.co
 *   PMS_SSO_SHARED_SECRET (or PMS_AUTH_SYNC_SECRET)
 */

const PMS_URL = process.env.PMS_SUPABASE_URL || 'https://kqwktnplkqucsbasyfjl.supabase.co';
const SECRET = process.env.PMS_AUTH_SYNC_SECRET || process.env.PMS_SSO_SHARED_SECRET;

async function runSync(userId) {
  if (!SECRET) throw new Error('PMS_SSO_SHARED_SECRET or PMS_AUTH_SYNC_SECRET is required');

  const body = userId
    ? { action: 'sync_one', user_id: userId }
    : { action: 'sync' };

  const res = await fetch(`${PMS_URL}/functions/v1/supabase-functions-sync-pms-auth-to-bwf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-secret': SECRET,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `sync failed (${res.status})`);
  }
  return data;
}

const userId = process.argv[2];
runSync(userId)
  .then((data) => {
    console.log(JSON.stringify(data, null, 2));
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

#!/usr/bin/env node
// Read-only deployment check: migration history alone does not prove RPCs exist.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const env = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
const token = process.env.SUPABASE_ACCESS_TOKEN || env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
assert.ok(token, 'SUPABASE_ACCESS_TOKEN required');
const targets = {
  branch: 'omxizeukbcqzsnjsuwod',
  prod: 'riaubhtruisbwdlwjzur',
};
const selected = process.argv.includes('--refs=branch') ? ['branch']
  : process.argv.includes('--refs=prod') ? ['prod'] : Object.keys(targets);

async function api(ref, suffix, body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/${suffix}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${suffix}: HTTP ${response.status}`);
  return response.json();
}

let failed = false;
for (const target of selected) {
  const ref = targets[target];
  try {
    const [state] = await api(ref, 'database/query', { query: `
      select to_regprocedure('public.bwa_list_furniture_inquiries()') is not null as rpc,
        to_regclass('public.bwa_furniture_inquiry') is not null as header,
        to_regclass('public.bwa_furniture_inquiry_item') is not null as items;
    ` });
    assert.deepEqual(state, { rpc: true, header: true, items: true }, 'inquiry schema missing');

    // Exercise the real RPC as an existing authorized profile, with no data writes.
    const result = await api(ref, 'database/query', { query: `
      begin;
      select set_config('request.jwt.claims', jsonb_build_object(
        'sub', coalesce(auth_user_id, '00000000-0000-0000-0000-000000000001'::uuid),
        'email', email, 'role', 'authenticated')::text, true)
      from public.platform_user_profiles
      where active and lower(role) in ('admin', 'uploader', 'pm')
      order by (lower(role) = 'admin') desc limit 1;
      set local role authenticated;
      select jsonb_typeof(public.bwa_list_furniture_inquiries()) = 'array' as valid_list;
      rollback;
    ` });
    assert.ok(result.some(row => row.valid_list === true), 'authenticated inquiry query failed');

    const keys = await api(ref, 'api-keys');
    const anon = keys.find(key => key.name === 'anon')?.api_key;
    assert.ok(anon, 'anon API key unavailable');
    const response = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/bwa_list_furniture_inquiries`, {
      method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await response.json();
    assert.ok([401, 403].includes(response.status) && body.code === '42501',
      `expected anonymous permission denial, got HTTP ${response.status} ${body.code}`);
    console.log(`PASS ${target} (${ref}): schema present, authenticated query returns array, HTTP RPC registered and anonymous access denied`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${target} (${ref}): ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;

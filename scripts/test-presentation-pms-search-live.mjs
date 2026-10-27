// Read-only acceptance against the FDS environment configured in .env.local.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(line => /^\s*[A-Z_][A-Z_0-9]*=/.test(line))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]; }));
assert.ok(env.VITE_SUPABASE_URL?.includes('omxizeukbcqzsnjsuwod'), 'live test requires the FDS2.0 development environment');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error: loginError } = await db.auth.signInWithPassword({ email: env.VITE_QUICK_LOGIN_EMAIL, password: env.VITE_QUICK_LOGIN_PASSWORD });
assert.equal(loginError, null, 'configured development login must succeed');
async function lookup(body) {
  const { data, error } = await db.functions.invoke('supabase-functions-fetch-pms-pitchings', { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch {}
    throw new Error(message);
  }
  assert.equal(data?.error, undefined);
  return data;
}
const customers = await lookup({ action: 'presentation_clients', search: 'J' });
assert.ok(Array.isArray(customers.clients) && customers.clients.length > 0, 'J must return PMS customers');
const projects = await lookup({ action: 'presentation_projects', search: '1' });
assert.ok(Array.isArray(projects.projects) && projects.projects.length > 0, '1 must return PMS projects');
const project = projects.projects.find(row => row.client?.id);
assert.ok(project, 'project search should resolve a customer by customer_id');
const filtered = await lookup({ action: 'presentation_projects', customer_id: project.client.id });
assert.ok(filtered.projects.length > 0);
assert.ok(filtered.projects.every(row => row.client?.id === project.client.id), 'customer filter must not return other customers projects');
const empty = await lookup({ action: 'presentation_clients', search: 'fds-pms-no-match-729482734982' });
assert.equal(empty.clients.length, 0);
const legacy = await lookup({ search: '1', limit: 1 });
assert.ok(Array.isArray(legacy.items), 'existing pitching consumers must keep their contract');
const denied = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/supabase-functions-fetch-pms-pitchings`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'presentation_clients', search: 'J' }),
});
assert.equal(denied.status, 401, 'anonymous lookup must be rejected');
console.log(JSON.stringify({ environment: 'FDS2.0 / PMS QMS_dev', customers: customers.clients.length, projects: projects.projects.length, filtered: filtered.projects.length, empty: 0, existingPitchings: 'passed', anonymous: denied.status }));

// Temporary: end-to-end test of FDS → Asana comment push against one authorised test task.
import crypto from 'node:crypto';
import fs from 'node:fs';

const REF = 'omxizeukbcqzsnjsuwod';
const TASK = '1204466337313611';
const FACTORY_ID = crypto.randomUUID();
const MARK = `FDS 測試留言（雙向同步）${new Date().toISOString().slice(0, 19)}`;

const env = fs.readFileSync('.env.local', 'utf8');
const get = (key) => env.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? '';
const sb = get('SUPABASE_ACCESS_TOKEN');
const base = get('VITE_SUPABASE_URL').replace(/\/$/, '');
const anon = get('VITE_SUPABASE_ANON_KEY');
const email = get('VITE_QUICK_LOGIN_EMAIL');
const password = get('VITE_QUICK_LOGIN_PASSWORD');

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sb}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

const auth = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: anon },
  body: JSON.stringify({ email, password }),
});
const session = await auth.json();
if (!session.access_token) throw new Error('sign-in failed');

const [link] = await sql(`
  insert into public.fds_asana_factory_link (factory_id, factory_name, asana_task_gid)
  values ('${FACTORY_ID}', 'FDS 雙向測試', '${TASK}')
  returning id;
`);

const addRes = await fetch(`${base}/rest/v1/rpc/fds_asana_factory_comment_add`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${session.access_token}` },
  body: JSON.stringify({ p_link_id: link.id, p_body: MARK }),
});
console.log('add', addRes.status, (await addRes.text()).slice(0, 200));

const [secretRow] = await sql("select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret'");
const workerSecret = secretRow.decrypted_secret;

async function runWorker() {
  const res = await fetch(`${base}/functions/v1/sync-asana-factories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-secret': workerSecret },
    body: JSON.stringify({}),
  });
  return { status: res.status, body: await res.json() };
}

const first = await runWorker();
console.log('worker1', first.status, JSON.stringify(first.body).slice(0, 500));

const state = await sql(`
  select source, asana_gid, pushed_at is not null as pushed, push_error, push_attempts
    from public.fds_asana_factory_comment
   where link_id = '${link.id}' and source = 'fds'
   limit 1;
`);
console.log('comment', JSON.stringify(state[0]));

const second = await runWorker();
console.log('worker2', second.status, JSON.stringify(second.body).slice(0, 300));

const dup = await sql(`
  select count(*)::text as c from public.fds_asana_factory_comment
   where link_id = '${link.id}' and source = 'fds' and asana_gid is not null;
`);
console.log('pushed_rows', JSON.stringify(dup[0]));

await sql(`delete from public.fds_asana_factory_link where id = '${link.id}';`);
console.log('cleaned link', link.id, 'marker', MARK);

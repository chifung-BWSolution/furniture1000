// Temporary: edit/delete round-trip for FDS-origin Asana comments (one authorised test task).
import crypto from 'node:crypto';
import fs from 'node:fs';

const REF = 'omxizeukbcqzsnjsuwod';
const TASK = '1204466337313611';
const FACTORY_ID = crypto.randomUUID();
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
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

const auth = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: anon },
  body: JSON.stringify({ email, password }),
});
const session = await auth.json();
if (!session.access_token) throw new Error('sign-in failed');

async function rpc(name, body) {
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const [link] = await sql(`
  insert into public.fds_asana_factory_link (factory_id, factory_name, asana_task_gid, source)
  values ('${FACTORY_ID}', 'FDS 編輯刪除測試', '${TASK}', 'manual')
  returning id;
`);
const [secretRow] = await sql("select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret'");
const runWorker = async () => {
  const res = await fetch(`${base}/functions/v1/sync-asana-factories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-worker-secret': secretRow.decrypted_secret },
    body: JSON.stringify({}),
  });
  return res.json();
};

try {
  const id = await rpc('fds_asana_factory_comment_add', { p_link_id: link.id, p_body: 'FDS 編輯刪除測試 原始內容' });
  const first = await runWorker();
  console.log('push', JSON.stringify(first.results?.find((r) => r.link_id === link.id)));
  const [before] = await sql(`select asana_gid, body from public.fds_asana_factory_comment where id = '${id}';`);
  console.log('before', JSON.stringify(before));

  await rpc('fds_asana_factory_comment_edit', { p_id: id, p_body: 'FDS 編輯刪除測試 編輯後內容' });
  const second = await runWorker();
  console.log('edit', JSON.stringify(second.results?.find((r) => r.link_id === link.id)));
  const [afterEdit] = await sql(`select asana_gid, body, update_pending from public.fds_asana_factory_comment where id = '${id}';`);
  console.log('after_edit', JSON.stringify(afterEdit));

  await rpc('fds_asana_factory_comment_delete', { p_id: id });
  const third = await runWorker();
  console.log('delete', JSON.stringify(third.results?.find((r) => r.link_id === link.id)));
  const left = await sql(`select count(*)::text as c from public.fds_asana_factory_comment where id = '${id}';`);
  console.log('left', JSON.stringify(left[0]));
} finally {
  await sql(`delete from public.fds_asana_factory_link where id = '${link.id}';`);
  console.log('cleaned', link.id);
}

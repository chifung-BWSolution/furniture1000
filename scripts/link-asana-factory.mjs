#!/usr/bin/env node
/**
 * FDS-12 admin CLI: link one FDS factory to one Asana factory task (read-only sync).
 *
 * There is no admin UI yet, so this is the supported way to create/remove links.
 * It signs in with the develop quick-login account from `.env.local` (never prints it)
 * and calls the existing RPCs; no Asana call and no comment is written here.
 *
 *   node scripts/link-asana-factory.mjs --list
 *   node scripts/link-asana-factory.mjs --factory-id <uuid> --factory-name "向氏 QXS" --task-gid 1214...
 *   node scripts/link-asana-factory.mjs --remove <link uuid>
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function readEnv() {
  const text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const get = (key) => text.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? '';
  return {
    url: get('VITE_SUPABASE_URL'),
    anon: get('VITE_SUPABASE_ANON_KEY'),
    email: get('VITE_QUICK_LOGIN_EMAIL'),
    password: get('VITE_QUICK_LOGIN_PASSWORD'),
  };
}

const args = process.argv.slice(2);
const valueOf = (name) => (args.find((arg) => arg.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const removeIndex = args.indexOf('--remove');
const removeId = removeIndex >= 0 ? args[removeIndex + 1] : '';
const listOnly = args.includes('--list');
const syncNow = args.includes('--sync');

const env = readEnv();
if (!env.url || !env.anon) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing in .env.local');

async function signIn() {
  if (!env.email || !env.password) throw new Error('quick-login credentials missing in .env.local');
  const res = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.anon },
    body: JSON.stringify({ email: env.email, password: env.password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new Error(`sign-in failed (${res.status}): ${body?.msg || body?.error_description || 'unknown'}`);
  }
  return body.access_token;
}

const token = await signIn();
const api = async (fn, body) => {
  const res = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.anon,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

if (listOnly) {
  const rows = await api('fds_asana_factory_link_list');
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('No Asana factory links yet.');
  } else {
    for (const row of rows) {
      console.log(`${row.factory_name}\t${row.factory_id}\t${row.asana_task_gid}\tcomments=${row.comment_count}\t${row.last_synced_at ?? 'never synced'}`);
    }
  }
} else if (removeId) {
  await api('fds_asana_factory_link_remove', { p_id: removeId });
  console.log(`Removed link ${removeId}`);
} else if (valueOf('factory-id') || valueOf('factory-name') || valueOf('task-gid')) {
  const factoryId = valueOf('factory-id');
  const factoryName = valueOf('factory-name');
  const taskGid = valueOf('task-gid');
  if (!factoryId || !factoryName || !taskGid) {
    console.error('Usage: --factory-id <uuid> --factory-name <name> --task-gid <gid> | --list | --remove <link uuid>');
    process.exit(1);
  }
  const id = await api('fds_asana_factory_link_set', {
    p_factory_id: factoryId,
    p_factory_name: factoryName,
    p_task_gid: taskGid,
  });
  console.log(`Linked ${factoryName} → Asana task ${taskGid} (link ${id})`);
}

if (syncNow) {
  const res = await fetch(`${env.url}/functions/v1/sync-asana-factories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.anon,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  let summary = text.slice(0, 600);
  try {
    const parsed = JSON.parse(text);
    summary = JSON.stringify({
      ok: parsed.ok,
      error: parsed.error,
      mode: parsed.mode,
      processed: parsed.processed,
      results: parsed.results?.map((row) => ({ factory: row.factory, status: row.status, comments: row.comments, error: row.error })),
    });
  } catch {
    /* keep raw text */
  }
  console.log(`SYNC ${res.status} ${summary}`);
  if (!res.ok) process.exitCode = 1;
}

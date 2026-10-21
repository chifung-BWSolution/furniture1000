#!/usr/bin/env node
/**
 * One-time / repeatable setup for 上載產品紀錄 daily email (18:00 HKT).
 * Uses Supabase Management API (same PAT as Supabase MCP).
 *
 * Requires:
 *   SUPABASE_ACCESS_TOKEN
 * Test send uses vault secret fds_worker_secret as the x-worker-secret header.
 *
 * Optional env for secrets (will be pushed to Edge Function secrets):
 *   RESEND_API_KEY
 *   UPLOAD_LOG_REPORT_FROM_EMAIL
 *   UPLOAD_LOG_REPORT_TO_EMAIL
 *   GMAIL_SMTP_USER + GMAIL_SMTP_APP_PASSWORD (fallback if no Resend)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'riaubhtruisbwdlwjzur';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_URL = process.env.VITE_SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;

if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is required');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function api(path, options = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  }
  return data;
}

async function runQuery(query) {
  return api('/database/query', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

async function upsertSecrets() {
  const secrets = [];
  const pairs = [
    ['RESEND_API_KEY', process.env.RESEND_API_KEY],
    ['UPLOAD_LOG_REPORT_FROM_EMAIL', process.env.UPLOAD_LOG_REPORT_FROM_EMAIL],
    ['UPLOAD_LOG_REPORT_TO_EMAIL', process.env.UPLOAD_LOG_REPORT_TO_EMAIL],
    ['GMAIL_SMTP_USER', process.env.GMAIL_SMTP_USER],
    ['GMAIL_SMTP_APP_PASSWORD', process.env.GMAIL_SMTP_APP_PASSWORD],
  ];

  for (const [name, value] of pairs) {
    if (value?.trim()) {
      secrets.push({ name, value: value.trim() });
    }
  }

  if (secrets.length === 0) {
    console.log('No optional secrets in env; skipping secret upsert.');
    return;
  }

  console.log(`Upserting secrets: ${secrets.map((s) => s.name).join(', ')}`);
  await api('/secrets', {
    method: 'POST',
    body: JSON.stringify(secrets),
  });
}

function deployFunction() {
  console.log('Deploying send-upload-log-report-email...');
  const result = spawnSync(
    'npx',
    ['supabase', 'functions', 'deploy', 'send-upload-log-report-email', '--project-ref', PROJECT_REF],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    throw new Error('Edge function deploy failed');
  }
}

async function scheduleCron() {
  const cronSql = readFileSync(
    join(root, 'supabase/migrations/20250710_schedule_upload_log_report_email_cron.sql'),
    'utf8',
  );
  console.log('Scheduling cron upload-log-report-daily-email (0 10 * * * = 18:00 HKT)...');
  await runQuery(cronSql);
  const jobs = await runQuery(
    "SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'upload-log-report-daily-email';",
  );
  console.log('Cron job:', JSON.stringify(jobs, null, 2));
}

async function sendTestEmail() {
  const rows = await runQuery(
    "select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1;",
  );
  const list = Array.isArray(rows) ? rows : rows?.result ?? rows?.data ?? [];
  const secret = Array.isArray(list) ? list[0]?.decrypted_secret : '';
  if (typeof secret !== 'string' || !secret) {
    console.log('fds_worker_secret not in vault; skipping test email.');
    return;
  }

  console.log('Sending test email via x-worker-secret ...');
  const res = await fetch(`${PROJECT_URL}/functions/v1/send-upload-log-report-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': secret,
    },
    body: JSON.stringify({ test: true }),
  });
  const payload = await res.json().catch(() => ({}));
  console.log(JSON.stringify(payload, null, 2));
  if (!res.ok || payload.error) {
    throw new Error(payload.error || `Test email failed (${res.status})`);
  }
}

async function main() {
  await upsertSecrets();
  deployFunction();
  await scheduleCron();
  await sendTestEmail();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Set the FDS outbound email sender as a Supabase project secret.
 *
 * Defaults to the FDS 2.0 develop branch only. Production needs an explicit
 * `--ref=prod --allow-prod` because the handover PRD does not authorise changing
 * Production configuration.
 *
 *   node scripts/set-fds-email-sender.mjs
 *   node scripts/set-fds-email-sender.mjs --value "BW Furniture <no-reply@bwteam-furniture.com>"
 *   node scripts/set-fds-email-sender.mjs --ref=prod --allow-prod
 *
 * The address must be on a domain verified by the email provider (Resend).
 * With Gmail SMTP the From header is rewritten to the authenticated Gmail user,
 * so no-reply@bwteam-furniture.com requires RESEND_API_KEY.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROD_REF = 'riaubhtruisbwdlwjzur';
const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_SENDER = 'BW Furniture <no-reply@bwteam-furniture.com>';

const args = process.argv.slice(2);
const refArg = (args.find((a) => a.startsWith('--ref=')) || '').slice('--ref='.length) || 'branch';
const valueArg = (args.find((a) => a.startsWith('--value=')) || '').slice('--value='.length) || DEFAULT_SENDER;
const allowProd = args.includes('--allow-prod');

if (!['branch', 'prod'].includes(refArg)) throw new Error('--ref must be branch or prod');
if (refArg === 'prod' && !allowProd) {
  throw new Error('Refusing to change Production without --allow-prod');
}
const ref = refArg === 'prod' ? PROD_REF : BRANCH_REF;

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error('SUPABASE_ACCESS_TOKEN not found (env or .env.local)');
}

const token = readToken();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

const before = await api('GET');
if (!before.ok) {
  console.error(`Cannot read secrets (${before.status}): ${before.text.slice(0, 300)}`);
  process.exit(1);
}

// Supabase accepts a bare array of {name,value}; fall back to the wrapped form.
let saved = await api('POST', [{ name: 'FDS_EMAIL_FROM', value: valueArg }]);
if (!saved.ok) {
  const fallback = await api('POST', { secrets: [{ name: 'FDS_EMAIL_FROM', value: valueArg }] });
  if (!fallback.ok) {
    console.error(`Failed to set secret (${saved.status}): ${saved.text.slice(0, 300)}`);
    process.exit(1);
  }
  saved = fallback;
}

const after = await api('GET');
let names = [];
try {
  names = (JSON.parse(after.text) || []).map((row) => row.name);
} catch {
  names = [];
}
console.log(`OK ${ref} — FDS_EMAIL_FROM=${valueArg}`);
console.log(`secret present: ${names.includes('FDS_EMAIL_FROM') ? 'yes' : 'unverified'}`);
console.log('Remember: the domain must be verified at the email provider; otherwise Resend rejects the sender.');

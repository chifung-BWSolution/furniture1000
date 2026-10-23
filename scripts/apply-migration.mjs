#!/usr/bin/env node
/**
 * Apply one or more SQL migrations to Supabase via the Management API.
 *
 * Why this exists: `scripts/apply-pending-migrations.ps1` goes through PowerShell 5.1,
 * whose ConvertTo-Json mangles a multi-line SQL string into `{ value: ... }` when the
 * file contains non-ASCII (Chinese comments) — the API then rejects it with
 * `query: Invalid input: expected string, received object`. Node + fetch sends clean UTF-8.
 *
 * Usage:
 *   node scripts/apply-migration.mjs supabase/migrations/20261023110000_fds21_quote_photo_library.sql
 *   node scripts/apply-migration.mjs 20261023110000_fds21_quote_photo_library.sql --refs=branch
 *   node scripts/apply-migration.mjs <file> [<file> ...] [--refs=both|prod|branch] [--dry-run]
 *
 * Token: SUPABASE_ACCESS_TOKEN from env, falling back to `.env.local`.
 * Never prints the token.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROD_REF = 'riaubhtruisbwdlwjzur';
const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const refsArg = (args.find((a) => a.startsWith('--refs=')) || '').slice('--refs='.length) || 'both';
const files = args.filter((a) => !a.startsWith('--'));

const refMap = {
  both: [PROD_REF, BRANCH_REF],
  prod: [PROD_REF],
  branch: [BRANCH_REF],
};
const refs = refMap[refsArg];
if (!refs) throw new Error(`--refs must be one of both|prod|branch (got "${refsArg}")`);
if (files.length === 0) throw new Error('no migration file given');

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error('SUPABASE_ACCESS_TOKEN not found (env or .env.local)');
}

function migrationName(filePath) {
  const base = path.basename(filePath, '.sql');
  const m = base.match(/^\d+_(.+)$/);
  return m ? m[1] : base;
}

async function api(token, ref, sql, name) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/migrations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${ref} HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

async function query(token, ref, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${ref} HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

const token = readToken();
let failed = false;

for (const fileArg of files) {
  const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(ROOT, fileArg);
  if (!fs.existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  const sql = fs.readFileSync(filePath, 'utf8');
  const name = migrationName(filePath);

  for (const ref of refs) {
    const label = `${name} → ${ref}${ref === PROD_REF ? ' (prod)' : ' (branch)'}`;
    if (dryRun) {
      console.log(`[dry-run] ${label} (${sql.length} chars)`);
      continue;
    }
    try {
      const safeName = name.replace(/'/g, "''");
      const before = await query(
        token,
        ref,
        `select count(*)::int as n from supabase_migrations.schema_migrations where name = '${safeName}'`,
      );
      if ((before?.[0]?.n ?? 0) > 0 && !force) {
        console.log(`SKIP ${label} — already applied (pass --force to re-run)`);
        continue;
      }
      await api(token, ref, sql, name);
      const rows = await query(
        token,
        ref,
        `select count(*)::int as n from supabase_migrations.schema_migrations where name = '${safeName}'`,
      );
      const applied = rows?.[0]?.n ?? 0;
      await query(token, ref, "notify pgrst, 'reload schema';");
      console.log(`OK  ${label} — schema_migrations rows=${applied}, pgrst reloaded`);
      if (applied === 0) {
        failed = true;
        console.error(`!!  ${label} — API accepted but no schema_migrations row; check manually`);
      }
    } catch (err) {
      failed = true;
      console.error(`FAIL ${label} — ${err.message}`);
    }
  }
}

process.exit(failed ? 1 : 0);

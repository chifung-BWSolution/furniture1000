#!/usr/bin/env node
/**
 * Deploy the AI usage-logging functions to the slugs the frontend actually
 * invokes (`supabase-functions-<name>` — see CLAUDE.md §0 duplicate-slug trap).
 *
 * The CLI derives the slug from the folder name, so this script copies each
 * function's index.ts into a temporary `supabase-functions-<name>/` folder
 * (sibling of `_shared/`, so `../_shared/*` imports still resolve and get
 * bundled), runs `supabase functions deploy`, then removes the temp folder.
 *
 * Usage: node scripts/deploy-ai-usage-functions.mjs [--refs=both|prod|branch] [--only=name1,name2]
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Supabase CLI as a JS entrypoint — avoids the npx.cmd ENOENT issue on Windows.
const supabaseCli = path.join(path.dirname(require.resolve('supabase/package.json')), 'dist', 'supabase.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(root, 'supabase', 'functions');
const refsArg = process.argv.find((a) => a.startsWith('--refs=')) ?? '--refs=both';
const refs = {
  both: ['riaubhtruisbwdlwjzur', 'omxizeukbcqzsnjsuwod'],
  prod: ['riaubhtruisbwdlwjzur'],
  branch: ['omxizeukbcqzsnjsuwod'],
}[refsArg.slice('--refs='.length)] ?? null;
if (!refs) {
  console.error('Invalid --refs value (use both|prod|branch)');
  process.exit(1);
}
const token = process.env.SUPABASE_ACCESS_TOKEN
  ?? fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN not found (env or .env.local)');
  process.exit(1);
}

// name → files to copy into the temp folder (all of these are single-file functions)
const FUNCTIONS = [
  'gemini-proxy',
  'gemini-excel-catalog',
  'gemini-pdf-catalog',
  'visual-match-images',
  'generate-quote-reference-image',
  'generate-furniture-model',
  'search-by-image',
  'embed-products',
];
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const targets = only ? FUNCTIONS.filter((name) => only.has(name)) : FUNCTIONS;
if (only && targets.length === 0) {
  console.error(`--only matched nothing (known: ${FUNCTIONS.join(', ')})`);
  process.exit(1);
}

let failed = false;
for (const ref of refs) {
  for (const name of targets) {
    const tempSlug = `supabase-functions-${name}`;
    const tempDir = path.join(functionsDir, tempSlug);
    const src = path.join(functionsDir, name, 'index.ts');
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.mkdirSync(tempDir, { recursive: true });
      fs.copyFileSync(src, path.join(tempDir, 'index.ts'));
      console.log(`▶ deploy ${tempSlug} → ${ref}`);
      const out = execFileSync(process.execPath, [
        supabaseCli, 'functions', 'deploy', tempSlug, '--project-ref', ref,
      ], { cwd: root, encoding: 'utf8', env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
      const ok = /Deployed Functions/.test(out);
      console.log(out.trim().split('\n').filter((l) => /Deployed|Error|error/.test(l)).join(' | ') || out.trim().slice(-200));
      if (!ok) { failed = true; console.error(`✗ ${tempSlug} @ ${ref}: unexpected output`); }
    } catch (error) {
      failed = true;
      console.error(`✗ ${tempSlug} @ ${ref}:`, error.message);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

if (failed) { console.error('Some deployments failed.'); process.exit(1); }
console.log('All done.');

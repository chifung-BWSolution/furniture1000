/**
 * Vercel Ignored Build Step.
 *
 * Exit 0: no frontend-related changes since the last successful deployment.
 *         Vercel marks the deployment Canceled and does not run npm ci / Vite.
 * Exit 1: build as usual.
 *
 * The diff is the whole range from VERCEL_GIT_PREVIOUS_SHA to this commit, so a
 * push of several commits still builds when an earlier commit touched the app.
 *
 * Skipped: supabase/ (except the two shared modules the app imports), docs/
 * (except docs/prd, which Vite bundles into the PRD page), tests/, scripts/,
 * and Markdown outside outputs/ and docs/prd.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_SHARED_FILES = [
  'supabase/functions/_shared/quote-site-requirements.ts',
  'supabase/functions/_shared/supplier-compliance.ts',
];

export function isDeployRelevant(file) {
  const rel = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (APP_SHARED_FILES.includes(rel)) return true;
  if (rel.startsWith('supabase/')) return false;
  if (rel.startsWith('docs/prd/')) return true;
  if (rel.startsWith('docs/')) return false;
  if (rel.startsWith('tests/')) return false;
  if (rel.startsWith('scripts/')) return false;
  if (rel.toLowerCase().endsWith('.md') && !rel.startsWith('outputs/')) return false;
  return true;
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function hasCommit(sha) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function changedFiles(previous, head) {
  const out = git([
    'diff',
    '-z',
    '--name-only',
    '--no-renames',
    previous,
    head,
  ]);
  return out.split('\0').map((line) => line.trim()).filter(Boolean);
}

function decide() {
  const previous = (process.env.VERCEL_GIT_PREVIOUS_SHA || '').trim();
  const head = (process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD').trim();
  if (!previous) {
    console.log('build: no previous successful deployment');
    return 1;
  }
  if (!hasCommit(previous)) {
    try {
      git(['fetch', '--deepen=200', 'origin']);
    } catch (error) {
      console.log(`build: cannot fetch history (${error.message})`);
      return 1;
    }
    if (!hasCommit(previous)) {
      console.log('build: previous deployment is outside fetched history');
      return 1;
    }
  }
  const files = changedFiles(previous, head);
  const relevant = files.filter(isDeployRelevant);
  if (relevant.length === 0) {
    console.log(`skip: no frontend changes (${files.length} ignored file(s))`);
    return 0;
  }
  console.log(`build: ${relevant.slice(0, 12).join(', ')}`);
  return 1;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  try {
    process.exit(decide());
  } catch (error) {
    console.log(`build: ignore check failed (${error.message})`);
    process.exit(1);
  }
}

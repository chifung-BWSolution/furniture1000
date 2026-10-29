// Local settings for Codex jobs: optional codex.json next to the Worker, then FDS_* variables.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const localAppData = process.env.LOCALAPPDATA ?? '';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

/** Newest Codex desktop CLI (%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe), or one on PATH. */
export function findCodexExe(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const root = join(localAppData, 'OpenAI', 'Codex', 'bin');
  const candidates = [];
  try {
    for (const name of readdirSync(root)) {
      const exe = join(root, name, 'codex.exe');
      if (existsSync(exe)) candidates.push({ exe, mtime: statSync(exe).mtimeMs });
    }
  } catch {
    // Not installed through the desktop app.
  }
  for (const dir of String(process.env.PATH ?? '').split(';')) {
    const exe = dir && join(dir, 'codex.exe');
    if (exe && existsSync(exe)) candidates.push({ exe, mtime: statSync(exe).mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.exe ?? null;
}

export function loadCodexConfig(workerDir = here) {
  const file = readJson(join(workerDir, 'codex.json'));
  const pick = (env, key, fallback) => process.env[env] ?? file[key] ?? fallback;
  const number = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
  return {
    enabled: String(pick('FDS_CODEX_ENABLED', 'enabled', 'true')) !== 'false',
    codexExe: findCodexExe(pick('FDS_CODEX_EXE', 'codexExe', '')),
    model: pick('FDS_CODEX_MODEL', 'model', ''),
    reasoningEffort: pick('FDS_CODEX_REASONING', 'reasoningEffort', ''),
    workRoot: pick('FDS_SKP_WORK_DIR', 'workRoot', join(localAppData, 'FDS', 'SkpWorker', 'jobs')),
    timeoutMs: number(pick('FDS_CODEX_TIMEOUT_MIN', 'timeoutMinutes', 45), 45) * 60_000,
    bridgePort: number(pick('FDS_SKP_MCP_PORT', 'bridgePort', 9877), 9877),
    retentionDays: number(pick('FDS_SKP_RETENTION_DAYS', 'retentionDays', 14), 14),
    maxReviewRounds: number(pick('FDS_CODEX_REVIEW_ROUNDS', 'maxReviewRounds', 3), 3),
    sessionScript: join(workerDir, 'fds_codex_session.rb'),
    mcpServer: existsSync(join(workerDir, 'codex-mcp.mjs')) ? join(workerDir, 'codex-mcp.mjs') : join(workerDir, 'codex', 'mcp-server.mjs'),
    lockPath: join(localAppData, 'FDS', 'SkpWorker', 'sketchup.lock'),
  };
}

function run(exe, args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, env: { ...process.env, NO_COLOR: '1' } }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: `${stdout ?? ''}\n${stderr ?? ''}`.trim() });
    });
  });
}

let cached = null;

/** CLI version and login state; cached for 5 minutes because each check spawns the CLI. */
export async function codexStatus(config) {
  if (cached && Date.now() - cached.at < 5 * 60_000 && cached.exe === config.codexExe) return cached.value;
  let value = { codex_cli: false, codex_version: null, codex_login: false };
  if (config.codexExe) {
    const version = await run(config.codexExe, ['--version']);
    const login = version.ok ? await run(config.codexExe, ['login', 'status']) : { ok: false, out: '' };
    value = {
      codex_cli: version.ok,
      codex_version: (version.out.match(/\d+\.\d+\.\d+[\w.-]*/) ?? [null])[0],
      codex_login: login.ok && /logged in/i.test(login.out),
    };
  }
  cached = { at: Date.now(), exe: config.codexExe, value };
  return value;
}

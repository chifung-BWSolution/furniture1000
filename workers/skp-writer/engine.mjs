// Which program this Worker uses for generate_skp jobs. The manager writes engine.json;
// the Worker re-reads it on every readiness report.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadEngine(home = join(process.env.LOCALAPPDATA ?? '', 'FDS', 'SkpWorker')) {
  try {
    const raw = JSON.parse(readFileSync(join(home, 'engine.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (raw.engine === 'jzxz' || raw.engine === 'codex') return raw.engine;
  } catch {
    // Missing or unreadable file keeps the previous default.
  }
  return process.env.FDS_SKP_ENGINE === 'jzxz' ? 'jzxz' : 'codex';
}

export function jzxzPaths(workerDir) {
  const dir = process.env.FDS_JZXZ_DIR || 'D:\\jzxz';
  const ui = existsSync(join(workerDir, 'ui.ps1')) ? join(workerDir, 'ui.ps1') : join(workerDir, 'jzxz', 'ui.ps1');
  return {
    dir,
    exe: join(dir, '建筑学长电脑版.exe'),
    ui,
    taskRoot: process.env.FDS_JZXZ_TASK_ROOT || join(process.env.LOCALAPPDATA ?? '', 'FDS', 'SkpWorker', 'jzxz-tasks'),
  };
}

/** Flags sent to FDS. Paths stay on this machine. */
export function jzxzChecks(workerDir) {
  const paths = jzxzPaths(workerDir);
  const installed = existsSync(paths.exe);
  const bridge = existsSync(paths.ui);
  const selected = loadEngine() === 'jzxz';
  return {
    engine: selected ? 'jzxz' : 'codex',
    jzxz_installed: installed,
    jzxz_bridge: bridge,
    jzxz_ready: selected && installed && bridge ? 'true' : 'false',
  };
}

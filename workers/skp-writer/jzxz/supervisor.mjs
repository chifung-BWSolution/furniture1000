// Supervises several 建築學長 modeling tasks at once:
// submit up to MAX_ACTIVE, then each round read result.json / workspace activity, and only when a task
// looks stalled open its conversation to retry or nudge it. UI work waits until the PC is idle.
//   node supervisor.mjs            loop
//   node supervisor.mjs --once     one round
//   node supervisor.mjs --status   print task states
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = (name, fallback) => process.env[name] || fallback;
const num = (name, fallback) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);

const JZXZ_DIR = env('FDS_JZXZ_DIR', 'D:\\jzxz');
const TASK_ROOT = resolve(env('FDS_JZXZ_TASK_ROOT', join(process.env.LOCALAPPDATA ?? '', 'FDS', 'SkpWorker', 'jzxz-tasks')));
const MAX_ACTIVE = num('FDS_JZXZ_MAX_ACTIVE', 2);
const POLL_MS = num('FDS_JZXZ_POLL_SEC', 60) * 1000;
const STALL_MS = num('FDS_JZXZ_STALL_MIN', 8) * 60_000;
const TIMEOUT_MS = num('FDS_JZXZ_TIMEOUT_MIN', 120) * 60_000;
const MAX_RETRIES = num('FDS_JZXZ_MAX_RETRIES', 3);
const IDLE_MS = num('FDS_JZXZ_IDLE_SEC', 60) * 1000;
const INPUT_OFFSET = num('FDS_JZXZ_INPUT_OFFSET', 110);
const LOG_FILE = join(TASK_ROOT, 'supervisor.log');

const prompt = (id) => `執行 FDS 任務 ${id}`;
const nudge = (id) => `繼續完成 FDS 任務 ${id}。完成後必須執行 fds_task.py finish 回報；做不到就用 --status failed 回報原因。`;

function log(message, extra) {
  const line = `${new Date().toISOString()} ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, `${line}\n`); } catch { /* the log is best effort */ }
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function writeJson(path, data) {
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2));
  renameSync(`${path}.tmp`, path);
}

function workspaceRoot() {
  if (process.env.FDS_JZXZ_WORKSPACE) return process.env.FDS_JZXZ_WORKSPACE;
  try {
    const configured = readFileSync(join(JZXZ_DIR, 'Settings', 'UserData', 'Config', 'agent-workspace.path'), 'utf8').replace(/^\uFEFF/, '').trim();
    if (configured && existsSync(configured)) return configured;
  } catch { /* fall back to 建築學長's default */ }
  return join(homedir(), 'Documents', 'jzxz_AIWorkSpace');
}

function newestMtime(path, depth = 3) {
  let newest = 0;
  try {
    const info = statSync(path);
    newest = info.mtimeMs;
    if (info.isDirectory() && depth > 0) {
      for (const name of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, name), depth - 1));
    }
  } catch { /* vanished while scanning */ }
  return newest;
}

/** Latest file activity for a task: its own folder (minus our bookkeeping) and any workspace folder named after it. */
function activityAt(task) {
  let newest = newestMtime(join(task.dir, 'output'));
  const ws = workspaceRoot();
  try {
    for (const name of readdirSync(ws)) {
      if (name.toUpperCase().includes(task.id.toUpperCase())) newest = Math.max(newest, newestMtime(join(ws, name)));
    }
  } catch { /* no workspace yet */ }
  return newest;
}

function ui(command, args = {}) {
  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'ui.ps1'), '-Command', command,
    '-JzxzDir', JZXZ_DIR, '-InputOffset', String(INPUT_OFFSET)];
  if (args.text) argv.push('-Text', args.text);
  if (args.taskId) argv.push('-TaskId', args.taskId);
  return new Promise((done) => {
    execFile('powershell.exe', argv, { windowsHide: true, timeout: 120_000, encoding: 'utf8' }, (error, stdout) => {
      const line = String(stdout ?? '').trim().split(/\r?\n/).pop();
      try { done(JSON.parse(line)); } catch { done({ ok: false, error: error?.message ?? 'no_output' }); }
    });
  });
}

function loadTasks() {
  if (!existsSync(TASK_ROOT)) return [];
  return readdirSync(TASK_ROOT)
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && existsSync(join(TASK_ROOT, id, 'task.json')))
    .map((id) => {
      const dir = join(TASK_ROOT, id);
      const task = readJson(join(dir, 'task.json'));
      if (task?.driver === 'worker') return null;
      const state = readJson(join(dir, 'supervisor.json')) ?? { state: 'queued', queued_at: statSync(join(dir, 'task.json')).mtimeMs };
      return { id, dir, state, result: readJson(join(dir, 'result.json')) };
    })
    .filter(Boolean)
    .sort((a, b) => (a.state.queued_at ?? 0) - (b.state.queued_at ?? 0));
}

function save(task, patch) {
  task.state = { ...task.state, ...patch };
  writeJson(join(task.dir, 'supervisor.json'), task.state);
}

/** result.json is the only completion signal; a late "done" still wins over a supervisor timeout. */
function settle(task) {
  const status = task.result?.status;
  if (!status || task.state.state === status) return;
  save(task, { state: status, finished_at: Date.now() });
  log(`${task.id} ${status}`, status === 'done' ? { skp: task.result.skp_path, issues: task.result.known_issues?.length ?? 0 } : { summary: task.result.summary });
}

async function userIdle() {
  const idle = await ui('idle');
  return idle.ok && idle.idle_ms >= IDLE_MS;
}

async function submit(task) {
  const chat = await ui('new-chat');
  if (!chat.ok) return log(`${task.id} new chat failed`, chat);
  const sent = await ui('send', { text: prompt(task.id) });
  if (!sent.ok) return log(`${task.id} submit failed`, sent);
  const now = Date.now();
  save(task, { state: 'submitted', submitted_at: now, progress_at: now, retries: 0 });
  log(`${task.id} submitted`);
}

async function revive(task) {
  const opened = await ui('open', { taskId: task.id });
  if (!opened.ok) {
    log(`${task.id} cannot open conversation`, opened);
    save(task, { retries: (task.state.retries ?? 0) + 1, progress_at: Date.now() });
    return;
  }
  const chat = await ui('state');
  if (!chat.ok || !chat.task_ids?.includes(task.id)) return log(`${task.id} wrong conversation`, chat);
  if (chat.status === 'running') {
    save(task, { progress_at: Date.now() });
    return log(`${task.id} still running (likely queued for SketchUp)`);
  }
  let action;
  if (chat.status === 'stopped' && chat.can_retry) action = await ui('retry');
  if (!action?.ok) action = await ui('send', { text: chat.status === 'stopped' ? '继续' : nudge(task.id) });
  save(task, { retries: (task.state.retries ?? 0) + 1, progress_at: Date.now() });
  log(`${task.id} ${chat.status} -> ${action.ok ? (action.action ?? 'message') : 'action failed'}`, { retries: task.state.retries });
}

async function round() {
  const tasks = loadTasks();
  for (const task of tasks) settle(task);
  const active = tasks.filter((t) => t.state.state === 'submitted');
  const now = Date.now();

  for (const task of active) {
    const activity = activityAt(task);
    if (activity > (task.state.progress_at ?? 0)) save(task, { progress_at: activity });
  }
  for (const task of active) {
    if (now - task.state.submitted_at > TIMEOUT_MS || (task.state.retries ?? 0) > MAX_RETRIES) {
      save(task, { state: 'failed', finished_at: now, reason: (task.state.retries ?? 0) > MAX_RETRIES ? 'retries_exhausted' : 'timeout' });
      log(`${task.id} failed`, { reason: task.state.reason });
    }
  }

  const stalled = active.filter((t) => t.state.state === 'submitted' && now - t.state.progress_at > STALL_MS);
  const queued = tasks.filter((t) => t.state.state === 'queued' && !t.result);
  const slots = Math.max(0, MAX_ACTIVE - active.filter((t) => t.state.state === 'submitted').length);
  if (!stalled.length && !(queued.length && slots)) return;
  if (!(await userIdle())) return log('PC in use, UI work deferred');

  for (const task of stalled) await revive(task);
  for (const task of queued.slice(0, slots)) await submit(task);
}

function printStatus() {
  const now = Date.now();
  for (const t of loadTasks()) {
    const mins = (ms) => (ms ? `${Math.round((now - ms) / 60_000)}m` : '-');
    console.log([t.id.padEnd(16), (t.result?.status ?? t.state.state).padEnd(10),
      `submitted ${mins(t.state.submitted_at)}`, `progress ${mins(t.state.progress_at)}`, `retries ${t.state.retries ?? 0}`].join('  '));
  }
}

if (process.argv.includes('--status')) {
  printStatus();
} else if (process.argv.includes('--once')) {
  await round();
} else {
  log(`supervisor started`, { TASK_ROOT, MAX_ACTIVE, POLL_MS, STALL_MS, IDLE_MS });
  for (;;) {
    try { await round(); } catch (error) { log('round failed', { error: String(error?.stack ?? error) }); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

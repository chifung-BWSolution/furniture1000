#!/usr/bin/env node
/**
 * Windows SKP worker: claims generate_skp and preview_skp jobs through the
 * device-auth proxy. It does not use a Supabase service role key.
 *
 * Writes with skp_writer.exe (SketchUp C API) when it is built; otherwise drives an installed
 * SketchUp through skp_build.rb (Ruby API), which needs a licensed SketchUp on this machine.
 * The first SketchUp run shows the welcome window: pick any template once, the script then
 * saves an empty seed model and later runs open it directly and need no one at the screen.
 *
 * Env: SUPABASE_URL, FDS_SKP_ANON_KEY, FDS_SKP_DEVICE_ID, FDS_SKP_ACCESS_TOKEN,
 *      FDS_SKP_ACCESS_EXPIRES, FDS_SKP_REFRESH_TOKEN, FDS_SKP_CONFIG,
 *      SKP_WRITER_EXE, SKETCHUP_EXE, FDS_SKP_SEED.
 * Flags: --once  process at most one job, then exit.
 * Exit 2: the device credential was revoked, expired, or rejected. Do not keep retrying.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeSkp } from './codex/artifacts.mjs';
import { codexStatus, loadCodexConfig } from './codex/config.mjs';
import { CODEX_JOB_VERSION, cleanupWorkRoot, resumePendingPublishes, runCodexJob } from './codex/job.mjs';
import { acquireSketchUpLock } from './codex/lock.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CODEX = loadCodexConfig(here);
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = process.env.FDS_SKP_ANON_KEY || '';
const EXE = process.env.SKP_WRITER_EXE || join(here, 'build', 'Release', 'skp_writer.exe');
const SEED =
  process.env.FDS_SKP_SEED ||
  join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'fds-skp-writer', 'seed.skp');
const ONCE = process.argv.includes('--once');
const IDLE_MS = 10_000;
const WRITE_TIMEOUT_MS = 60_000;
const PREVIEW_TIMEOUT_MS = 300_000;
const SKETCHUP_TIMEOUT_MS = 180_000;
const PREVIEW_RUBY = join(here, 'skp_preview.rb');
const SKETCHUP_FIRST_RUN_TIMEOUT_MS = 600_000;
const AUTH_STOP = new Set(['revoked', 'expired', 'suspended', 'unauthorized']);

const creds = {
  deviceId: process.env.FDS_SKP_DEVICE_ID || '',
  access: process.env.FDS_SKP_ACCESS_TOKEN || '',
  accessExpires: process.env.FDS_SKP_ACCESS_EXPIRES || '',
  refresh: process.env.FDS_SKP_REFRESH_TOKEN || '',
  refreshExpires: process.env.FDS_SKP_REFRESH_EXPIRES || '',
  pendingRefresh: process.env.FDS_SKP_PENDING_REFRESH || '',
  pendingRotation: process.env.FDS_SKP_PENDING_ROTATION || '',
};
let activeLease = '';
let authorizationError = null;

function skpFailureRetryable(message) {
  const text = String(message).toLowerCase();
  return !(
    text.includes('skp_empty') ||
    text.includes('model empty') ||
    text.includes('skp_too_large') ||
    text.includes('skp_corrupt') ||
    text.includes('corrupt') ||
    text.includes('open failed')
  );
}

function findSketchUp() {
  if (process.env.SKETCHUP_EXE) return process.env.SKETCHUP_EXE;
  const root = 'C:\\Program Files\\SketchUp';
  if (!existsSync(root)) return null;
  const versions = readdirSync(root)
    .filter((name) => /^SketchUp 20\d\d$/.test(name))
    .sort()
    .reverse();
  for (const version of versions) {
    const exe = join(root, version, 'SketchUp', 'SketchUp.exe');
    if (existsSync(exe)) return exe;
  }
  return null;
}

const SKETCHUP = findSketchUp();
const sdkReady = () => existsSync(EXE) &&
  existsSync(join(dirname(EXE), 'SketchUpAPI.dll')) &&
  existsSync(join(dirname(EXE), 'SketchUpCommonPreferences.dll'));

function allowedUrl(value) {
  const url = new URL(value);
  const local = url.hostname === '127.0.0.1' && url.protocol === 'http:';
  const hosted = url.protocol === 'https:' && url.hostname.endsWith('.supabase.co');
  if (!local && !hosted) throw new Error('invalid_supabase_url');
  return url;
}

if (!URL_ || !ANON || !creds.deviceId || !creds.access || !creds.refresh) {
  console.error('裝置憑證不完整。請在安裝程式使用瀏覽器重新授權。');
  process.exit(1);
}
allowedUrl(URL_);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (text) => String(text ?? '').replace(/[\t\r\n]+/g, ' ').trim();

function authStop(error) {
  if (AUTH_STOP.has(error?.code)) {
    console.error(`授權已停止（${error.code}）。請在安裝程式重新授權。`);
    process.exit(2);
  }
}

async function agent(action, payload = {}, token = creds.access) {
  let last = { status: 0, body: {} };
  for (const slug of ['supabase-functions-skp-worker-agent', 'skp-worker-agent']) {
    const response = await fetch(new URL(`/functions/v1/${slug}`, URL_), {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token || ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    last = { status: response.status, body };
    if (response.status !== 404) break;
  }
  if (last.body?.error) {
    const error = new Error(String(last.body.error));
    error.code = String(last.body.error);
    error.retryAfter = Number(last.body.retry_after_seconds || 0);
    throw error;
  }
  if (last.status >= 400) throw new Error('agent_failed');
  return last.body;
}

function sameHost(target) {
  const url = new URL(target);
  if (url.host !== allowedUrl(URL_).host) throw new Error('forbidden_url');
  return url;
}

async function persistCredentials() {
  const path = process.env.FDS_SKP_CONFIG;
  if (!path) return;
  const payload = JSON.stringify({
    Url: URL_,
    AnonKey: ANON,
    Environment: process.env.FDS_SKP_ENVIRONMENT || '',
    InstallationId: process.env.FDS_SKP_INSTALLATION_ID || '',
    DeviceId: creds.deviceId,
    RefreshToken: creds.refresh,
    AccessToken: creds.access,
    AccessExpiresAt: creds.accessExpires,
    RefreshExpiresAt: creds.refreshExpires,
    PendingRefresh: creds.pendingRefresh,
    PendingRotation: creds.pendingRotation,
    SketchUp: process.env.SKETCHUP_EXE || '',
    AutoStart: process.env.FDS_SKP_AUTOSTART !== '0',
  });
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$json = [Console]::In.ReadToEnd()
$dest = $env:FDS_SKP_CONFIG
$tmp = $dest + '.tmp'
[IO.Directory]::CreateDirectory((Split-Path -Parent $dest)) | Out-Null
$bytes = [Text.Encoding]::UTF8.GetBytes($json)
$prot = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[IO.File]::WriteAllBytes($tmp, $prot)
if ([IO.File]::Exists($dest)) { [IO.File]::Replace($tmp, $dest, [NullString]::Value) } else { [IO.File]::Move($tmp, $dest) }
`;
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, FDS_SKP_CONFIG: path },
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let failed = '';
    child.stderr.on('data', (chunk) => { failed += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('credential_save_failed'))));
    child.stdin.end(payload);
    if (failed) failed = '';
  });
}

async function refreshAccess(force = false) {
  const expires = Date.parse(creds.accessExpires || '');
  const due = force || creds.pendingRefresh || !Number.isFinite(expires) || expires - Date.now() < 120_000;
  if (!due) return;
  if (!creds.pendingRefresh) {
    creds.pendingRefresh = randomBytes(32).toString('hex');
    creds.pendingRotation = randomUUID();
    await persistCredentials();
  }
  const result = await agent('refresh', {
    device_id: creds.deviceId,
    refresh_token: creds.refresh,
    next_refresh_token: creds.pendingRefresh,
    rotation_id: creds.pendingRotation,
  }, ANON);
  creds.refresh = String(result.refresh_token || creds.pendingRefresh);
  creds.access = String(result.access_token || '');
  creds.accessExpires = String(result.access_expires_at || '');
  creds.refreshExpires = String(result.refresh_expires_at || creds.refreshExpires);
  creds.pendingRefresh = '';
  creds.pendingRotation = '';
  await persistCredentials();
  await agent('refresh-ack', { device_id: creds.deviceId, refresh_token: creds.refresh }, ANON).catch(() => undefined);
}

async function callAgent(action, payload) {
  if (authorizationError) throw authorizationError;
  try {
    await refreshAccess();
    return await agent(action, payload);
  } catch (error) {
    if (error?.code === 'unauthorized') {
      await refreshAccess(true);
      return agent(action, payload);
    }
    throw error;
  }
}

function dependencyChecks() {
  return {
    sketchup: !!SKETCHUP && existsSync(SKETCHUP),
    ruby_script: existsSync(join(here, 'skp_build.rb')),
    preview_ruby: existsSync(PREVIEW_RUBY),
    writer: existsSync(EXE),
    api_dll: existsSync(join(dirname(EXE), 'SketchUpAPI.dll')),
    preferences_dll: existsSync(join(dirname(EXE), 'SketchUpCommonPreferences.dll')),
  };
}

/** Codex capability: CLI present and signed in, MCP bridge and session files installed, seed model ready. */
async function codexChecks(base) {
  const status = CODEX.enabled ? await codexStatus(CODEX) : { codex_cli: false, codex_version: null, codex_login: false };
  const checks = {
    ...status,
    codex_enabled: CODEX.enabled,
    mcp_bridge: existsSync(CODEX.mcpServer),
    session_ruby: existsSync(CODEX.sessionScript),
    seed: existsSync(SEED),
  };
  const ready = CODEX.enabled && base.sketchup && checks.codex_cli && checks.codex_login && checks.mcp_bridge && checks.session_ruby && checks.seed;
  return { ...checks, codex_ready: ready ? 'true' : 'false' };
}

/** Serialises every SketchUp run on this machine (parametric, preview and Codex jobs share one lock). */
async function withSketchUpLock(kind, fn) {
  const lock = await acquireSketchUpLock(CODEX.lockPath, { token: randomUUID(), kind }, {
    onWait: async () => {
      if (await pulseLease().catch(() => false)) throw Object.assign(new Error('job_stopped'), { code: 'revoked' });
    },
  });
  try {
    return await fn(lock);
  } finally {
    await lock.release().catch(() => undefined);
  }
}

function boxFaces([w, d, h], [cx, cy, cz]) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2, z0 = cz - h / 2, z1 = cz + h / 2;
  return [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
  ];
}

function writerInput(model) {
  const p = model.parametric;
  const lines = [`name\t${clean(`${p.label ?? model.kind} ${p.width_mm}x${p.depth_mm}x${p.height_mm}`)}`];
  for (const part of p.components ?? []) {
    const faces = part.faces_mm?.length ? part.faces_mm : boxFaces(part.size_mm, part.position_mm);
    const origin = [0, 1, 2].map((axis) => Math.min(...faces.flat().map((pt) => pt[axis])));
    lines.push(['part', clean(part.name || part.id), ...origin].join('\t'));
    // mat\t#rrggbb\topacity\tmaterial — colour and see-through parts (glass, mesh).
    if (/^#[0-9a-f]{6}$/i.test(part.color ?? '')) {
      const opacity = Number.isFinite(part.opacity) ? Math.min(1, Math.max(0.05, part.opacity)) : 1;
      lines.push(['mat', part.color.toLowerCase(), +opacity.toFixed(2), clean(part.material ?? '')].join('\t'));
    }
    const loop = (points) => points.map((pt) => pt.map((n, axis) => +(n - origin[axis]).toFixed(3)).join(',')).join(';');
    faces.forEach((face, index) => {
      lines.push(`face\t${loop(face)}`);
      // hole\t… — inner loop cut out of the face just above (through-holes in a profile).
      for (const hole of part.face_holes_mm?.[index] ?? []) lines.push(`hole\t${loop(hole)}`);
    });
  }
  if (lines.length < 2) throw new Error('model_has_no_parts');
  return `${lines.join('\n')}\n`;
}

async function pulseLease(progress) {
  if (!activeLease) return false;
  const result = await callAgent('heartbeat', { lease_id: activeLease, progress });
  return result.stop === true;
}

function watchChild(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stopping = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(pulse);
      fn(value);
    };
    const stopChild = (error) => {
      if (settled || stopping) return;
      stopping = true;
      // Wait for taskkill before the caller's finally removes SketchUp's files.
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => finish(reject, error));
    };
    const pulse = setInterval(() => {
      pulseLease().then((stop) => {
        if (!stop) return;
        stopChild(Object.assign(new Error('device_revoked'), { code: 'revoked' }));
      }).catch((error) => {
        if (AUTH_STOP.has(error?.code)) {
          stopChild(error);
        }
      });
    }, 15_000);
    const timer = setTimeout(() => {
      stopChild(new Error('SketchUp 寫檔逾時'));
    }, timeoutMs);
    child.on('error', (error) => finish(reject, error));
    child.on('exit', () => { if (!stopping) finish(resolve); });
  });
}

async function runSketchUp(input, output, dir) {
  const errorFile = join(dir, 'error.txt');
  const firstRun = !existsSync(SEED);
  if (firstRun) {
    await mkdir(dirname(SEED), { recursive: true });
    console.log('首次執行：請在 SketchUp 歡迎視窗選一個模板（建議毫米），之後不用再操作。');
  }
  const args = ['-RubyStartup', join(here, 'skp_build.rb'), ...(firstRun ? [] : [SEED])];
  await withSketchUpLock('parametric', async (lock) => {
    const child = spawn(SKETCHUP, args, {
      env: { ...process.env, FDS_SKP_INPUT: input, FDS_SKP_OUTPUT: output, FDS_SKP_ERROR: errorFile, FDS_SKP_SEED: SEED },
      stdio: 'ignore',
    });
    await lock.update({ sketchup_pid: child.pid });
    await watchChild(child, firstRun ? SKETCHUP_FIRST_RUN_TIMEOUT_MS : SKETCHUP_TIMEOUT_MS);
  });
  if (existsSync(errorFile)) throw new Error(clean(await readFile(errorFile, 'utf8')) || 'SketchUp 寫檔失敗');
  if (!existsSync(output)) throw new Error('SketchUp 沒有寫出 SKP');
}

function runWriter(input, output, dir) {
  if (!sdkReady() && SKETCHUP) return runSketchUp(input, output, dir);
  return new Promise((resolve, reject) => {
    execFile(EXE, [input, output], { timeout: WRITE_TIMEOUT_MS, windowsHide: true }, (error, _stdout, stderr) => {
      if (error?.code === 'ENOENT') reject(new Error('SKP 寫檔程式未安裝（skp_writer.exe）'));
      else if (error) reject(new Error(clean(stderr) || error.message));
      else resolve();
    });
  });
}

async function runSketchUpPreview(inputSkp, outputGlb, dir) {
  if (!SKETCHUP || !existsSync(PREVIEW_RUBY)) {
    throw new Error('SketchUp 或 skp_preview.rb 未安裝，無法轉換預覽');
  }
  const errorFile = join(dir, 'error.txt');
  await withSketchUpLock('preview', async (lock) => {
    const child = spawn(SKETCHUP, ['-RubyStartup', PREVIEW_RUBY, ...(existsSync(SEED) ? [SEED] : [])], {
      env: { ...process.env, FDS_SKP_INPUT: inputSkp, FDS_SKP_OUTPUT: outputGlb, FDS_SKP_ERROR: errorFile },
      stdio: 'ignore',
    });
    await lock.update({ sketchup_pid: child.pid });
    await watchChild(child, PREVIEW_TIMEOUT_MS);
  });
  if (existsSync(errorFile)) throw new Error(clean(await readFile(errorFile, 'utf8')) || 'SketchUp 預覽轉換失敗');
  if (!existsSync(outputGlb)) throw new Error('SketchUp 沒有寫出 GLB');
}

async function uploadBytes(leaseId, bytes, contentType) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const prepared = await callAgent('upload', { lease_id: leaseId, content_hash: hash, size_bytes: bytes.length });
  const encoded = String(prepared.path).split('/').map(encodeURIComponent).join('/');
  const target = sameHost(new URL(`/storage/v1/object/upload/sign/product-models/${encoded}?token=${encodeURIComponent(prepared.token)}`, URL_));
  const response = await fetch(target, {
    method: 'PUT',
    headers: { apikey: ANON, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!response.ok) throw new Error('upload_failed');
  await callAgent('complete', {
    lease_id: leaseId,
    content_hash: hash,
    size_bytes: bytes.length,
    storage_path: prepared.path,
  });
  return prepared.path;
}

async function uploadSigned(path, token, bytes, contentType) {
  const encoded = String(path).split('/').map(encodeURIComponent).join('/');
  const target = sameHost(new URL(`/storage/v1/object/upload/sign/product-models/${encoded}?token=${encodeURIComponent(token)}`, URL_));
  const response = await fetch(target, {
    method: 'PUT',
    headers: { apikey: ANON, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!response.ok) throw new Error(`upload_failed_${response.status}`);
}

async function downloadSigned(url) {
  const response = await fetch(sameHost(url), { headers: { apikey: ANON } });
  if (!response.ok) throw new Error(`download_failed_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function processCodexJob(job) {
  activeLease = job.lease_id;
  try {
    const status = await codexStatus(CODEX);
    await runCodexJob(job, {
      callAgent,
      uploadSigned,
      downloadSigned,
      config: CODEX,
      sketchupExe: SKETCHUP,
      seedPath: SEED,
      codexVersion: status.codex_version,
      secrets: [creds.access, creds.refresh, creds.pendingRefresh, process.env.SUPABASE_ACCESS_TOKEN],
    });
  } finally {
    activeLease = '';
    await cleanupWorkRoot(CODEX).catch(() => undefined);
  }
}

async function downloadInput(leaseId, destination) {
  const result = await callAgent('input', { lease_id: leaseId });
  const response = await fetch(sameHost(result.url), { headers: { apikey: ANON } });
  if (!response.ok) throw new Error('skp_download_failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('skp_empty');
  if (bytes.length > 100 * 1024 * 1024) throw new Error('skp_too_large');
  if (!looksLikeSkp(bytes)) throw new Error('skp_corrupt');
  await writeFile(destination, bytes);
}

async function processPreviewJob(job) {
  const dir = await mkdtemp(join(tmpdir(), 'fds-skp-preview-'));
  activeLease = job.lease_id;
  try {
    const input = join(dir, 'source.skp');
    const output = join(dir, 'preview.glb');
    await downloadInput(job.lease_id, input);
    await callAgent('heartbeat', { lease_id: job.lease_id, progress: 0.2 });
    await runSketchUpPreview(input, output, dir);
    await callAgent('heartbeat', { lease_id: job.lease_id, progress: 0.75 });
    const bytes = await readFile(output);
    if (bytes.length === 0) throw new Error('glb_empty');
    const path = await uploadBytes(job.lease_id, bytes, 'model/gltf-binary');
    console.log(`preview job ${job.id}: ${path} (${bytes.length} bytes)`);
  } finally {
    try { await rm(dir, { recursive: true, force: true }); }
    finally { activeLease = ''; }
  }
}

async function processGenerateJob(job) {
  const model = job.input;
  if (!model?.id || !model.parametric) throw new Error('model_not_found');
  const dir = await mkdtemp(join(tmpdir(), 'fds-skp-'));
  activeLease = job.lease_id;
  try {
    const input = join(dir, 'input.txt');
    const output = join(dir, 'model.skp');
    await writeFile(input, writerInput(model), 'utf8');
    await runWriter(input, output, dir);
    await callAgent('heartbeat', { lease_id: job.lease_id, progress: 0.7 });
    const bytes = await readFile(output);
    if (bytes.length === 0) throw new Error('skp_empty');
    const path = await uploadBytes(job.lease_id, bytes, 'application/octet-stream');
    console.log(`job ${job.id}: ${path} (${bytes.length} bytes)`);
  } finally {
    try { await rm(dir, { recursive: true, force: true }); }
    finally { activeLease = ''; }
  }
}

async function reportReadiness() {
  const checks = dependencyChecks();
  const canGenerate = (checks.writer && checks.api_dll && checks.preferences_dll) || (checks.sketchup && checks.ruby_script);
  const canPreview = checks.sketchup && checks.preview_ruby;
  const codex = await codexChecks(checks);
  const capabilities = [
    ...(canGenerate ? ['parametric'] : []),
    ...(canPreview ? ['preview'] : []),
    ...(codex.codex_ready === 'true' ? ['codex_v1'] : []),
  ];
  const ready = canGenerate || canPreview || codex.codex_ready === 'true';
  await callAgent('ready', { ready, checks: { ...checks, ...codex, capabilities }, version: `device-auth-3+${CODEX_JOB_VERSION}` });
  return ready;
}

async function tick() {
  if (!await reportReadiness()) return false;
  const claimed = await callAgent('claim');
  const job = claimed.job;
  if (!job) return false;
  try {
    if (job.job_type === 'preview_skp') await processPreviewJob(job);
    else if (job.job_type === 'generate_skp' && job.mode === 'codex_v1') await processCodexJob(job);
    else if (job.job_type === 'generate_skp') await processGenerateJob(job);
    else throw new Error('forbidden');
  } catch (err) {
    authStop(err);
    const message = err instanceof Error ? err.message : String(err);
    if (err?.code === 'revoked' || err?.kind === 'cancelled') return false;
    console.error(`job ${job.id} failed: ${message}`);
    await callAgent('fail', {
      lease_id: job.lease_id,
      error: message,
      retryable: typeof err?.retryable === 'boolean' ? err.retryable : skpFailureRetryable(message),
    }).catch((error) => authStop(error));
  }
  return true;
}

try {
  await refreshAccess();
} catch (err) {
  authStop(err);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
await resumePendingPublishes(CODEX, callAgent).catch((err) => console.error(err instanceof Error ? err.message : err));
await cleanupWorkRoot(CODEX).catch(() => undefined);

const readinessTimer = setInterval(() => reportReadiness().catch((err) => {
  if (!AUTH_STOP.has(err?.code)) return;
  authorizationError = err;
  // Active jobs must unwind through watchChild and their cleanup first.
  if (!activeLease) authStop(err);
}), 30_000);
readinessTimer.unref();

for (;;) {
  let worked = false;
  try {
    worked = await tick();
  } catch (err) {
    authStop(err);
    console.error(err instanceof Error ? err.message : err);
  }
  if (ONCE) break;
  if (!worked) await sleep(IDLE_MS);
}

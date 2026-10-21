#!/usr/bin/env node
/**
 * Windows SKP worker: claims generate_skp and preview_skp jobs. Writes SKP or exports GLB
 * previews from uploaded SKP via SketchUp (skp_preview.rb).
 * product-models bucket and closes the job.
 *
 * Writes with skp_writer.exe (SketchUp C API) when it is built; otherwise drives an installed
 * SketchUp through skp_build.rb (Ruby API), which needs a licensed SketchUp on this machine.
 * The first SketchUp run shows the welcome window: pick any template once, the script then
 * saves an empty seed model and later runs open it directly and need no one at the screen.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *      SKP_WRITER_EXE (default ./build/Release/skp_writer.exe next to this file),
 *      SKETCHUP_EXE (default: newest C:\Program Files\SketchUp\SketchUp 20xx),
 *      FDS_SKP_SEED (default %LOCALAPPDATA%\fds-skp-writer\seed.skp).
 * Flags: --once  process at most one job, then exit.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXE = process.env.SKP_WRITER_EXE || join(here, 'build', 'Release', 'skp_writer.exe');
const SEED =
  process.env.FDS_SKP_SEED ||
  join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'fds-skp-writer', 'seed.skp');
const ONCE = process.argv.includes('--once');
const WORKER = `skp-windows-${hostname()}`;
const IDLE_MS = 10_000;
const WRITE_TIMEOUT_MS = 60_000;
const PREVIEW_TIMEOUT_MS = 300_000;
const SKETCHUP_TIMEOUT_MS = 180_000;
const PREVIEW_RUBY = join(here, 'skp_preview.rb');
/** The first run waits for someone to pick a template in the welcome window. */
const SKETCHUP_FIRST_RUN_TIMEOUT_MS = 600_000;

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

if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (text) => String(text ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/** Rows saved before faces_mm existed are plain boxes. */
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

/** Each part becomes a component whose origin is its minimum corner; faces are sent relative to it. */
function writerInput(model) {
  const p = model.parametric;
  const lines = [`name\t${clean(`${p.label ?? model.kind} ${p.width_mm}x${p.depth_mm}x${p.height_mm}`)}`];
  for (const part of p.components ?? []) {
    const faces = part.faces_mm?.length ? part.faces_mm : boxFaces(part.size_mm, part.position_mm);
    const origin = [0, 1, 2].map((axis) => Math.min(...faces.flat().map((pt) => pt[axis])));
    lines.push(['part', clean(part.name || part.id), ...origin].join('\t'));
    for (const face of faces) {
      lines.push(`face\t${face.map((pt) => pt.map((n, axis) => +(n - origin[axis]).toFixed(3)).join(',')).join(';')}`);
    }
  }
  if (lines.length < 2) throw new Error('model_has_no_parts');
  return `${lines.join('\n')}\n`;
}

/** SketchUp quits by itself when skp_build.rb is done; a hung window is killed with its helpers. */
async function runSketchUp(input, output, dir) {
  const errorFile = join(dir, 'error.txt');
  const firstRun = !existsSync(SEED);
  if (firstRun) {
    await mkdir(dirname(SEED), { recursive: true });
    console.log('首次執行：請在 SketchUp 歡迎視窗選一個模板（建議毫米），之後不用再操作。');
  }
  const args = ['-RubyStartup', join(here, 'skp_build.rb'), ...(firstRun ? [] : [SEED])];
  await new Promise((resolve, reject) => {
    const child = spawn(SKETCHUP, args, {
      env: { ...process.env, FDS_SKP_INPUT: input, FDS_SKP_OUTPUT: output, FDS_SKP_ERROR: errorFile, FDS_SKP_SEED: SEED },
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined);
      reject(new Error('SketchUp 寫檔逾時'));
    }, firstRun ? SKETCHUP_FIRST_RUN_TIMEOUT_MS : SKETCHUP_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
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

/** Open an existing SKP in SketchUp and export GLB (T-807). */
async function runSketchUpPreview(inputSkp, outputGlb, dir) {
  if (!SKETCHUP || !existsSync(PREVIEW_RUBY)) {
    throw new Error('SketchUp 或 skp_preview.rb 未安裝，無法轉換預覽');
  }
  const errorFile = join(dir, 'error.txt');
  await new Promise((resolve, reject) => {
    const child = spawn(SKETCHUP, ['-RubyStartup', PREVIEW_RUBY, ...(existsSync(SEED) ? [SEED] : [])], {
      env: {
        ...process.env,
        FDS_SKP_INPUT: inputSkp,
        FDS_SKP_OUTPUT: outputGlb,
        FDS_SKP_ERROR: errorFile,
      },
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined);
      reject(new Error('SketchUp 預覽轉換逾時'));
    }, PREVIEW_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (existsSync(errorFile)) {
    throw new Error(clean(await readFile(errorFile, 'utf8')) || 'SketchUp 預覽轉換失敗');
  }
  if (!existsSync(outputGlb)) throw new Error('SketchUp 沒有寫出 GLB');
}

async function processPreviewJob(job) {
  const productModelId = job.payload?.product_model_id;
  const storagePath = job.payload?.storage_path;
  if (!productModelId || !storagePath) {
    await db.rpc('fds_skp_preview_job_fail', {
      p_job_id: job.id,
      p_error: 'invalid_payload',
      p_retryable: false,
    });
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), 'fds-skp-preview-'));
  try {
    const { data: blob, error: dlErr } = await db.storage.from('product-models').download(storagePath);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? 'skp_download_failed');
    const skpBytes = Buffer.from(await blob.arrayBuffer());
    if (skpBytes.length === 0) throw new Error('skp_empty');
    if (skpBytes.length > 100 * 1024 * 1024) throw new Error('skp_too_large');

    const input = join(dir, 'source.skp');
    const output = join(dir, 'preview.glb');
    await writeFile(input, skpBytes);
    await db.rpc('fds_processing_job_heartbeat', { p_job_id: job.id, p_progress: 0.2 });
    await runSketchUpPreview(input, output, dir);
    await db.rpc('fds_processing_job_heartbeat', { p_job_id: job.id, p_progress: 0.75 });

    const bytes = await readFile(output);
    if (bytes.length === 0) throw new Error('glb_empty');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const path = `preview/${productModelId}/${hash}.glb`;
    const upload = await db.storage.from('product-models').upload(path, bytes, {
      contentType: 'model/gltf-binary',
      upsert: true,
    });
    if (upload.error) throw upload.error;

    const finish = await db.rpc('fds_skp_preview_job_finish', {
      p_job_id: job.id,
      p_storage_path: path,
      p_size_bytes: bytes.length,
      p_content_hash: job.payload?.content_hash ?? hash,
    });
    if (finish.error) throw finish.error;
    console.log(`preview job ${job.id}: ${path} (${bytes.length} bytes)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function processGenerateJob(job) {
  const modelId = job.payload?.furniture_model_id;
  const { data: model, error } = await db
    .from('furniture_models')
    .select('id, kind, parametric')
    .eq('id', modelId)
    .maybeSingle();
  if (error) throw error;
  if (!model) {
    await db.rpc('fds_processing_job_fail', { p_job_id: job.id, p_error: 'model_not_found', p_retryable: false });
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), 'fds-skp-'));
  try {
    const input = join(dir, 'input.txt');
    const output = join(dir, 'model.skp');
    await writeFile(input, writerInput(model), 'utf8');
    await runWriter(input, output, dir);
    await db.rpc('fds_processing_job_heartbeat', { p_job_id: job.id, p_progress: 0.7 });

    const bytes = await readFile(output);
    if (bytes.length === 0) throw new Error('skp_empty');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const path = `generated/${model.id}/${hash}.skp`;
    const upload = await db.storage.from('product-models').upload(path, bytes, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
    if (upload.error) throw upload.error;

    const fileName = `${model.kind}-${model.parametric.width_mm}x${model.parametric.depth_mm}x${model.parametric.height_mm}.skp`;
    const finish = await db.rpc('fds_skp_job_finish', {
      p_job_id: job.id,
      p_storage_path: path,
      p_size_bytes: bytes.length,
      p_content_hash: hash,
      p_file_name: fileName,
    });
    if (finish.error) throw finish.error;
    console.log(`job ${job.id}: ${path} (${bytes.length} bytes)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function reportReadiness() {
  const checks = {
    sketchup: !!SKETCHUP && existsSync(SKETCHUP),
    ruby_script: existsSync(join(here, 'skp_build.rb')),
    preview_ruby: existsSync(PREVIEW_RUBY),
    writer: existsSync(EXE),
    api_dll: existsSync(join(dirname(EXE), 'SketchUpAPI.dll')),
    preferences_dll: existsSync(join(dirname(EXE), 'SketchUpCommonPreferences.dll')),
  };
  const canGenerate = (checks.writer && checks.api_dll && checks.preferences_dll) ||
    (checks.sketchup && checks.ruby_script);
  const canPreview = checks.sketchup && checks.preview_ruby;
  const ready = canGenerate || canPreview;
  let { error } = await db.from('fds_skp_workers').upsert({ worker_id: WORKER, ready, checks, checked_at: new Date().toISOString() });
  // Older deployments still accept the original heartbeat until the migration is applied.
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    ({ error } = await db.from('fds_skp_workers').upsert({ worker_id: WORKER, ready, checked_at: new Date().toISOString() }));
  }
  if (error) throw error;
  return ready;
}
const readinessTimer = setInterval(() => reportReadiness().catch(console.error), 30000);
readinessTimer.unref();

async function tick() {
  if (!await reportReadiness()) return false;
  const { data, error } = await db.rpc('fds_processing_jobs_claim', {
    p_job_types: ['generate_skp', 'preview_skp'],
    p_limit: 1,
    p_worker: WORKER,
    p_max_running: 1,
  });
  if (error) throw error;
  const job = data?.[0];
  if (!job) return false;
  try {
    if (job.job_type === 'preview_skp') await processPreviewJob(job);
    else await processGenerateJob(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`job ${job.id} failed: ${message}`);
    if (job.job_type === 'preview_skp') {
      await db.rpc('fds_skp_preview_job_fail', { p_job_id: job.id, p_error: message, p_retryable: true });
    } else {
      await db.rpc('fds_processing_job_fail', { p_job_id: job.id, p_error: message, p_retryable: true });
    }
  }
  return true;
}

for (;;) {
  let worked = false;
  try {
    worked = await tick();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
  }
  if (ONCE) break;
  if (!worked) await sleep(IDLE_MS);
}


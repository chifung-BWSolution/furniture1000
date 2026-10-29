// One codex_v1 generate_skp job: references → dedicated SketchUp → Codex via MCP → fixed export →
// validation → per-artifact upload with hash read-back → one atomic publish.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createZip, inspectFbx, inspectGlb, inspectPng, looksLikeSkp, readZip, sha256 } from './artifacts.mjs';
import { assertIdentity, bridgeCall, pickPort } from './bridge.mjs';
import { codexEnv, assertNoSecrets, bridgeEnv } from './env.mjs';
import { downloadReferences } from './images.mjs';
import { acquireSketchUpLock, killTree, pidAlive } from './lock.mjs';
import { buildPrompt } from './prompt.mjs';

export const CODEX_JOB_VERSION = 'codex-1';
const STOP_CODES = new Set(['stopped', 'lease_rejected', 'revoked', 'expired', 'suspended', 'unauthorized']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class JobError extends Error {
  constructor(kind, detail, { retryable } = {}) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
    this.retryable = retryable ?? !['setup', 'input', 'cancelled'].includes(kind);
  }
}

const CONTENT_TYPES = {
  skp: 'application/octet-stream',
  fbx: 'application/octet-stream',
  fbx_bundle: 'application/zip',
  glb: 'model/gltf-binary',
  preview: 'image/png',
  validation: 'application/json',
  report: 'application/json',
  manifest: 'application/json',
};

async function listFiles(root, dir = root) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(root, full));
    else out.push({ full, name: relative(root, full).replaceAll('\\', '/') });
  }
  return out;
}

function within(value, expected, abs, rel) {
  return Math.abs(value - expected) <= Math.max(abs, Math.abs(expected) * rel);
}

/** Pure checks over measured outputs; exported for tests. */
export function validateOutputs({ snapshot, exportInfo, glb, fbx, png, skpBytes, report }) {
  const checks = [];
  const add = (name, ok, detail, severity = 'error') => checks.push({ name, ok: !!ok, severity, detail });
  const catalog = snapshot.catalog_dimensions_mm ?? {};
  const [width, depth, height] = exportInfo.bounds_mm.size;
  const actual = { width, depth, height };
  const min = exportInfo.bounds_mm.min;
  const max = exportInfo.bounds_mm.max;

  add('skp_signature', looksLikeSkp(skpBytes), `${skpBytes.length} bytes`);
  add('skp_size', skpBytes.length > 0 && skpBytes.length <= 100 * 1024 * 1024, `${skpBytes.length} bytes`);
  add('fbx_structure', !!fbx, fbx ? `${fbx.encoding} ${fbx.version ?? ''}`.trim() : 'missing');
  add('glb_structure', glb.meshes > 0, `${glb.meshes} meshes, ${glb.primitives} primitives`);
  add('glb_self_contained', glb.external.length === 0, glb.external.length ? glb.external.join(', ') : 'no external uris');
  add('preview_image', png.width >= 800 && png.height >= 600, `${png.width}x${png.height}`);
  add('editable_parts', exportInfo.top_level_groups > 0, `${exportInfo.top_level_groups} top-level groups/components`);
  add('loose_geometry', exportInfo.loose_geometry === 0, `${exportInfo.loose_geometry} loose faces/edges at top level`, 'warning');
  add('floor_at_zero', Math.abs(min[2]) <= 1, `min z = ${min[2]} mm`);
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  add('centered', within(cx, 0, 5, 0.01) && within(cy, 0, 5, 0.01), `center = (${cx.toFixed(1)}, ${cy.toFixed(1)}) mm`, 'warning');
  add('materials', exportInfo.materials > 0, `${exportInfo.materials} materials, ${exportInfo.textured_materials} textured`, 'warning');

  const dimensions = {};
  for (const axis of ['width', 'depth', 'height']) {
    const expected = Number(catalog[axis]);
    if (expected > 0) {
      const ok = within(actual[axis], expected, 5, 0.01);
      dimensions[axis] = { source: 'catalog', expected_mm: expected, actual_mm: actual[axis], tolerance: '±max(5 mm, 1%)', ok };
      add(`dimension_${axis}`, ok, `${actual[axis]} mm vs catalog ${expected} mm`);
    } else {
      dimensions[axis] = {
        source: report?.dimension_source?.[axis] === 'image' ? 'image' : 'estimated',
        actual_mm: actual[axis],
        reported_mm: Number(report?.dimensions_mm?.[axis]) || null,
        ok: actual[axis] > 0,
      };
      add(`dimension_${axis}`, actual[axis] > 0, `${actual[axis]} mm (estimated, no catalog value)`);
    }
  }

  // SketchUp's glTF export is +Y up in metres: X = width, Y = height, Z = depth.
  const g = glb.bounds.size.map((v) => v * 1000);
  const glbOk = within(g[0], width, 2, 0.005) && within(g[1], height, 2, 0.005) && within(g[2], depth, 2, 0.005);
  add('glb_matches_skp', glbOk, `GLB ${g.map((v) => v.toFixed(1)).join(' x ')} mm (X width, Y height, Z depth)`);
  add('glb_floor', within(glb.bounds.min[1] * 1000, min[2], 2, 0.005), `GLB min y = ${(glb.bounds.min[1] * 1000).toFixed(1)} mm`);

  const failed = checks.filter((c) => !c.ok && c.severity === 'error');
  return {
    ok: failed.length === 0,
    failed: failed.map((c) => c.name),
    axis_mapping: { width: '+X', depth: '+Y (front faces -Y)', height: '+Z', floor: 'z = 0', glb: 'Y-up metres', fbx: 'swap_yz, mm' },
    catalog_dimensions_mm: catalog,
    model_bounds_mm: exportInfo.bounds_mm,
    glb_bounds_m: glb.bounds,
    dimensions,
    estimated_fields: report?.estimated_fields ?? [],
    conflicts: report?.conflicts ?? [],
    checks,
  };
}

export async function runCodexJob(job, deps) {
  const { callAgent, uploadSigned, downloadSigned, config, sketchupExe, seedPath, codexVersion, secrets = [], log = console.log } = deps;
  const input = job.input ?? {};
  const leaseId = job.lease_id;
  const dir = deps.resumeDir ?? deps.revisionDir ?? join(config.workRoot, `${job.id}-a${job.attempt}`);
  const paths = {
    refs: join(dir, 'references'),
    outputs: join(dir, 'outputs'),
    fbxDir: join(dir, 'outputs', 'fbx'),
    logs: join(dir, 'logs'),
    screens: join(dir, 'screens'),
  };
  for (const p of Object.values(paths)) await mkdir(p, { recursive: true });
  const stopper = new AbortController();
  let stopError = null;
  let progress = 0;
  let pulse = null;
  let sketchup = null;
  let lock = null;
  const stamp = async (name, data) => writeFile(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));

  const stop = (error) => {
    if (stopError) return;
    stopError = error;
    stopper.abort(error);
  };
  const guard = () => {
    if (stopError) throw stopError;
  };
  const heartbeat = async (payload) => {
    try {
      const result = await callAgent('heartbeat', { lease_id: leaseId, progress, ...payload });
      if (result?.stop) stop(new JobError('cancelled', '任務已取消或租約失效'));
    } catch (error) {
      if (STOP_CODES.has(error?.code)) stop(Object.assign(new JobError('cancelled', `任務已停止（${error.code}）`), { code: error.code }));
      else log(`heartbeat failed: ${error?.message ?? error}`);
    }
    guard();
  };
  const stage = (name, value, detail) => {
    progress = value;
    log(`job ${job.id} stage ${name}${detail ? `: ${detail}` : ''}`);
    return heartbeat({ stage: name, detail: detail ?? null });
  };

  const closeSketchUp = async () => {
    if (!sketchup) return;
    const child = sketchup;
    sketchup = null;
    if (pidAlive(child.child.pid)) {
      await bridgeCall(child.port, 'quit', {}, { timeoutMs: 10_000 }).catch(() => {});
      for (let i = 0; i < 60 && pidAlive(child.child.pid); i++) await sleep(1_000);
      // Only the dedicated instance started for this job; never the user's SketchUp.
      if (pidAlive(child.child.pid)) await killTree(child.child.pid);
    }
  };

  try {
    pulse = setInterval(() => heartbeat({}).catch(() => {}), 15_000);
    await stamp('product.json', input);

    const checkpointPath = join(dir, 'checkpoint.json');
    let generated;
    if (deps.resumeDir) {
      generated = JSON.parse(await readFile(checkpointPath, 'utf8'));
      for (const item of generated.files) {
        const bytes = await readFile(join(dir, item.path));
        if (sha256(bytes) !== item.hash) throw new JobError('validation', 'checkpoint_hash_mismatch');
      }
    } else {
      generated = await (async () => {
    await stage('download', 0.05, `下載 ${(input.references ?? []).length} 張參考圖`);
    const refs = await downloadReferences(input.references ?? [], paths.refs);
    await stamp('references.json', refs);
    for (const failure of refs.failed) {
      let host = 'invalid-url';
      try { host = new URL(failure.url).hostname; } catch {}
      log(`job ${job.id} [${failure.error}] reference download failed: ${host}`);
    }
    if (!refs.saved.length) {
      const codes = [...new Set(refs.failed.map((f) => f.error))].join(', ');
      throw new JobError('input', `參考圖片下載失敗 [${codes || 'reference_empty'}]；詳見 references.json。${codes.includes('reference_host_private') ? '請檢查代理 Fake-IP／DNS 設定。' : ''}`);
    }
    guard();

    await stage('wait_sketchup', 0.1);
    if (!sketchupExe || !existsSync(sketchupExe)) throw new JobError('setup', '找不到 SketchUp');
    if (!existsSync(seedPath)) throw new JobError('setup', 'SketchUp 尚未完成首次設定（缺少 seed.skp），請先讓 Worker 生成一次 SKP 或在 SketchUp 選擇模板');
    if (!existsSync(config.sessionScript) || !existsSync(config.mcpServer)) throw new JobError('setup', 'Worker 安裝不完整（缺少 Codex session 或 MCP 檔案）');
    let lastWaitReport = 0;
    lock = await acquireSketchUpLock(config.lockPath, { token: randomUUID(), job_id: job.id, kind: 'codex' }, {
      onWait: async (holder) => {
        if (Date.now() - lastWaitReport < 15_000) return guard();
        lastWaitReport = Date.now();
        await heartbeat({ stage: 'wait_sketchup', detail: `等待本機另一個 SketchUp 任務完成（${holder?.kind ?? '未知'}）` });
      },
    });

    const port = await pickPort(config.bridgePort);
    const nonce = randomUUID();
    const working = join(dir, 'working.skp');
    await copyFile(deps.revisionSeed ?? seedPath, working);
    const ready = join(dir, 'session-ready.json');
    const failed = join(dir, 'session-error.json');
    await rm(ready, { force: true });
    await rm(failed, { force: true });
    const sessionEnv = codexEnv(process.env, {
      FDS_CODEX_JOB_ID: job.id,
      FDS_CODEX_NONCE: nonce,
      FDS_CODEX_PORT: String(port),
      FDS_CODEX_READY_FILE: ready,
      FDS_CODEX_ERROR_FILE: failed,
      FDS_CODEX_SCREEN_DIR: paths.screens,
      FDS_CODEX_OUTPUT_DIR: paths.outputs,
    });
    assertNoSecrets(sessionEnv, secrets);
    const child = spawn(sketchupExe, ['-RubyStartup', config.sessionScript, working], { env: sessionEnv, stdio: 'ignore', windowsHide: false });
    sketchup = { child, port };
    await lock.update({ sketchup_pid: child.pid, port });
    const startedAt = Date.now();
    while (!existsSync(ready)) {
      guard();
      if (existsSync(failed)) throw new JobError('setup', `SketchUp 啟動失敗：${await readFile(failed, 'utf8')}`);
      if (child.exitCode !== null) throw new JobError('setup', `SketchUp 啟動後立即結束（${child.exitCode}），請確認授權有效`);
      if (Date.now() - startedAt > 240_000) throw new JobError('setup', 'SketchUp 啟動逾時（可能停在授權或歡迎視窗）');
      await sleep(1_000);
    }
    const identity = await assertIdentity(port, job.id, nonce, { timeoutMs: 20_000 });
    await stamp('session.json', identity);

    await stage('codex', 0.2, 'Codex 建模中');
    const reportPath = join(paths.outputs, 'report.json');
    let prompt = buildPrompt({ snapshot: input, references: refs.saved, reportPath, maxReviewRounds: config.maxReviewRounds });
    if (deps.feedback) prompt += `
## 人工修正要求
目前場景已有上版模型。先讀取場景，在現有模型上修改，保留未要求變更的部件；不要重建或重複加入整件產品。本次原始「場景應為空」要求不適用。
使用者要求：${JSON.stringify(deps.feedback)}
修改後重新檢查四個視角並寫出新的完整報告。`;
    await stamp('prompt.md', prompt);
    const toolLog = join(paths.logs, 'mcp-tools.jsonl');
    const mcpEnv = bridgeEnv({ port, jobId: job.id, nonce, screenDir: paths.screens, toolLog });
    const toml = (value) => JSON.stringify(value);
    const args = [
      'exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral',
      '-C', dir, '-s', 'workspace-write',
      '-c', 'approval_policy="never"',
      '-c', `mcp_servers.fds-sketchup.command=${toml(process.execPath)}`,
      '-c', `mcp_servers.fds-sketchup.args=[${toml(config.mcpServer)}]`,
      '-c', `mcp_servers.fds-sketchup.env={${Object.entries(mcpEnv).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`,
      '-c', 'mcp_servers.fds-sketchup.default_tools_approval_mode="approve"',
      '-c', 'mcp_servers.fds-sketchup.startup_timeout_sec=30',
      '-c', 'mcp_servers.fds-sketchup.tool_timeout_sec=180',
      ...(config.model ? ['-m', config.model] : []),
      ...(config.reasoningEffort ? ['-c', `model_reasoning_effort=${toml(config.reasoningEffort)}`] : []),
      ...refs.saved.flatMap((r) => ['-i', r.path]),
      '--json', '-o', join(paths.logs, 'codex-last-message.md'),
      '-',
    ];
    const env = codexEnv(process.env);
    assertNoSecrets(env, secrets);
    assertNoSecrets(mcpEnv, secrets);
    const codex = spawn(config.codexExe, args, { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const events = createWriteStream(join(paths.logs, 'codex-events.jsonl'));
    const errors = createWriteStream(join(paths.logs, 'codex-stderr.log'));
    let toolCalls = 0;
    let lastDetail = 0;
    let buffered = '';
    codex.stdout.on('data', (chunk) => {
      events.write(chunk);
      buffered += chunk.toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (line.includes('"item.completed"') && line.includes('"mcp_tool_call"')) toolCalls += 1;
      }
      if (Date.now() - lastDetail > 20_000) {
        lastDetail = Date.now();
        heartbeat({ stage: 'codex', detail: `Codex 建模中（已執行 ${toolCalls} 次 SketchUp 操作）` }).catch(() => {});
      }
    });
    codex.stderr.pipe(errors);
    codex.stdin.end(prompt);
    const lastMessage = join(paths.logs, 'codex-last-message.md');
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop(new JobError('modeling', `Codex 超過 ${Math.round(config.timeoutMs / 60_000)} 分鐘未完成`)), config.timeoutMs);
      let finishedAt = 0;
      let lingered = false;
      // The CLI can stay alive after its final message; give it a grace period, then close it.
      const linger = setInterval(() => {
        if (!finishedAt && existsSync(lastMessage) && existsSync(reportPath)) finishedAt = Date.now();
        if (finishedAt && Date.now() - finishedAt > 60_000 && !lingered) {
          lingered = true;
          killTree(codex.pid);
        }
      }, 5_000);
      const onAbort = () => killTree(codex.pid);
      stopper.signal.addEventListener('abort', onAbort, { once: true });
      codex.on('error', (error) => {
        clearTimeout(timer);
        clearInterval(linger);
        reject(new JobError('setup', `無法啟動 Codex：${error.message}`));
      });
      codex.on('exit', (code) => {
        clearTimeout(timer);
        clearInterval(linger);
        stopper.signal.removeEventListener('abort', onAbort);
        resolve(lingered ? 0 : code);
      });
    });
    await Promise.all([new Promise(resolve => events.end(resolve)), new Promise(resolve => errors.end(resolve))]);
    // Persist usage before validation/export/upload: those can fail after tokens were spent.
    const usageEvents = (await readFile(join(paths.logs, 'codex-events.jsonl'), 'utf8')).split('\n');
    const turns = [];
    for (const line of usageEvents) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'turn.completed' && event.usage) turns.push(event.usage);
      } catch { /* incomplete final line is not a usage event */ }
    }
    const count = (key) => turns.reduce((sum, u) => sum + (Number.isFinite(Number(u[key])) ? Math.max(0, Number(u[key])) : 0), 0);
    const usage = {
      job_id: job.id, attempt: job.attempt, model: config.model || null,
      reasoning_effort: config.reasoningEffort || null, exit_code: exitCode,
      recorded_at: new Date().toISOString(), usage_available: turns.length > 0,
      input_tokens: turns.length ? count('input_tokens') : null,
      cached_input_tokens: turns.length ? count('cached_input_tokens') : null,
      output_tokens: turns.length ? count('output_tokens') : null,
      turns,
    };
    await stamp('ai-usage.json', usage);
    log(`job ${job.id} AI usage: ${JSON.stringify(usage)}`);
    guard();
    if (exitCode !== 0) {
      const tail = (await readFile(join(paths.logs, 'codex-stderr.log'), 'utf8').catch(() => '')).trim().split('\n').slice(-3).join(' ');
      const setup = /not logged in|login|unauthorized|401/i.test(tail);
      throw new JobError(setup ? 'setup' : 'modeling', `Codex 結束碼 ${exitCode}${tail ? `：${tail.slice(0, 300)}` : ''}`);
    }
    if (toolCalls === 0) throw new JobError('modeling', 'Codex 沒有呼叫 SketchUp 工具');
    let report = null;
    try {
      report = JSON.parse((await readFile(reportPath, 'utf8')).replace(/^\uFEFF/, ''));
    } catch {
      throw new JobError('modeling', 'Codex 沒有寫出有效的 report.json');
    }
    const toolEntries = (await readFile(toolLog, 'utf8')).trim().split('\n').flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const topScreens = (await readdir(paths.screens)).filter((name) => /-top\.png$/.test(name));
    if (!Array.isArray(report.reference_analysis) || report.reference_analysis.length !== refs.saved.length ||
        !report.unit_plan?.instances?.length || report.orientation_review?.passed !== true ||
        !Array.isArray(report.orientation_review?.unresolved) || report.orientation_review.unresolved.length ||
        !topScreens.length || !toolEntries.some((entry) => entry.tool === 'screenshot' && entry.ok)) {
      throw new JobError('validation', 'orientation_review_required: 圖片分類、單元組合或頂視方向檢查未通過，模型保留在本機，未發布');
    }
    await assertIdentity(port, job.id, nonce, { timeoutMs: 20_000 }).catch(() => {
      throw new JobError('modeling', 'SketchUp 模型識別不符，已停止匯出');
    });

    await stage('export', 0.6, '匯出 SKP／FBX／GLB');
    const base = String(input.product?.model || input.product?.sku || 'model').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'model';
    const out = {
      skp: join(paths.outputs, `${base}.skp`),
      fbx: join(paths.fbxDir, `${base}.fbx`),
      glb: join(paths.outputs, `${base}.glb`),
      preview: join(paths.outputs, 'preview.png'),
    };
    const exportInfo = await bridgeCall(port, 'export', out, { timeoutMs: 600_000 }).catch((error) => {
      throw new JobError('export', `SketchUp 匯出失敗：${error.message}`);
    });
    await closeSketchUp();
    await lock.release();
    lock = null;

    await stage('validate', 0.7, '檢查尺寸、座標與格式');
    const skpBytes = await readFile(out.skp);
    const glbBytes = await readFile(out.glb);
    const pngBytes = await readFile(out.preview);
    const fbxBytes = await readFile(out.fbx);
    let fbx;
    let glb;
    let png;
    try {
      fbx = inspectFbx(fbxBytes);
      glb = inspectGlb(glbBytes);
      png = inspectPng(pngBytes);
    } catch (error) {
      throw new JobError('export', `匯出檔案格式錯誤：${error.message}`);
    }
    const bundleFiles = await listFiles(paths.fbxDir);
    const zip = createZip(await Promise.all(bundleFiles.map(async (f) => ({ name: f.name, data: await readFile(f.full) }))));
    const zipEntries = readZip(zip).map((e) => e.name);
    if (!zipEntries.includes(`${base}.fbx`)) throw new JobError('export', 'FBX 打包失敗');
    const validation = {
      schema_version: 1,
      job_id: job.id,
      attempt: job.attempt,
      product_id: input.product?.id ?? null,
      tools: { codex: codexVersion ?? null, sketchup: exportInfo.sketchup_version, worker: CODEX_JOB_VERSION },
      source_skp_sha256: sha256(skpBytes),
      references: refs.saved.map((r) => ({ name: r.name, source: r.source, size_bytes: r.size_bytes })),
      reference_failures: refs.failed.length,
      export: exportInfo,
      fbx: { ...fbx, bundle_entries: zipEntries },
      glb: { meshes: glb.meshes, primitives: glb.primitives, materials: glb.materials, textures: glb.textures, images: glb.images },
      codex: { tool_calls: toolCalls, review_rounds: report?.review_rounds ?? null, scope: report?.scope ?? null },
      ...validateOutputs({ snapshot: input, exportInfo, glb, fbx, png, skpBytes, report }),
    };
    await stamp('validation.json', validation);
    if (!validation.ok) throw new JobError('validation', `模型檢查未通過：${validation.failed.join(', ')}`);
        await writeFile(join(paths.outputs, 'fbx-bundle.zip'), zip);
        const files = await Promise.all([out.skp, out.fbx, out.glb, out.preview, reportPath, join(dir, 'validation.json'), join(paths.outputs, 'fbx-bundle.zip')].map(async (path) => ({ path: relative(dir, path), hash: sha256(await readFile(path)) })));
        return { out, validation, report, base, zipEntries, files };
      })();
      await stamp('checkpoint.json', generated);
      await stamp('job.json', job);
    }
    const { out, validation, report, base, zipEntries } = generated;
    const skpBytes = await readFile(out.skp), fbxBytes = await readFile(out.fbx);
    const glbBytes = await readFile(out.glb), pngBytes = await readFile(out.preview);
    const zip = await readFile(join(paths.outputs, 'fbx-bundle.zip'));
    const reviewFile = join(dir, 'review.json');
    if (!deps.resumeDir) await stamp('review.json', { status: 'pending', job_id: job.id, revision: deps.revision ?? 0, product: input.product, model_path: out.skp, preview_path: out.preview, created_at: new Date().toISOString() });
    log(`job ${job.id} [awaiting_review] 模型已生成，等待 Worker 人工驗收`);
    await heartbeat({ stage: 'validate', detail: '模型已生成，等待本機 Worker 人工驗收' });
    for (;;) {
      guard();
      const review = JSON.parse(await readFile(reviewFile, 'utf8'));
      if (review.status === 'accepted') break;
      if (review.status === 'revise' || review.status === 'revising') {
        if (!String(review.feedback ?? '').trim()) throw new JobError('input', 'revision_feedback_required');
        await closeSketchUp();
        await lock?.release();
        clearInterval(pulse);
        const revision = review.status === 'revising' ? Number(review.revision) : Number(review.revision ?? 0) + 1;
        await stamp('review.json', { ...review, status: 'revising', revision });
        const nextDir = join(config.workRoot, `${job.id}-a${job.attempt}-r${revision}`);
        return await runCodexJob(job, { ...deps, resumeDir: undefined, revisionDir: nextDir, revisionSeed: out.skp, feedback: review.feedback, revision });
      }
      if (review.status === 'discarded') {
        await callAgent('fail', { lease_id: leaseId, error: 'review_discarded: 人工驗收已放棄草稿', retryable: false });
        return { discarded: true };
      }
      await sleep(2000);
    }
    for (const item of generated.files) {
      if (sha256(await readFile(join(dir, item.path))) !== item.hash) throw new JobError('validation', 'review_files_changed: 驗收檔案已被修改，請透過修正流程重新匯出驗證');
    }

    const reportBytes = Buffer.from(JSON.stringify(report, null, 2));
    const validationBytes = Buffer.from(JSON.stringify(validation, null, 2));
    const artifacts = [
      { role: 'skp', file: `${base}.skp`, format: 'skp', purpose: 'SketchUp 原生模型', bytes: skpBytes },
      { role: 'fbx', file: `${base}.fbx`, format: 'fbx', purpose: 'FBX（單檔，貼圖在 fbx_bundle）', bytes: fbxBytes },
      { role: 'fbx_bundle', file: `${base}-fbx.zip`, format: 'zip', purpose: 'FBX 與貼圖（保留相對目錄）', bytes: zip, depends_on: zipEntries },
      { role: 'glb', file: `${base}.glb`, format: 'glb', purpose: '網頁預覽（貼圖與 buffer 內嵌）', bytes: glbBytes },
      { role: 'preview', file: 'preview.png', format: 'png', purpose: '模型預覽圖', bytes: pngBytes },
      { role: 'validation', file: 'validation.json', format: 'json', purpose: '檢查結果', bytes: validationBytes },
      { role: 'report', file: 'report.json', format: 'json', purpose: 'Codex 建模報告（範圍、估算、衝突）', bytes: reportBytes },
    ];
    const manifest = {
      schema_version: 1,
      job_id: job.id,
      attempt: job.attempt,
      lease_id: leaseId,
      product_id: input.product?.id ?? null,
      request_id: input.request_id ?? null,
      generated_at: new Date().toISOString(),
      mode: 'codex_v1',
      source_skp_sha256: validation.source_skp_sha256,
      files: artifacts.map((a) => ({
        role: a.role, file: a.file, format: a.format, purpose: a.purpose,
        size_bytes: a.bytes.length, sha256: sha256(a.bytes), depends_on: a.depends_on ?? [],
      })),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
    await writeFile(join(dir, 'manifest.json'), manifestBytes);
    artifacts.push({ role: 'manifest', file: 'manifest.json', format: 'json', purpose: '產物清單', bytes: manifestBytes });
    const manifestHash = sha256(manifestBytes);

    await stage('upload', 0.8, `上傳 ${artifacts.length} 個檔案`);
    for (const artifact of artifacts) {
      guard();
      const hash = sha256(artifact.bytes);
      const prepared = await callAgent('artifact-upload', {
        lease_id: leaseId, role: artifact.role, content_hash: hash, size_bytes: artifact.bytes.length,
      });
      await uploadSigned(prepared.path, prepared.token, artifact.bytes, CONTENT_TYPES[artifact.role]);
      const signed = await callAgent('artifact-download', { lease_id: leaseId, role: artifact.role });
      const echoed = await downloadSigned(signed.url);
      if (sha256(echoed) !== hash) throw new JobError('network', `上傳後核對失敗（${artifact.role}）`);
    }
    await stamp('publish.json', { status: 'pending', job_id: job.id, lease_id: leaseId, manifest_hash: manifestHash, at: new Date().toISOString() });

    await stage('publish', 0.95, '發布模型');
    let published = null;
    for (let attempt = 1; attempt <= 3 && !published; attempt++) {
      try {
        published = await callAgent('publish', { lease_id: leaseId, manifest_hash: manifestHash });
      } catch (error) {
        if (STOP_CODES.has(error?.code) || error?.code === 'artifact_missing' || attempt === 3) throw error;
        await sleep(attempt * 5_000);
      }
    }
    await stamp('publish.json', { status: 'done', job_id: job.id, lease_id: leaseId, manifest_hash: manifestHash, result: published, at: new Date().toISOString() });
    const acceptedReview = JSON.parse(await readFile(reviewFile, 'utf8'));
    await stamp('review.json', { ...acceptedReview, status: 'published' });
    log(`job ${job.id}: published ${JSON.stringify(published?.models ?? published)}`);
    return published;
  } catch (error) {
    await stamp('error.json', { error: error?.message ?? String(error), kind: error?.kind ?? null, at: new Date().toISOString() }).catch(() => {});
    throw stopError ?? error;
  } finally {
    clearInterval(pulse);
    await closeSketchUp().catch(() => {});
    await lock?.release().catch(() => {});
  }
}

/** A Worker restarted between upload and publish retries the publish with the same manifest. */
export async function resumePendingPublishes(config, callAgent, log = console.log) {
  let dirs = [];
  try {
    dirs = await readdir(config.workRoot);
  } catch {
    return;
  }
  for (const name of dirs) {
    const file = join(config.workRoot, name, 'publish.json');
    if (!existsSync(file)) continue;
    let state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    if (state.status !== 'pending') continue;
    try {
      const result = await callAgent('publish', { lease_id: state.lease_id, manifest_hash: state.manifest_hash });
      await writeFile(file, JSON.stringify({ ...state, status: 'done', result, at: new Date().toISOString() }, null, 2));
      log(`resumed publish for job ${state.job_id}`);
    } catch (error) {
      await writeFile(file, JSON.stringify({ ...state, status: 'abandoned', error: error?.message ?? String(error) }, null, 2));
    }
  }
}

export async function cleanupWorkRoot(config) {
  const cutoff = Date.now() - config.retentionDays * 86_400_000;
  let dirs = [];
  try {
    dirs = await readdir(config.workRoot);
  } catch {
    return;
  }
  for (const name of dirs) {
    const full = join(config.workRoot, name);
    const info = await stat(full).catch(() => null);
    if (existsSync(join(full, 'review.json')) && !existsSync(join(full, 'publish.json'))) continue;
    if (info?.isDirectory() && info.mtimeMs < cutoff) await rm(full, { recursive: true, force: true }).catch(() => {});
  }
}

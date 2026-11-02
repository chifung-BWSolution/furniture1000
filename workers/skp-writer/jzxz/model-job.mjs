// One FDS job modeled by 建築學長: write task.json, send the prompt, wait for result.json.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(kind, detail, retryable = kind === 'modeling') {
  const error = new Error(`${kind}: ${detail}`);
  error.kind = kind;
  error.retryable = retryable;
  return error;
}

function ui(uiScript, jzxzDir, command, args = {}) {
  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', uiScript, '-Command', command, '-JzxzDir', jzxzDir];
  if (args.text) argv.push('-Text', args.text);
  if (args.taskId) argv.push('-TaskId', args.taskId);
  return new Promise((resolve) => {
    execFile('powershell.exe', argv, { windowsHide: true, timeout: 120_000, encoding: 'utf8' }, (error, stdout) => {
      const line = String(stdout ?? '').trim().split(/\r?\n/).filter(Boolean).pop();
      try { resolve(JSON.parse(line)); }
      catch { resolve({ ok: false, error: error?.message || '建築學長介面沒有回傳' }); }
    });
  });
}

async function readResult(dir) {
  try { return JSON.parse((await readFile(join(dir, 'result.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch { return null; }
}

export async function modelWithJzxz({ job, input, references, uiScript, taskRoot, jzxzDir, log = console.log, heartbeat, signal }) {
  const id = String(job.id ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw fail('input', '任務編號不能交給建築學長', false);
  if (!existsSync(uiScript)) throw fail('setup', 'Worker 缺少建築學長操作程式 ui.ps1', false);
  const dir = join(taskRoot, id);
  const output = join(dir, 'output', `${id}.skp`);
  await rm(join(dir, 'result.json'), { force: true });
  await mkdir(join(dir, 'refs'), { recursive: true });
  await mkdir(join(dir, 'output'), { recursive: true });
  const refs = [];
  for (const [index, ref] of references.entries()) {
    const name = `${index + 1}-${basename(ref.path)}`;
    await copyFile(ref.path, join(dir, 'refs', name));
    refs.push(`refs/${name}`);
  }
  const product = input.product ?? {};
  const dims = input.catalog_dimensions_mm ?? {};
  await writeFile(join(dir, 'task.json'), JSON.stringify({
    task_id: id,
    driver: 'worker',
    product: {
      name: product.name || '未命名產品',
      model: product.model || product.sku || id,
      category: product.category || '',
    },
    dimensions_mm: { width: dims.width ?? null, depth: dims.depth ?? null, height: dims.height ?? null },
    materials: [product.material, product.color].filter(Boolean).join('；'),
    notes: [product.specifications, product.description].filter(Boolean).join('\n'),
    reference_images: refs,
    output_skp: output,
  }, null, 2));

  const opened = await ui(uiScript, jzxzDir, 'new-chat');
  if (!opened.ok) throw fail('modeling', `建築學長無法開新對話（${opened.error || '仍停在別的任務'}）`);
  const sent = await ui(uiScript, jzxzDir, 'send', { text: `執行 FDS 任務 ${id}` });
  if (!sent.ok) throw fail('modeling', '建築學長沒有收到任務指令');
  log(`job ${job.id} submitted to 建築學長`);

  const started = Date.now();
  let progressAt = started;
  let retries = 0;
  while (Date.now() - started < 90 * 60_000) {
    if (signal?.aborted) throw fail('cancelled', '任務已取消', false);
    const result = await readResult(dir);
    if (result?.status === 'done' && result.skp_path && existsSync(result.skp_path)) {
      return { skpPath: result.skp_path, summary: result.summary || '', issues: result.known_issues ?? [] };
    }
    if (result?.status === 'failed') throw fail('modeling', result.summary || '建築學長回報失敗');
    if (Date.now() - progressAt > 8 * 60_000) {
      if (retries >= 3) throw fail('modeling', '建築學長多次停住，已停止重試');
      retries += 1;
      progressAt = Date.now();
      const found = await ui(uiScript, jzxzDir, 'open', { taskId: id });
      const state = found.ok ? await ui(uiScript, jzxzDir, 'state') : { status: 'idle', can_retry: false };
      if (state.status === 'running') {
        log(`job ${job.id} 建築學長仍在執行`);
      } else if (state.status === 'stopped' && state.can_retry) {
        await ui(uiScript, jzxzDir, 'retry');
        log(`job ${job.id} 建築學長已停住，已點重試`);
      } else {
        await ui(uiScript, jzxzDir, 'send', { text: '继续' });
        log(`job ${job.id} 建築學長已停住，已送出繼續`);
      }
    }
    await heartbeat?.({ stage: 'jzxz', detail: '建築學長建模中' });
    await sleep(20_000);
  }
  throw fail('modeling', '建築學長超過 90 分鐘未完成');
}

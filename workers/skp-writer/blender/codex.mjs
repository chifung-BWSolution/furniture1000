import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codexEnv, assertNoSecrets } from '../codex/env.mjs';
import { killTree } from '../codex/lock.mjs';

export async function executeBlenderCodex({ job, dir, paths, config, blenderExe, prompt, references, signal, secrets = [] }) {
  const toolLog = join(paths.logs, 'mcp-tools.jsonl');
  await rm(toolLog, { force: true });
  await rm(join(paths.logs, 'codex-last-message.md'), { force: true });
  const mcpEnv = { FDS_BLENDER_EXE: blenderExe, FDS_CODEX_JOB_ID: job.id, FDS_CODEX_JOB_DIR: dir, FDS_CODEX_SCREEN_DIR: paths.screens, FDS_CODEX_TOOL_LOG: toolLog };
  const env = codexEnv();
  assertNoSecrets(env, secrets);
  assertNoSecrets(mcpEnv, secrets);
  const q = JSON.stringify;
  const args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '-C', dir, '-s', 'workspace-write',
    '-c', 'approval_policy="never"',
    '-c', `mcp_servers.fds-blender.command=${q(process.execPath)}`,
    '-c', `mcp_servers.fds-blender.args=[${q(config.mcpServer)}]`,
    '-c', `mcp_servers.fds-blender.env={${Object.entries(mcpEnv).map(([k,v]) => `${k}=${q(v)}`).join(',')}}`,
    '-c', 'mcp_servers.fds-blender.default_tools_approval_mode="approve"',
    '-c', 'mcp_servers.fds-blender.tool_timeout_sec=360',
    ...(config.model ? ['-m', config.model] : []),
    ...(config.reasoningEffort ? ['-c', `model_reasoning_effort=${q(config.reasoningEffort)}`] : []),
    ...references.flatMap((r) => ['-i', r.path]), '--json', '-o', join(paths.logs, 'codex-last-message.md'), '-'];
  if (signal.aborted) throw signal.reason;
  const child = spawn(config.codexExe, args, { cwd: dir, env, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const events = createWriteStream(join(paths.logs, 'codex-events.jsonl'));
  const errors = createWriteStream(join(paths.logs, 'codex-stderr.log'));
  child.stdout.pipe(events);
  child.stderr.pipe(errors);
  const abort = () => killTree(child.pid);
  signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, config.timeoutMs);
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  let code;
  try {
    code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',resolve); });
    await Promise.all([events,errors].map((stream) => stream.writableFinished ? Promise.resolve() : new Promise((resolve,reject) => { stream.once('finish',resolve); stream.once('error',reject); })));
  } finally { clearTimeout(timer); signal.removeEventListener('abort',abort); }
  const turns = (await readFile(join(paths.logs, 'codex-events.jsonl'),'utf8')).split('\n').flatMap((line) => { try { const e=JSON.parse(line); return e.type==='turn.completed' && e.usage ? [e.usage] : []; } catch { return []; } });
  const usage = { job_id: job.id, engine: 'blender', model: config.model || null, exit_code: code, recorded_at: new Date().toISOString(), turns, usage_available: !!turns.length };
  for (const key of ['input_tokens','cached_input_tokens','output_tokens']) usage[key] = turns.length ? turns.reduce((n,t) => n+(Number(t[key])||0),0) : null;
  await writeFile(join(dir,'ai-usage.json'),JSON.stringify(usage,null,2));
  if (signal.aborted) throw signal.reason;
  if (timedOut || code !== 0) throw Object.assign(new Error(`Codex Blender ${timedOut ? '逾時' : `結束碼 ${code}`}，草稿已保留`), { kind:'modeling',retryable:false });
  return (await readFile(toolLog,'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

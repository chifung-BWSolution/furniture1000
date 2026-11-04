// Minimal MCP (stdio, JSON-RPC per line) server that lets Codex drive the job's dedicated SketchUp.
// Every call first checks that the bridge on FDS_CODEX_PORT is this job's session and model.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { assertIdentity, bridgeCall } from './bridge.mjs';
import { checkRubyCall, jobFilePath } from './ruby-gate.mjs';
import { runBlender } from '../blender/driver.mjs';
import { join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';

const PORT = Number(process.env.FDS_CODEX_PORT);
const JOB_ID = process.env.FDS_CODEX_JOB_ID ?? '';
const NONCE = process.env.FDS_CODEX_NONCE ?? '';
const SCREEN_DIR = process.env.FDS_CODEX_SCREEN_DIR ?? '';
const TOOL_LOG = process.env.FDS_CODEX_TOOL_LOG ?? '';
const JOB_DIR = process.env.FDS_CODEX_JOB_DIR ?? '';
const SCRIPT = process.env.FDS_CODEX_SCRIPT ?? '';
const BLENDER = process.env.FDS_BLENDER_EXE ?? '';
const MAX_SCREENSHOTS = 12;
const MAX_FILE_CHARS = 1_000_000;
let screenshots = 0;

const TOOLS = [
  {
    name: 'get_scene_info',
    description: 'Summary of the open SketchUp model: units, bounds in mm, top-level groups/components, product parts (FdsKit.audit), materials, and material_library (bundled textured .skm paths by category).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_selection',
    description: 'Entities currently selected in SketchUp.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'eval_ruby',
    description: "Run Ruby inside SketchUp (wrapped in one undoable operation; rolled back on error). Returns the last expression as a string. Use .mm for lengths. New geometry is rejected unless the code is exactly `load '<build_model.rb>'; FdsBuild.batch('<name>')`.",
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Ruby source to evaluate.' } },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'screenshot',
    description: `Render the current view to PNG and return it. Optional view: iso, front, side, top. At most ${MAX_SCREENSHOTS} per job.`,
    inputSchema: {
      type: 'object',
      properties: { view: { type: 'string', enum: ['current', 'iso', 'front', 'side', 'top'] } },
      additionalProperties: false,
    },
  },
  {
    name: 'write_job_file',
    description: 'Write a UTF-8 text file in this job folder (replaces the whole file). Only build_model.rb and outputs/report.json.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', enum: ['build_model.rb', 'outputs/report.json'] },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
];
if (BLENDER) TOOLS.push(
  { name: 'write_blender_file', description: 'Write the complete Blender Python build script or report in this job.', inputSchema: { type: 'object', properties: { path: { type: 'string', enum: ['build_model.py', 'outputs/report.json'] }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'run_blender', description: 'Execute build_model.py in dedicated background Blender, save model.blend, directly export FBX/GLB and render four views. No SketchUp is started. Use screenshot to inspect Blender renders.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
);
if (BLENDER) {
  for (let i = TOOLS.length - 1; i >= 0; i--) {
    if (['eval_ruby', 'write_job_file', 'get_selection'].includes(TOOLS[i].name)) TOOLS.splice(i, 1);
    else if (TOOLS[i].name === 'get_scene_info') TOOLS[i].description = 'Measured Blender mesh parts, bounds in mm, material counts, and Blender version.';
    else if (TOOLS[i].name === 'screenshot') TOOLS[i].description = 'Return a Blender render: iso, front, side or top. Run Blender again after changing the build script.';
  }
}

function log(entry) {
  if (!TOOL_LOG) return;
  try {
    appendFileSync(TOOL_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // Logging must never break the tool call.
  }
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

async function callTool(name, args, meta) {
  if (BLENDER && ['eval_ruby', 'write_job_file'].includes(name)) throw new Error('Blender jobs must use the Blender tools');
  if (name === 'write_blender_file' && BLENDER) {
    if (!['build_model.py', 'outputs/report.json'].includes(args.path) || typeof args.content !== 'string' || args.content.length > MAX_FILE_CHARS) throw new Error('invalid Blender file');
    const path = join(JOB_DIR, args.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, args.content, 'utf8');
    return text(`wrote ${args.path}`);
  }
  if (name === 'run_blender' && BLENDER) {
    const scriptHash = createHash('sha256').update(readFileSync(join(JOB_DIR, 'build_model.py'))).digest('hex');
    await runBlender(BLENDER, JOB_DIR);
    if (createHash('sha256').update(readFileSync(join(JOB_DIR, 'build_model.py'))).digest('hex') !== scriptHash) throw new Error('Blender script changed during execution; run again');
    meta.script_sha256 = scriptHash;
    for (const name of await readdir(SCREEN_DIR)) {
      if (/^shot-\d+-(iso|front|side|top|current)\.png$/.test(name)) await rm(join(SCREEN_DIR, name));
    }
    return text(JSON.parse(readFileSync(join(JOB_DIR, 'outputs', 'scene-info.json'), 'utf8')));
  }
  if (BLENDER && name === 'get_scene_info') return text(JSON.parse(readFileSync(join(JOB_DIR, 'outputs', 'scene-info.json'), 'utf8')));
  if (BLENDER && name === 'screenshot') {
    const view = args?.view === 'current' || !args?.view ? 'iso' : args.view;
    if (!['iso', 'front', 'side', 'top'].includes(view)) throw new Error('invalid Blender view');
    if (screenshots >= MAX_SCREENSHOTS) throw new Error('screenshot limit reached');
    const data = readFileSync(join(JOB_DIR, 'outputs', `view-${view}.png`));
    screenshots++;
    writeFileSync(join(SCREEN_DIR, `shot-${screenshots}-${view}.png`), data);
    meta.view = view;
    return { content: [{ type: 'image', data: data.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `Blender ${view}` }] };
  }
  if (name === 'write_job_file') {
    const path = jobFilePath(JOB_DIR, args?.path);
    if (typeof args?.content !== 'string') throw new Error('content is required');
    if (args.content.length > MAX_FILE_CHARS) throw new Error('content too long');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, args.content, 'utf8');
    meta.file = args.path;
    return text(`wrote ${args.path} (${args.content.length} chars)`);
  }
  await assertIdentity(PORT, JOB_ID, NONCE, { timeoutMs: 15_000 });
  if (name === 'get_scene_info') return text(await bridgeCall(PORT, 'scene_info', {}, { timeoutMs: 60_000 }));
  if (name === 'get_selection') return text(await bridgeCall(PORT, 'selection', {}, { timeoutMs: 60_000 }));
  if (name === 'eval_ruby') {
    if (typeof args?.code !== 'string' || !args.code.trim()) throw new Error('code is required');
    if (args.code.length > 200_000) throw new Error('code too long');
    const gate = checkRubyCall(args.code, SCRIPT);
    if (!gate.allowed) throw new Error(gate.reason);
    meta.script_load = gate.script_load;
    if (gate.batch) meta.batch = gate.batch;
    return text(String(await bridgeCall(PORT, 'eval', { code: args.code }, { timeoutMs: 170_000 })));
  }
  if (name === 'screenshot') {
    if (screenshots >= MAX_SCREENSHOTS) throw new Error(`screenshot limit (${MAX_SCREENSHOTS}) reached`);
    screenshots += 1;
    const result = await bridgeCall(PORT, 'screenshot', { view: args?.view ?? 'current', index: screenshots }, { timeoutMs: 90_000 });
    const path = resolve(String(result?.path ?? ''));
    const inside = relative(resolve(SCREEN_DIR), path);
    if (!SCREEN_DIR || inside.startsWith('..') || inside === path) throw new Error('screenshot path outside job');
    const data = readFileSync(path).toString('base64');
    return {
      content: [
        { type: 'image', data, mimeType: 'image/png' },
        { type: 'text', text: `screenshot ${screenshots}/${MAX_SCREENSHOTS} (${result?.view ?? 'current'})` },
      ],
    };
  }
  throw new Error(`unknown tool: ${name}`);
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: BLENDER ? 'fds-blender' : 'fds-sketchup', version: '1.0.0' },
      },
    });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const started = Date.now();
    const name = params?.name;
    const code = typeof params?.arguments?.code === 'string' ? params.arguments.code : null;
    const meta = {};
    try {
      const result = await callTool(name, params?.arguments ?? {}, meta);
      log({ tool: name, ok: true, ms: Date.now() - started, code_sha256: code ? createHash('sha256').update(code).digest('hex') : undefined, code_chars: code?.length, ...meta });
      return send({ jsonrpc: '2.0', id, result });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log({ tool: name, ok: false, ms: Date.now() - started, error: reason.slice(0, 500), code_chars: code?.length, ...meta });
      return send({ jsonrpc: '2.0', id, result: { ...text(`Error: ${reason}`), isError: true } });
    }
  }
  if (id !== undefined && id !== null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

if ((!BLENDER && (!Number.isInteger(PORT) || PORT <= 0 || !NONCE)) || !JOB_ID || !JOB_DIR) {
  process.stderr.write('fds-sketchup MCP: missing job configuration\n');
  process.exit(2);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  handle(message).catch((error) => process.stderr.write(`${error?.stack ?? error}\n`));
});

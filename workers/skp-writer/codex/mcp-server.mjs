// Minimal MCP (stdio, JSON-RPC per line) server that lets Codex drive the job's dedicated SketchUp.
// Every call first checks that the bridge on FDS_CODEX_PORT is this job's session and model.
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { assertIdentity, bridgeCall } from './bridge.mjs';

const PORT = Number(process.env.FDS_CODEX_PORT);
const JOB_ID = process.env.FDS_CODEX_JOB_ID ?? '';
const NONCE = process.env.FDS_CODEX_NONCE ?? '';
const SCREEN_DIR = process.env.FDS_CODEX_SCREEN_DIR ?? '';
const TOOL_LOG = process.env.FDS_CODEX_TOOL_LOG ?? '';
const MAX_SCREENSHOTS = 12;
let screenshots = 0;

const TOOLS = [
  {
    name: 'get_scene_info',
    description: 'Summary of the open SketchUp model: units, bounds in mm, top-level groups/components, materials.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_selection',
    description: 'Entities currently selected in SketchUp.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'eval_ruby',
    description: 'Run Ruby inside SketchUp (wrapped in one undoable operation; rolled back on error). Returns the last expression as a string. Use .mm for lengths.',
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
];

function log(entry) {
  if (!TOOL_LOG) return;
  try {
    appendFileSync(TOOL_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // Logging must never break the tool call.
  }
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

async function callTool(name, args) {
  await assertIdentity(PORT, JOB_ID, NONCE, { timeoutMs: 15_000 });
  if (name === 'get_scene_info') return text(await bridgeCall(PORT, 'scene_info', {}, { timeoutMs: 60_000 }));
  if (name === 'get_selection') return text(await bridgeCall(PORT, 'selection', {}, { timeoutMs: 60_000 }));
  if (name === 'eval_ruby') {
    if (typeof args?.code !== 'string' || !args.code.trim()) throw new Error('code is required');
    if (args.code.length > 200_000) throw new Error('code too long');
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
        serverInfo: { name: 'fds-sketchup', version: '1.0.0' },
      },
    });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const started = Date.now();
    const name = params?.name;
    const code = typeof params?.arguments?.code === 'string' ? params.arguments.code : null;
    try {
      const result = await callTool(name, params?.arguments ?? {});
      log({ tool: name, ok: true, ms: Date.now() - started, code_sha256: code ? createHash('sha256').update(code).digest('hex') : undefined, code_chars: code?.length });
      return send({ jsonrpc: '2.0', id, result });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log({ tool: name, ok: false, ms: Date.now() - started, error: reason.slice(0, 500), code_chars: code?.length });
      return send({ jsonrpc: '2.0', id, result: { ...text(`Error: ${reason}`), isError: true } });
    }
  }
  if (id !== undefined && id !== null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

if (!Number.isInteger(PORT) || PORT <= 0 || !JOB_ID || !NONCE) {
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

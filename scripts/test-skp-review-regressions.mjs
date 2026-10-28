import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const edge = read('../supabase/functions/skp-worker-agent/index.ts').replace(/^import .*;\r?\n/gm, '');
const bytes = Buffer.from('test model contents');
const hash = createHash('sha256').update(bytes).digest('hex');
for (const permission of [{ error: 'unauthorized' }, { error: 'lease_rejected' }, { error: 'upload_rejected' }, {}, { ok: true, idempotent: true }, { ok: true, verified: true }]) {
  const events = [];
  let handler;
  const context = vm.createContext({
    URL, Request, Response, console, createHash,
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://omxizeukbcqzsnjsuwod.supabase.co' : 'fixture' }, serve: fn => { handler = fn; } },
    createClient: () => ({ rpc: async (name, args) => {
      assert.equal(name, 'fds_skp_device_complete');
      events.push(args.p_verify_only ? 'authorize' : 'complete');
      return { data: args.p_verify_only ? permission : { ok: true }, error: null };
    } }),
    fetch: async () => { events.push('storage'); return new Response(bytes); },
  });
  vm.runInContext(ts.transpileModule(edge, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  const response = await handler(new Request('https://fixture', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify({ action: 'complete', lease_id: 'lease', storage_path: 'generated/model/file.skp', content_hash: hash, size_bytes: bytes.length }) }));
  if (permission.verified) {
    assert.deepEqual(events, ['authorize', 'storage', 'complete']);
    assert.equal(response.status, 200);
  } else {
    assert.deepEqual(events, ['authorize'], 'Denied/idempotent calls never read Storage');
    assert.equal(response.status === 200, permission.idempotent === true);
  }
}

// Execute the real child watcher with a revoked heartbeat. Node must not resolve
// cleanup until taskkill finishes, even if the child emits exit in the meantime.
const worker = read('../workers/skp-writer/worker.mjs');
const ast = ts.createSourceFile('worker.mjs', worker, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = names => ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
let pulse, killed;
const revoked = Object.assign(new Error('revoked'), { code: 'revoked' });
const context = vm.createContext({
  AUTH_STOP: new Set(['revoked']),
  pulseLease: async () => { throw revoked; },
  setInterval: fn => { pulse = fn; return 1; }, clearInterval() {},
  setTimeout: () => 2, clearTimeout() {},
  execFile: (name, args, options, done) => { assert.equal(name, 'taskkill'); assert.ok(args.includes('/T')); killed = done; },
});
vm.runInContext(functions(['watchChild']), context);
const child = new EventEmitter(); child.pid = 123;
let finished = false;
const watched = context.watchChild(child, 1000).then(() => { throw new Error('Must reject'); }, error => { assert.equal(error, revoked); finished = true; });
pulse();
await new Promise(resolve => setImmediate(resolve));
assert.equal(typeof killed, 'function');
child.emit('exit');
await Promise.resolve();
assert.equal(finished, false, 'Wait for process tree termination before cleanup');
killed();
await watched;
assert.equal(finished, true);

const callContext = vm.createContext({ authorizationError: null, refreshAccess: async () => {}, agent: async () => { throw revoked; }, authStop: () => { throw new Error('Premature process exit'); } });
vm.runInContext(functions(['callAgent']), callContext);
await assert.rejects(callContext.callAgent('heartbeat'), error => error === revoked);

// Guard the restart scope and final-attempt wakeup predicate.
const setup = read('../workers/skp-writer/installer/WorkerSetup.cs');
const run = setup.slice(setup.indexOf('static void RunWorker()'), setup.indexOf('static void SelfTest'));
assert.ok(run.indexOf('LoadConfig()') > run.indexOf('do {'));
const migration = read('../supabase/migrations/20261028150000_furniture_recognition_jobs.sql');
assert.match(migration, /or \(status = 'running' and heartbeat_at < now\(\) - interval '2 minutes'\)/);
const view = read('../src/components/dashboard/FurnitureSearchView.tsx');
assert.match(view, /\}, \[productId, recognition\?\.jobId\]\)/);
console.log('PASS: authorization before Storage, idempotent completion, revocation cleanup ordering, credential reload and recognition wakeup guards');

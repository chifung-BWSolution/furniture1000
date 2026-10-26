import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('supabase/functions/process-supplier-catalogs/index.ts', 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function invoke(headers, verified = true, rpcError = null) {
  let handler;
  let calls = 0;
  const context = vm.createContext({
    Request, Response, Intl,
    Date: class extends Date { constructor() { super('2026-10-26T06:00:00Z'); } },
    Deno: { env: { get: (name) => ({ SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_URL: 'https://local.example' })[name] }, serve: (fn) => { handler = fn; } },
    createClient: () => ({ rpc: async (name, args) => {
      calls++;
      assert.equal(name, 'fds_worker_verify_secret');
      assert.equal(args.p_secret, headers['x-worker-secret']);
      return { data: verified, error: rpcError };
    } }),
  });
  vm.runInContext(code, context);
  const response = await handler(new Request('https://local.example', { method: 'POST', headers }));
  return { response, calls };
}

assert.equal((await invoke({})).response.status, 401);
assert.equal((await invoke({ 'x-worker-secret': 'invalid' }, false)).response.status, 401);
assert.equal((await invoke({ 'x-worker-secret': 'valid' }, true, { message: 'unavailable' })).response.status, 401);
const worker = await invoke({ 'x-worker-secret': 'valid' });
assert.equal(worker.response.status, 200);
assert.equal(worker.calls, 1);
assert.equal((await worker.response.json()).reason, 'outside_window');
const service = await invoke({ Authorization: 'Bearer service-key' });
assert.equal(service.response.status, 200);
assert.equal(service.calls, 0);
console.log('PASS catalog auth: missing/invalid/error rejected; worker and service credentials accepted');

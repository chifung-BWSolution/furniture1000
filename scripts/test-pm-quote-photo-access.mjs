import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

let handler;
let role;
const context = {
  Request, Response, console,
  Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } },
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'fixture' } } }) },
    rpc: async (_name, args) => ({ data: args.p_roles.includes(role) }),
  }),
};
const source = fs.readFileSync('supabase/functions/generate-quote-reference-image/index.ts', 'utf8').replace(/^import .*;\r?\n/gm, '');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
for (role of ['admin', 'uploader', 'pm', 'designer', 'client']) {
  // Invalid input stops before any paid provider or storage call.
  const response = await handler(new Request('https://fixture.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: '{}',
  }));
  assert.equal(response.status, ['admin', 'uploader', 'pm'].includes(role) ? 400 : 403, role);
}
console.log('PASS: scene generation permits PM/admin/uploader and rejects designer/client');

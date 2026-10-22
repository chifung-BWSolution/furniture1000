import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const base = new URL('../supabase/functions/generate-canva-presentation/', import.meta.url);
function moduleSource(file) {
  return ts.transpileModule(fs.readFileSync(new URL(file, base), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const modules = {};
for (const file of ['generation.ts', 'exports.ts']) {
  const context = { exports: {} };
  vm.runInNewContext(moduleSource(file), context);
  modules[`./${file}`] = context.exports;
}
async function harness(jobStatus = 'success') {
  let handler;
  const row = { id: 's1', staff_id: 'u1', status: 'draft', brief: { title: '簡報' }, product_ids: [], updated_at: new Date().toISOString() };
  const writes = [];
  const calls = [];
  let beforeUpdate;
  let polls = 0;
  let pollHttp = 200;
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: async () => ({ data: true }),
    from(table) {
      let patch;
      const filters = [];
      const q = {
        select() { return q; }, update(value) { patch = value; return q; },
        eq(key, value) { filters.push(r => r[key] === value); return q; },
        neq(key, value) { filters.push(r => r[key] !== value); return q; },
        is(key, value) { filters.push(r => (r[key] ?? null) === value); return q; },
        or() { return q; },
        async maybeSingle() {
          if (table === 'canva_connections') return { data: { access_token: 'test', scope: 'design:content:write profile:read' } };
          if (patch && beforeUpdate) { const hook = beforeUpdate; beforeUpdate = null; hook(); }
          if (!filters.every(fn => fn(row))) return { data: null };
          if (patch) { Object.assign(row, structuredClone(patch)); writes.push(structuredClone(patch)); }
          return { data: structuredClone(row) };
        },
        single() { return q.maybeSingle(); },
        then(resolve, reject) { return q.maybeSingle().then(resolve, reject); },
      };
      return q;
    },
  };
  const sandbox = {
    exports: {}, console, Request, Response, URL, URLSearchParams, AbortSignal, btoa,
    setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
    require(name) { if (name.includes('supabase-js')) return { createClient: () => db }; return modules[name] ?? {}; },
    fetch: async (url, opts) => {
      calls.push([url, opts?.method]);
      if (url.endsWith('/users/me/capabilities')) return Response.json({ capabilities: ['design_generation'] });
      if (url.endsWith('/generations')) return Response.json({ job: { id: 'j1' } });
      if (pollHttp !== 200) return new Response('Canva temporarily unavailable', { status: pollHttp });
      polls++;
      if (polls === 1) return Response.json({ job: { status: 'in_progress' } });
      return Response.json({ job: { status: jobStatus, error: { message: 'Canva 真實錯誤' }, result: { design: { id: 'd1', urls: { edit_url: 'https://www.canva.com/design/d1/edit' } } } } });
    },
  };
  vm.runInNewContext(moduleSource('index.ts'), sandbox);
  return {
    row, writes, calls,
    setPollHttp(status) { pollHttp = status; },
    race(fn) { beforeUpdate = fn; },
    async request(action, extra = {}) {
      const response = await handler(new Request('https://local.test', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, session_id: 's1', ...extra }) }));
      return { status: response.status, body: await response.json() };
    },
  };
}
const success = await harness();
assert.equal((await success.request('create_native')).body.status, 'creating');
assert.equal(success.calls.filter(([url]) => url.includes('/generations/')).length, 0, 'start returns on acceptance');
assert.equal((await success.request('generation_status')).body.populate_report.generation_status, 'in_progress');
assert.equal((await success.request('generation_status')).body.status, 'ready');
assert.ok(success.writes.some(w => w.populate_report?.generation_job_id === 'j1' && w.populate_report.generation_status === 'accepted'));
assert.ok(success.writes.some(w => w.populate_report?.generation_status === 'in_progress'));
assert.equal(success.row.canva_design_id, 'd1');
const count = success.calls.length;
assert.equal((await success.request('generation_status')).body.canva_design_id, 'd1');
assert.equal(success.calls.length, count, 'status reads never start paid jobs');
assert.equal((await success.request('save_draft', { brief: { title: '修改' } })).status, 200);
assert.equal(success.row.status, 'ready', 'saving cannot demote a ready design');
success.row.staff_id = 'other';
assert.equal((await success.request('generation_status')).status, 404, 'must enforce session owner');
const failed = await harness('failed');
await failed.request('create_native');
await failed.request('generation_status');
assert.equal((await failed.request('generation_status')).body.status, 'failed');
assert.equal(failed.row.status, 'failed');
assert.ok(failed.row.error.includes('Canva 真實錯誤'));
const race = await harness();
race.race(() => { race.row.status = 'creating'; });
assert.equal((await race.request('save_draft', { brief: { title: '競態' } })).status, 409);
assert.equal(race.row.status, 'creating');
assert.equal((await race.request('create_native')).body.status, 'creating');
assert.equal(race.calls.length, 0, 'repeated generation observes the existing task');
const interrupted = await harness();
await interrupted.request('create_native');
interrupted.setPollHttp(503);
assert.equal((await interrupted.request('generation_status')).status, 502);
assert.equal(interrupted.row.status, 'creating', 'HTTP poll errors do not invent a Canva job failure');
interrupted.setPollHttp(200);
await interrupted.request('generation_status');
assert.equal((await interrupted.request('generation_status')).body.status, 'ready');
assert.equal(interrupted.calls.filter(([, method]) => method === 'POST').length, 1, 'recovery must not generate again');
const late = await harness();
await late.request('create_native');
late.race(() => { late.row.status = 'ready'; late.row.canva_design_id = 'already-finished'; });
assert.equal((await late.request('generation_status')).body.canva_design_id, 'already-finished');
assert.equal(late.row.status, 'ready', 'late in_progress cannot demote a terminal result');

// The client must accept a failed session as task state, not mistake its error
// field for an error envelope and leave the UI polling an old creating state.
const client = { exports: {}, require: name => name.includes('edgeFunctionErrors')
  ? { parseInvokeError: async error => error.message }
  : { supabase: { functions: { invoke: async () => ({ data: failed.row, error: null }) } } } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/canvaNativeDesign.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, client);
assert.equal((await client.exports.fetchCanvaGenerationStatus('s1')).status, 'failed');
console.log('Canva live status: success, failure, ownership, save race, duplicate generation passed');

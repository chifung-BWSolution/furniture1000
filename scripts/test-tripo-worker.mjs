import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/process-jobs/tripo.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function setup(responses) {
  const requests = [], uploads = [], calls = [];
  const job = { id: 'job-1', payload: { product_id: 'product-1', reference_path: 'tripo-inputs/user/reference.jpg', user_id: 'user-1' } };
  const context = { exports: {}, Response, URL, AbortSignal, Uint8Array, DataView, Date, console,
    Deno: { env: { get: () => 'test-key' } },
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, 'Unexpected extra HTTP request');
      return next;
    },
  };
  const admin = {
    from: () => ({ update: patch => ({ eq: () => ({ eq: () => ({ select: async () => {
      job.payload = patch.payload;
      return { data: [{ id: job.id }], error: null };
    } }) }) }) }),
    storage: { from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: 'https://example.com/private-reference.jpg' }, error: null }),
      upload: async (path, bytes) => { uploads.push({ path, bytes }); return { error: null }; },
    }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'fds_processing_job_checkpoint') job.payload.state = args.p_state;
      return { data: name === 'fds_processing_job_heartbeat' ? 'running' : true, error: null };
    },
  };
  vm.createContext(context);
  vm.runInContext(output, context);
  return { ...context.exports, admin, job, requests, uploads, calls };
}
const reply = data => Response.json({ code: 0, data });
const glb = new Uint8Array(12);
const view = new DataView(glb.buffer);
view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, 12, true);

const fresh = setup([]);
await assert.rejects(fresh.runTripoJob(fresh.admin, fresh.job), /Tripo 已停用：任務尚未提交/);
assert.equal(fresh.requests.length, 0, 'A job without a provider task must never be submitted');
const uncertain = setup([]);
uncertain.job.payload.state = { submission_started: true, submitted_at: new Date().toISOString() };
await assert.rejects(uncertain.runTripoJob(uncertain.admin, uncertain.job), /提交結果不明/);
assert.equal(uncertain.requests.length, 0, 'An uncertain submission is left for manual review');

const ok = setup([
  reply({ status: 'running', progress: 42 }),
  reply({ status: 'success', credits_consumed: 30, output: { model_url: 'https://cdn.tripo3d.ai/model.glb' } }),
  new Response(glb),
]);
ok.job.payload.state = { submission_started: true, task_id: 'task_abc', submitted_at: new Date().toISOString() };
assert.equal(await ok.runTripoJob(ok.admin, ok.job), 'tripo_pending');
assert.equal(ok.calls.at(-1).args.p_progress, 0.42);
assert.equal(await ok.runTripoJob(ok.admin, ok.job), 'succeeded');
assert.equal(ok.uploads.length, 1);
assert.equal(ok.calls.at(-1).name, 'fds_tripo_model_complete');
assert.equal(ok.calls.at(-1).args.p_credits, 30);
assert.equal(ok.requests.filter(r => r.body).length, 0, 'Polling must not create another paid task');
const failed = setup([reply({ status: 'failed' })]);
failed.job.payload.state = { task_id: 'task_failed', submitted_at: new Date().toISOString() };
await assert.rejects(failed.runTripoJob(failed.admin, failed.job), failed.TripoStop);
assert.equal(failed.uploads.length, 0);

const cancelled = setup([reply({ status: 'success', output: { model_url: 'https://cdn.tripo3d.ai/model.glb' } }), new Response(glb)]);
cancelled.job.payload.state = { task_id: 'task_cancelled', submitted_at: new Date().toISOString() };
cancelled.admin.rpc = async () => ({ data: 'cancelled', error: null });
assert.equal(await cancelled.runTripoJob(cancelled.admin, cancelled.job), 'cancelled');
assert.equal(cancelled.uploads.length, 0, 'Cancellation must stop registration');

const invalid = setup([reply({ status: 'success', output: { model_url: 'https://cdn.tripo3d.ai/model.glb' } }), new Response('not-a-valid-model')]);
invalid.job.payload.state = { task_id: 'task_invalid', submitted_at: new Date().toISOString() };
await assert.rejects(invalid.runTripoJob(invalid.admin, invalid.job), invalid.TripoStop);
assert.equal(invalid.uploads.length, 0);
console.log('PASS: no new Tripo submission, uncertain submit left for review, existing task polls and downloads, provider failure, cancellation, invalid GLB');

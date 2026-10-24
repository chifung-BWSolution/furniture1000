import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

let handler;
const requests = [];
const analysisRequests = [];
let badAnalysis = false;
const context = {
  console: { error() {} }, URL, Request, Response, AbortSignal, atob, btoa,
  Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://fixture.supabase.co' : 'fixture' }, serve: fn => { handler = fn; } },
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) }, rpc: async () => ({ data: true }), from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { model: 'sample', description: 'E0板，枱面中央吸塑裝飾板，三位插座' } }) }) }) }) }),
  fetch: async (url, init) => {
    if (url.includes('/chat/completions')) {
      analysisRequests.push(JSON.parse(init.body));
      return Response.json({ choices: [{ message: { content: badAnalysis ? '{}' : JSON.stringify({ observed_structure: ['兩端折彎支撐，中央通空'], materials: ['E0板'], functional_details: ['三位插座'], uncertainties: ['插座位置未確認'] }) } }] });
    }
    requests.push({ url, body: JSON.parse(init.body) });
    // Stop at the provider boundary: never spend credits in this test.
    return new Response('failure', { status: 500 });
  },
};
vm.createContext(context);
const source = fs.readFileSync(new URL('../supabase/functions/generate-quote-reference-image/index.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
async function call(body) {
  requests.length = 0;
  analysisRequests.length = 0;
  return handler(new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'grok', productId: 'sample-id', prompt: '只繪製會議枱', aspectRatio: '4:3', ...body }) }));
}
const references = { referenceUrls: ['https://fixture.supabase.co/storage/v1/object/public/product-images/table.jpg'] };
const multi = { referenceUrls: [...references.referenceUrls, 'https://fixture.supabase.co/storage/v1/object/public/product-images/table-side.jpg'] };
await call(references);
assert.match(requests[0].body.prompt, /自然擺放進場景/);
await call({ ...multi, purpose: 'orthographic' });
assert.match(requests[0].body.prompt, /FRONT、RIGHT、TOP/);
assert.match(requests[0].body.prompt, /不虛構數字尺寸/);
assert.doesNotMatch(requests[0].body.prompt, /自然擺放進場景/);
assert.equal(requests[0].body.images.length, 2);
assert.equal(analysisRequests[0].messages[1].content.filter(part => part.type === 'image_url').length, 2);
assert.match(analysisRequests[0].messages[1].content[0].text, /三位插座/);
assert.match(requests[0].body.prompt, /兩端折彎支撐/);
assert.match(requests[0].body.prompt, /插座位置未確認/);
await call({ ...multi, purpose: 'orthographic', prompt: 'FORCE_ADD_CENTRAL_PANEL' });
assert.doesNotMatch(requests[0].body.prompt, /FORCE_ADD_CENTRAL_PANEL/);
await call({ ...multi, purpose: 'orthographic', prompt: '' });
assert.equal(requests.length, 1);
badAnalysis = true;
assert.equal((await call({ ...multi, purpose: 'orthographic' })).status, 502);
assert.equal(requests.length, 0, 'Analysis failure must not submit a paid drawing');
badAnalysis = false;
await call({ purpose: 'orthographic', referenceUrls: [...multi.referenceUrls, 'https://fixture.supabase.co/storage/v1/object/public/product-images/table-front.jpg'] });
assert.equal(requests[0].body.images.length, 3);
assert.equal((await call({ ...references, purpose: 'orthographic' })).status, 400);
assert.equal(requests.length, 0);
assert.equal((await call({ referenceUrls: [...multi.referenceUrls, ...multi.referenceUrls.map(s => s.replace('.jpg', '-other.jpg'))], purpose: 'orthographic' })).status, 400);
assert.equal(requests.length, 0);
assert.equal((await call({ purpose: 'orthographic' })).status, 400);
assert.equal(requests.length, 0);
assert.equal((await call({ ...references, purpose: 'unknown' })).status, 400);
assert.equal(requests.length, 0);
assert.equal((await call({ purpose: 'orthographic', referenceUrls: ['https://evil.invalid/table.jpg'] })).status, 400);
assert.equal(requests.length, 0);
console.log('PASS: scene prompt preserved; 2/3 drawing references forwarded; 0/1/4 rejected; invalid purpose and host rejected before generation.');

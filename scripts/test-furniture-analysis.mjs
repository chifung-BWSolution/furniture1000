import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

let handler;
let replies = [];
let requests = [];
const structure = { leg_count: 1, part_counts: {leg:1,top:0,seat:0,back:0,arm:0,frame:0,body:0,shelf:0,other:0}, symmetric: true, uncertainties: [] };
const defaultPart = { name: '腳', shape: 'box', role: 'leg', form: 'straight', connects_to: [], size_mm: [30,30,450], center_mm: [0,0,225] };
const context = {
  console, Request, Response, AbortSignal, atob, btoa,
  Deno: { env: { get: () => 'fixture-only' }, serve: fn => { handler = fn; } },
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } } }) }, rpc: async () => ({ data: true }) }),
  fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    assert.ok(replies.length, 'Unexpected extra AI request');
    return Response.json({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] });
  },
};
vm.createContext(context);
const source = fs.readFileSync(new URL('../supabase/functions/generate-furniture-model/index.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
async function analyze(body, responses, raw = false) {
  requests = [];
  replies = responses.map(reply => reply.parts ? { structure, ...reply } : reply);
  if (!raw && body.mode !== 'parts' && responses.length && !responses[0].parts) {
    const extraction = replies.length > 1 ? replies.pop() : { parts: [defaultPart], structure };
    replies.unshift(extraction);
  }
  const response = await handler(new Request('https://fixture.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-only', 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_scope:'single', images: ['AAAA', 'BBBB', 'CCCC'].map(image_base64 => ({ image_base64 })), ...body }),
  }));
  return { status: response.status, body: await response.json() };
}
const result = await analyze({}, [{ kind: 'side_chair', chair_base: 'four', arms: false }]);
assert.equal(result.body.style.chair_base, 'four');
assert.equal(result.body.style.arms, false);
const stool = await analyze({}, [{ kind: 'stool', leg_style: 'four' }]);
assert.equal(stool.body.style.legs, 'four');
const customPart = defaultPart;
const custom = await analyze({ width_mm: 500, depth_mm: 500, height_mm: 850 }, [{ kind: 'custom' }, { parts: [customPart] }]);
assert.equal(custom.status, 200);
assert.equal(custom.body.kind, 'custom');
assert.deepEqual(custom.body.parts, [customPart]);
assert.equal(requests.length, 2, 'Custom structures must use the existing part extraction route');
assert.ok(requests[0].messages[1].content.at(-1).text.includes('width 500 mm'));
assert.ok(requests[0].messages[0].content.includes('Identify structure BEFORE'));
assert.equal(custom.body.structure.leg_count, 1);
for (const parts of [[], Array(31).fill(customPart)]) {
  const invalid = await analyze({ mode: 'parts' }, [{ parts }]);
  assert.equal(invalid.status, 502, 'Do not silently truncate or accept an empty list');
}
console.log('PASS: Edge handler preserves base choices, custom extraction, confirmed dimensions, and rejects incomplete lists (mocked Grok)');
for (const mode of ['classify', 'parts']) {
  for (const images of [[], [{ image_base64: 'AAAA' }], ['AAAA', 'AAAA', 'AAAA'].map(image_base64 => ({ image_base64 })), ['AAAA', 'AA AA'].map(image_base64 => ({ image_base64 }))]) {
    const rejected = await analyze({ mode, images }, []);
    assert.equal(rejected.status, 400);
    assert.equal(requests.length, 0, 'Invalid reference sets must not incur an AI call');
  }
}
const legacy = await analyze({ images: undefined, image_base64: 'AAAA' }, []);
assert.equal(legacy.status, 400, 'Legacy single-image requests cannot bypass the minimum');
const pair = await analyze({ images: ['AAAA', 'BBBB'].map(image_base64 => ({ image_base64 })) }, [{ kind: 'side_chair', chair_base: 'four', arms: false }]);
assert.equal(pair.status, 200);
assert.equal(pair.body.structure.leg_count, 1, 'Two distinct views must still return structure evidence');
for (const extraction of [{ parts:[defaultPart],structure:{} }, { parts:[{ ...defaultPart, role:undefined }],structure }]) {
  const invalid=await analyze({},[extraction,{kind:'side_chair'}]);
  assert.equal(invalid.status,502,'Incomplete structural evidence must never fall back to a template');
  assert.equal(requests.length,1);
}
console.log('PASS: classify and parts reject missing, unreadable-count and duplicate references before Grok');
const detection={product_count:2,possible_arrangement:true,uncertain:false,reason:'同一場景有兩張同款椅',per_image_counts:[2,2,1]};
for(const count of [detection,{...detection,product_count:1,possible_arrangement:false,uncertain:true,per_image_counts:[1,1,1]}]) {
  const pending=await analyze({product_scope:undefined},[count],true);
  assert.equal(pending.body.requires_product_scope_confirmation,true);
  assert.equal(requests.length,1,'Never start extraction before the user decides');
}
const unit=await analyze({product_scope:undefined},[{...detection,product_count:1,possible_arrangement:false,per_image_counts:[1,1,1]},{parts:[defaultPart]},{kind:'side_chair',chair_base:'four'}],true);
assert.equal(unit.body.kind,'side_chair');
assert.equal(requests.length,3);
assert.ok(requests[0].messages[0].content.includes('Do not add counts across images'));
const group=await analyze({product_scope:'arrangement',product_count:2},[{parts:[{...defaultPart,product_index:0},{...defaultPart,product_index:1}],structure:{...structure,leg_count:2,part_counts:{...structure.part_counts,leg:2}}}],true);
assert.equal(group.body.kind,'custom');
assert.equal(group.body.structure.product_count,2);
assert.equal(requests.length,1);
assert.ok(requests[0].messages[1].content.at(-1).text.includes('GROUP of 2'));
const mismatch=await analyze({product_scope:'arrangement',product_count:2},[{parts:[{...defaultPart,product_index:0}]}],true);
assert.equal(mismatch.status,502);
const invalidCount=await analyze({product_scope:'arrangement',product_count:1},[],true);
assert.equal(invalidCount.status,400);
assert.equal(requests.length,0);
console.log('PASS: repeated-product confirmation, uncertain scenes, no summing across views, explicit single/group scope, and group instance counts');
const inferred = await analyze({ mode: 'parts', inferred_reference: { image_base64: 'DDDD', mime_type: 'image/jpeg' } }, [{ parts: [defaultPart] }], true);
assert.equal(inferred.status, 200);
assert.equal(requests[0].messages[1].content.filter(part => part.type === 'image_url').length, 4);
assert.match(requests[0].messages[1].content.at(-1).text, /AI-INFERRED/);
assert.match(requests[0].messages[1].content.at(-1).text, /ORIGINAL product photographs take priority/);
const onlyOne = await analyze({ images: [{ image_base64: 'AAAA' }], inferred_reference: { image_base64: 'DDDD' } }, [], true);
assert.equal(onlyOne.status, 400, 'Inferred drawing cannot replace the second original photograph');
assert.equal(requests.length, 0);
console.log('PASS: inferred sheet reaches extraction with provenance and never satisfies the original photograph minimum');

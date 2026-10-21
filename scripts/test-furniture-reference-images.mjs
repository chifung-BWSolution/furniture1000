import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Exercise the real browser preparation function without mounting the product page.
const source = fs.readFileSync(new URL('../src/components/dashboard/FurnitureSearchView.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'analyzeProductImages');
const structure = { leg_count: 4, symmetric: true, uncertainties: [], part_counts: { leg: 4 } };
const flags = { legacyFirst: false };
let calls = [];
const context = {
  File,
  fileToJpeg: async file => Buffer.from(await file.arrayBuffer()).toString('base64'),
  hasStructureEvidence: (value) => !!value && Number.isInteger(value.leg_count) && typeof value.symmetric === 'boolean' && Array.isArray(value.uncertainties),
  fetch: async url => {
    if (url === 'broken') throw new Error('unreadable');
    return new Response(url);
  },
  invokeEdgeFunctionDirect: async (slug, body) => {
    calls.push({ slug, body });
    if (flags.legacyFirst && slug === 'supabase-functions-generate-furniture-model') {
      return { data: { supported: true, kind: 'desk', estimated: true, width_mm: 1200 }, status: 200 };
    }
    return { data: { supported: true, kind: 'side_chair', structure }, status: 200 };
  },
};
vm.createContext(context);
vm.runInContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
for (const references of [[], ['one'], ['one', 'one']]) {
  calls = [];
  await assert.rejects(context.analyzeProductImages(references), /最少 2 張/);
  assert.equal(calls.length, 0, 'Insufficient readable distinct images must never call the server');
}
calls = [];
const recognized = await context.analyzeProductImages(['one', new File(['two'], 'side.jpg', { type: 'image/jpeg' })]);
assert.equal(calls.length, 1, 'A response that already includes structure must not call the fallback slug');
assert.equal(calls[0].body.images.length, 2);
assert.equal(calls[0].slug, 'supabase-functions-generate-furniture-model');
assert.equal(recognized.structure.leg_count, 4);
calls = [];
await context.analyzeProductImages(['one', 'one', 'two', 'broken', 'three', 'four', 'five', 'six', 'seven']);
assert.equal(calls[0].body.images.length, 6);
flags.legacyFirst = true;
calls = [];
const recovered = await context.analyzeProductImages(['front', 'side']);
assert.equal(calls.map(call => call.slug).join(','), 'supabase-functions-generate-furniture-model,generate-furniture-model');
assert.equal(recovered.structure.leg_count, 4, 'Legacy classifier payload must not hide a later response that includes structure');
console.log('PASS: browser preparation rejects missing/duplicate/broken references, accepts two supplemental files, caps distinct views at six, and recovers structure from the bare slug');

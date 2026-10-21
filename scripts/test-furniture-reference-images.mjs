import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Exercise the real browser preparation function without mounting the product page.
const source = fs.readFileSync(new URL('../src/components/dashboard/FurnitureSearchView.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'analyzeProductImages');
let calls = [];
const context = {
  File,
  fileToJpeg: async file => Buffer.from(await file.arrayBuffer()).toString('base64'),
  fetch: async url => {
    if (url === 'broken') throw new Error('unreadable');
    return new Response(url);
  },
  invokeEdgeFunctionDirect: async (slug, body) => {
    calls.push({ slug, body });
    return { data: { supported: true, kind: 'side_chair' }, status: 200 };
  },
};
vm.createContext(context);
vm.runInContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
for (const references of [[], ['one'], ['one', 'two'], ['one', 'one', 'two'], ['one', 'two', 'broken']]) {
  calls = [];
  await assert.rejects(context.analyzeProductImages(references), /最少 3 張/);
  assert.equal(calls.length, 0, 'Insufficient readable distinct images must never call the server');
}
calls = [];
await context.analyzeProductImages(['one', new File(['two'], 'side.jpg', { type: 'image/jpeg' }), 'three']);
assert.equal(calls[0].body.images.length, 3);
assert.equal(calls[0].slug, 'supabase-functions-generate-furniture-model');
calls = [];
await context.analyzeProductImages(['one', 'one', 'two', 'broken', 'three', 'four', 'five', 'six', 'seven']);
assert.equal(calls[0].body.images.length, 6);
console.log('PASS: browser preparation rejects missing/duplicate/broken references, accepts supplemental files, and caps distinct views at six');

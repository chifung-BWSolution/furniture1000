import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Execute the real event handlers without coupling this regression test to
// the dashboard's network requests, rendering or unrelated pagination state.
const file = ts.createSourceFile('review.tsx', fs.readFileSync('src/components/dashboard/ExtractionReviewView.tsx', 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let batch;
const clicks = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleBatch') batch = node.initializer.getText(file);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'StatTile') {
    const attr = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(file) === 'onClick');
    if (attr) clicks.push(attr.initializer.expression.getText(file));
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(clicks.length, 4);
function compile(expression, globals) {
  const context = { ...globals, Set, handler: null };
  vm.runInNewContext(ts.transpileModule(`handler = ${expression}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.handler;
}
for (const click of clicks) {
  let selected = new Set(['hidden']);
  compile(click, { setFilter() {}, setQuery() {}, setSelected(value) { selected = value; } })();
  assert.equal(selected.size, 0, 'every statistic filter clears selection');
}
let submitted;
const handleBatch = compile(batch, {
  selected: new Set(['hidden', 'visible']), selectable: [{ id: 'visible' }], doc: null,
  setBusy() {}, setSelected() {}, applyLocal() {}, errorText: String,
  toast: { success() {}, error(message) { assert.fail(message); } },
  async reviewExtractionItemsBatch(ids, status) { submitted = { ids, status }; return { updated: ids.length, blocked: 0 }; },
});
await handleBatch('rejected');
assert.deepEqual(Array.from(submitted.ids), ['visible']);
assert.equal(submitted.status, 'rejected');
console.log('PASS: all statistic filters clear selection; batch review excludes hidden items');

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Exercise the component's actual async callbacks with deferred API responses.
const source = fs.readFileSync('src/components/dashboard/ExtractionReviewView.tsx', 'utf8');
const ast = ts.createSourceFile('review.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['reloadItems', 'loadMoreItems'].includes(node.name.getText(ast))) {
    callbacks.set(node.name.getText(ast), node.initializer.arguments[0].getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(callbacks.size, 2);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function rows(start = 0, count = 100) {
  return Array.from({ length: count }, (_, index) => ({ id: `item-${start + index}` }));
}
function harness() {
  const state = { items: [], errors: [] };
  const calls = [];
  let fetchPage = async () => rows();
  const context = {
    docId: 'A', REVIEW_PAGE_SIZE: 100, itemsRequestRef: { current: {} },
    listExtractionItems(id, offset, limit) {
      calls.push({ id, offset, limit });
      return fetchPage(id, offset, limit);
    },
    listExtractionImages: async () => [],
    errorText: error => error.message,
    toast: { error: (...args) => state.errors.push(args) },
  };
  for (const name of ['Items', 'Images', 'HasMoreItems', 'LoadingItems', 'LoadingMoreItems', 'LoadMoreError', 'ItemsError']) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  const code = [...callbacks].map(([name, callback]) => `const ${name} = ${callback};`).join('\n');
  const compiled = ts.transpileModule(`${code}\nglobalThis.api = { reloadItems, loadMoreItems };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, context);
  return { state, calls, context, ...context.api, setFetcher(value) { fetchPage = value; } };
}

// A failing page must stop automatic observer/search calls until explicit retry.
const failed = harness();
await failed.reloadItems('A');
failed.setFetcher(async () => { throw Error('offline'); });
await failed.loadMoreItems();
for (let index = 0; index < 5; index++) await failed.loadMoreItems();
assert.equal(failed.calls.length, 2);
assert.equal(failed.state.errors.length, 1);
assert.equal(failed.state.loadMoreError, 'offline');
assert.equal(failed.state.loadingMoreItems, false);
assert.equal(failed.state.items.length, 100);
failed.setFetcher(async () => rows(100, 7));
await failed.loadMoreItems(true);
assert.equal(failed.calls.at(-1).offset, 100);
assert.equal(failed.state.items.length, 107);
assert.equal(failed.state.loadMoreError, null);
assert.equal(failed.state.hasMoreItems, false);

// Reload while an old page is pending, then finish it while a new page is pending.
// The old finally must not unlock the new request or erase its loading state.
for (const oldFails of [false, true]) {
  const race = harness();
  await race.reloadItems('A');
  const oldPage = deferred();
  race.setFetcher(() => oldPage.promise);
  const oldRequest = race.loadMoreItems();
  race.setFetcher(async () => rows());
  await race.reloadItems('A');
  assert.equal(race.state.loadingMoreItems, false);
  const newPage = deferred();
  race.setFetcher(() => newPage.promise);
  const newRequest = race.loadMoreItems();
  if (oldFails) oldPage.reject(Error('old request failed'));
  else oldPage.resolve(rows(100));
  await oldRequest;
  assert.equal(race.state.loadingMoreItems, true);
  assert.equal(race.state.loadMoreError, null);
  assert.equal(race.state.errors.length, 0);
  const before = race.calls.length;
  await race.loadMoreItems();
  assert.equal(race.calls.length, before);
  newPage.resolve(rows(100));
  await newRequest;
  assert.equal(race.state.loadingMoreItems, false);
  assert.equal(race.state.items.length, 200);
  race.setFetcher(async () => rows(200, 1));
  await race.loadMoreItems();
  assert.equal(race.calls.at(-1).offset, 200);
  assert.equal(new Set(race.state.items.map(item => item.id)).size, 201);
}

// A stale document callback must not start a request for the current document.
const switched = harness();
await switched.reloadItems('B');
await switched.loadMoreItems();
assert.equal(switched.calls.length, 1);

// Verify URL rendering passes both options required by PDF.js for on-demand reads.
let pdfOptions;
let destroyed = false;
const pdf = {
  numPages: 2,
  async getPage() {
    return { getViewport: () => ({ width: 100, height: 200 }), render: () => ({ promise: Promise.resolve() }), cleanup() {} };
  },
  async destroy() { destroyed = true; },
};
const pdfContext = {
  exports: {}, Blob,
  require(id) {
    assert.equal(id, 'pdfjs-dist');
    return { version: 'test', GlobalWorkerOptions: {}, getDocument(options) { pdfOptions = options; return { promise: Promise.resolve(pdf) }; } };
  },
  document: { createElement: () => ({ getContext: () => ({}), toBlob: callback => callback(new Blob(['jpeg'])) }) },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/floorPlanPdf.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, pdfContext);
await pdfContext.exports.renderPdfPageToJpegBlob('https://example.invalid/private.pdf', 2);
assert.equal(pdfOptions.disableStream, true);
assert.equal(pdfOptions.disableAutoFetch, true);
assert.equal(destroyed, true);
console.log('PASS: pagination failure/retry, stale requests, offsets, PDF demand-loading options');

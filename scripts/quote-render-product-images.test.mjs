import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
function setup(verdicts, broken = false) {
  let edits = 0;
  const seen = [];
  const source = fs.readFileSync(new URL('../src/lib/quoteRenderProductImages.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', '({})');
  const exports = {};
  const mocks = {
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } } },
    './productSearch': { fetchProductDetail: async () => ({ images: ['https://example.com/scene.jpg', 'https://example.com/white.jpg'] }) },
    './quoteFloorPlan': { imageBlobToJpegBase64: async () => 'test-image' },
    './quotePhotoLibrary': { generateQuoteReferenceImage: async () => { edits++; return { url: 'https://example.com/cutout.jpg' }; } },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: id => mocks[id] || {}, crypto: webcrypto, TextEncoder, AbortSignal,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async url => {
      if (url.includes('gemini-proxy')) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ photos: verdicts.shift() }) }] } }] }) };
      seen.push(url);
      if (broken && url.endsWith('white.jpg')) throw Error('unavailable');
      return { ok: true, blob: async () => ({}) };
    },
  });
  return { api: exports, edits: () => edits, seen };
}
const row = (index, plain) => ({ index, matches: true, single: plain, plain, complete: true });
const product = { id: 'quote-row', productId: 'catalog-id', name: 'Desk', image: 'https://example.com/scene.jpg', quantity: 1 };
test('automatically switches from scene to another existing white single-product photo', async () => {
  const x = setup([[row(0, false), row(1, true)]]);
  const result = await x.api.automaticLayoutProducts([product], null);
  assert.equal(result[0].image, 'https://example.com/white.jpg');
  assert.equal(x.edits(), 0);
  assert.equal(product.image, 'https://example.com/scene.jpg');
});
test('only edits background after all existing photos fail, and validates the result', async () => {
  const x = setup([[row(0, false), row(1, false)], [row(0, true)]]);
  const result = await x.api.automaticLayoutProducts([product], null);
  assert.equal(result[0].image, 'https://example.com/cutout.jpg');
  assert.equal(x.edits(), 1);
});
test('unreadable gallery photos do not trigger paid background editing', async () => {
  const x = setup([[row(0, false)]], true);
  await assert.rejects(x.api.automaticLayoutProducts([product], null), /圖片讀取失敗/);
  assert.equal(x.edits(), 0);
});
test('white background is insufficient when the product is mismatched or incomplete', () => {
  const x = setup([]);
  assert.equal(x.api.suitableProductPhoto([{ ...row(0, true), matches: false }, { ...row(1, true), complete: false }], 2), null);
  assert.equal(x.api.suitableProductPhoto([row(9, true)], 2), null);
});

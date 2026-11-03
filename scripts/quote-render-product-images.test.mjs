import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
function setup(verdicts, broken = false, dimensions = {}) {
  let edits = 0;
  const seen = [];
  const source = fs.readFileSync(new URL('../src/lib/quoteRenderProductImages.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', '({})');
  const exports = {};
  const mocks = {
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } } },
    './productSearch': { fetchProductDetail: async () => ({ ...dimensions, images: ['https://example.com/scene.jpg', 'https://example.com/white.jpg'] }) },
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


test('uses catalog dimensions when quote dimensions are blank and keeps original rows unchanged', async () => {
  const x = setup([[row(0, true), row(1, false)]], false, { dimension_l_mm: 1800, dimension_w_mm: 800, dimension_h_mm: 750 });
  const [chosen] = await x.api.automaticLayoutProducts([product], null);
  assert.equal(chosen.dimensionLMm, '1800');
  assert.equal(chosen.dimensionWMm, '800');
  assert.equal(chosen.dimensionHMm, '750');
  assert.equal(product.dimensionLMm, undefined);
  const constraints = x.api.renderDimensionConstraints(chosen);
  assert.equal(constraints.unit, 'mm');
  assert.equal(constraints.proportions.lengthToWidth, 2.25);
  assert.equal(constraints.proportions.lengthToHeight, 2.4);
});
test('preserves quote variant dimensions and does not fill gaps from another catalog size', () => {
  const x = setup([]);
  const chosen = x.api.resolveRenderDimensions({ ...product, dimensionLMm: '2400', dimensionWMm: '1000' }, { dimension_l_mm: 1800, dimension_w_mm: 800, dimension_h_mm: 750 });
  assert.equal(chosen.dimensionLMm, '2400');
  assert.equal(chosen.dimensionWMm, '1000');
  assert.equal(chosen.dimensionHMm, null);
  assert.equal(x.api.renderDimensionConstraints(chosen).proportions.lengthToHeight, null);
});
test('fills missing axes only when known quote dimensions match catalog and rejects invalid millimeters', () => {
  const x = setup([]);
  const chosen = x.api.resolveRenderDimensions({ ...product, dimensionLMm: '1800' }, { dimension_l_mm: 1800, dimension_w_mm: 800, dimension_h_mm: 750 });
  assert.equal(chosen.dimensionWMm, '800');
  for (const value of ['0', '-100', '180cm', '1200-1800', 'Infinity']) assert.throws(() => x.api.resolveRenderDimensions({ ...product, dimensionLMm: value }, null), /毫米數值/);
});

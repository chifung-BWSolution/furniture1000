import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';

function setup({ mainUrl = 'https://example.com/white.jpg', galleryUrls = ['https://example.com/scene.jpg'], plainUrls = [], broken = false, cutoutPlain = true, dimensions = {} } = {}) {
  let edits = 0;
  const seen = [];
  const source = fs.readFileSync(new URL('../src/lib/quoteRenderProductImages.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', '({})');
  const exports = {};
  const isPlain = url => (url.includes('cutout') ? cutoutPlain : plainUrls.some(plain => url.includes(plain)));
  let drawn = '';
  const mocks = {
    './productSearch': { fetchProductDetail: async () => ({ ...dimensions, images: [mainUrl, ...galleryUrls] }) },
    './quotePhotoLibrary': { generateQuoteReferenceImage: async () => { edits++; return { url: 'https://example.com/cutout.jpg' }; } },
  };
  const pixels = plain => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const value = plain ? 255 : 20;
      data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
    }
    return data;
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    require: id => mocks[id] || {},
    crypto: webcrypto,
    TextEncoder,
    AbortSignal,
    localStorage: { getItem: () => null, setItem: () => {} },
    createImageBitmap: async blob => ({ width: 100, height: 100, url: blob.url, close() {} }),
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: bitmap => { drawn = bitmap.url || ''; },
          getImageData: () => ({ data: pixels(isPlain(drawn)) }),
        }),
      }),
    },
    fetch: async url => {
      seen.push(url);
      if (broken) throw Error('unavailable');
      return { ok: true, blob: async () => ({ url: String(url) }) };
    },
  });
  return { api: exports, edits: () => edits, seen };
}

const product = { id: 'quote-row', productId: 'catalog-id', name: 'Desk', image: 'https://example.com/white.jpg', quantity: 1 };

test('uses the product main photo as-is when its background is already plain', async () => {
  const x = setup({ plainUrls: ['white.jpg'] });
  const result = await x.api.automaticLayoutProducts([product], null);
  assert.equal(result[0].image, 'https://example.com/white.jpg');
  assert.equal(x.edits(), 0);
  assert.equal(product.image, 'https://example.com/white.jpg');
});

test('cuts out the main photo only when it has no plain background', async () => {
  const x = setup({ cutoutPlain: true });
  const result = await x.api.automaticLayoutProducts([product], null);
  assert.equal(result[0].image, 'https://example.com/cutout.jpg');
  assert.equal(x.edits(), 1);
});

test('never falls back to a plain gallery photo from the second image onward', async () => {
  const x = setup({
    mainUrl: 'https://example.com/scene.jpg',
    galleryUrls: ['https://example.com/gallery-white.jpg'],
    plainUrls: ['gallery-white.jpg'],
  });
  const result = await x.api.automaticLayoutProducts([product], null);
  assert.equal(result[0].image, 'https://example.com/cutout.jpg');
  assert.equal(x.edits(), 1);
});

test('rejects a cutout whose background is not plain', async () => {
  const x = setup({ cutoutPlain: false });
  await assert.rejects(x.api.automaticLayoutProducts([product], null), /純色背景/);
});

test('unreadable main photos do not trigger paid background editing', async () => {
  const x = setup({ broken: true });
  await assert.rejects(x.api.automaticLayoutProducts([product], null), /主圖讀取失敗/);
  assert.equal(x.edits(), 0);
});

test('plainBackground accepts white and transparent borders but not a scene border', () => {
  const x = setup();
  const solid = (r, g, b, a = 255) => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; }
    return data;
  };
  assert.equal(x.api.plainBackground(solid(255, 255, 255), 64, 64), true);
  assert.equal(x.api.plainBackground(solid(0, 0, 0, 0), 64, 64), true);
  assert.equal(x.api.plainBackground(solid(120, 90, 60), 64, 64), false);
  const mixed = solid(255, 255, 255);
  for (let i = 0; i < mixed.length / 4; i += 1) { mixed[i * 4] = 30; mixed[i * 4 + 1] = 30; mixed[i * 4 + 2] = 30; }
  assert.equal(x.api.plainBackground(mixed, 64, 64), false, 'a scene border must not pass');
});

test('uses catalog dimensions when quote dimensions are blank and keeps original rows unchanged', async () => {
  const x = setup({ plainUrls: ['white.jpg'], dimensions: { dimension_l_mm: 1800, dimension_w_mm: 800, dimension_h_mm: 750 } });
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
  const x = setup();
  const chosen = x.api.resolveRenderDimensions({ ...product, dimensionLMm: '2400', dimensionWMm: '1000' }, { dimension_l_mm: 1800, dimension_w_mm: 800, dimension_h_mm: 750 });
  assert.equal(chosen.dimensionLMm, '2400');
  assert.equal(chosen.dimensionWMm, '1000');
  assert.equal(chosen.dimensionHMm, null);
  assert.equal(x.api.renderDimensionConstraints(chosen).proportions.lengthToHeight, null);
});

test('fills missing axes only when known quote dimensions match catalog and rejects invalid millimeters', () => {
  const x = setup();
  const chosen = x.api.resolveRenderDimensions({ ...product, dimensionLMm: '1800' }, { dimension_l_mm: 1800, dimension_w_mm: 800, dimension_h_mm: 750 });
  assert.equal(chosen.dimensionWMm, '800');
  for (const value of ['0', '-100', '180cm', '1200-1800', 'Infinity']) assert.throws(() => x.api.resolveRenderDimensions({ ...product, dimensionLMm: value }, null), /毫米數值/);
});

// Exercise the real loader with deterministic browser/network stand-ins.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import * as fontkit from 'fontkit';

const root = process.cwd();
const directory = path.join(root, 'tmp', 'pdf-loader-test');
await fs.mkdir(directory, { recursive: true });
const source = await fs.readFile('src/components/dashboard/QuotationPDFPreview.tsx', 'utf8');
const code = source.replace(/^import[\s\S]*?;\s*/gm, '') + `
const createCanvasTextMeasure = () => null;
const setPdfTextMeasure = () => {};
export { loadReactPdfModule, resolveFontBlobUrl, PDF_FONT_FACES };
`;
const compiled = await transform(code, { loader: 'tsx', format: 'esm', jsx: 'automatic' });
const modulePath = path.join(directory, 'loader.mjs');
await fs.writeFile(modulePath, compiled.code);

let bytes = 0;
let requests = 0;
let activeFaces = 0;
let maxActiveFaces = 0;
globalThis.window = globalThis;
globalThis.document = { fonts: { add() {} } };
globalThis.FontFace = class {
  async load() {
    activeFaces++;
    maxActiveFaces = Math.max(maxActiveFaces, activeFaces);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeFaces--;
    return this;
  }
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).startsWith('blob:')) return nativeFetch(url);
  requests++;
  assert(String(url).startsWith('/fonts/pdf/'), 'healthy self-hosted fonts should not contact mirrors');
  const data = await fs.readFile(path.join(root, 'public', String(url)));
  bytes += data.byteLength;
  return new Response(data);
};

const loader = await import(pathToFileURL(modulePath));
const before = performance.now();
const [first, second] = await Promise.all([loader.loadReactPdfModule(), loader.loadReactPdfModule()]);
assert.equal(first, second, 'concurrent engine initializations must share a module');
const coldRequests = requests;
await loader.loadReactPdfModule();
assert.equal(requests, coldRequests, 'warm initialization must not download fonts again');
console.log(JSON.stringify({ bytes, requests, maxActiveFaces, elapsedMs: Math.round(performance.now() - before) }));
assert(bytes <= 9 * 1024 * 1024, 'PDF startup downloads more than 9 MiB of fonts');
assert(maxActiveFaces >= 2, 'measurement font loading is serialized');

// Parse through the real renderer too; registration alone does not validate fonts.
for (const weight of [400, 700]) {
  // Node's renderer treats blob: as a file path; browsers fetch it directly.
  for (const fontFamily of ['NotoSansTC', 'NotoSansHK']) {
    const source = first.Font.getFont({ fontFamily, fontWeight: weight });
    const response = await nativeFetch(source.src);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (fontFamily === 'NotoSansTC') {
      const label = weight === 400 ? 'Regular' : 'Bold';
      assert.deepEqual(bytes, await fs.readFile(`public/fonts/pdf/NotoSansTC-${label}.ttf`),
        'transport decompression must restore the original TTF exactly');
    }
    source.src = 'data:font/ttf;base64,' + bytes.toString('base64');
  }
  await Promise.all(['NotoSansTC', 'NotoSansHK'].map((fontFamily) => first.Font.load({ fontFamily, fontWeight: weight })));
  const tc = first.Font.getFont({ fontFamily: 'NotoSansTC', fontWeight: weight }).data;
  const hk = first.Font.getFont({ fontFamily: 'NotoSansHK', fontWeight: weight }).data;
  const label = weight === 400 ? 'Regular' : 'Bold';
  const originalTc = fontkit.create(await fs.readFile(`public/fonts/pdf/NotoSansTC-${label}.ttf`));
  const originalHk = fontkit.create(await fs.readFile(`public/fonts/pdf/NotoSansHK-${label}.ttf`));
  assert.deepEqual(new Set([...tc.characterSet, ...hk.characterSet]),
    new Set([...originalTc.characterSet, ...originalHk.characterSet]), 'font Unicode coverage changed');
  assert(tc.hasGlyphForCodePoint(0x67b1), 'HK furniture character missing');
  for (const code of originalTc.characterSet) {
    assert.equal(tc.glyphForCodePoint(code).advanceWidth, originalTc.glyphForCodePoint(code).advanceWidth,
      'TC glyph advance changed');
  }
  for (const code of hk.characterSet) {
    assert.equal(hk.glyphForCodePoint(code).advanceWidth, originalHk.glyphForCodePoint(code).advanceWidth,
      'HK fallback glyph advance changed');
    assert.equal(hk.glyphForCodePoint(code).path.toSVG(), originalHk.glyphForCodePoint(code).path.toSVG(),
      'HK fallback glyph outline changed');
  }
}
console.log('Renderer font parsing, complete TC/HK coverage and TC glyph widths passed for both weights.');

// A fresh loader must coalesce simultaneous requests for the same font too.
const fresh = await import(pathToFileURL(modulePath).href + '?fresh=1');
const count = requests;
await Promise.all([fresh.resolveFontBlobUrl(fresh.PDF_FONT_FACES[0]), fresh.resolveFontBlobUrl(fresh.PDF_FONT_FACES[0])]);
assert.equal(requests - count, 1, 'in-flight font downloads must be shared');

const nativeDecompression = globalThis.DecompressionStream;
try {
  globalThis.DecompressionStream = undefined;
  const legacy = await import(pathToFileURL(modulePath).href + '?legacy=1');
  const count = requests;
  const url = await legacy.resolveFontBlobUrl(legacy.PDF_FONT_FACES[0]);
  assert.equal(requests - count, 1, 'legacy browsers must skip compressed assets');
  assert.deepEqual(Buffer.from(await (await nativeFetch(url)).arrayBuffer()),
    await fs.readFile('public/fonts/pdf/NotoSansTC-Regular.ttf'));
} finally {
  globalThis.DecompressionStream = nativeDecompression;
}
console.log('PDF loader: cold payload, parallel fonts, shared initialization and warm cache passed.');
await fs.rm(modulePath, { force: true });

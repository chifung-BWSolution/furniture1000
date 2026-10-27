import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import * as pdfLib from 'pdf-lib';
import { getDocumentProxy, extractImages } from 'unpdf';
import jpeg from 'jpeg-js';
import { collectPdfPageImages, createPdfImageNormalizer } from './pdfImageColor.mjs';

const normalize = createPdfImageNormalizer({ pdfLib, getDocumentProxy, extractImages, encodeJpeg: jpeg.encode });

async function fixtureImage({ bytes, colorSpace = 'DeviceCMYK', decode, mask, width = 16, height = 16, filter = 'DCTDecode' }) {
  const doc = await pdfLib.PDFDocument.create();
  const dict = { Type: 'XObject', Subtype: 'Image', Width: width, Height: height,
    BitsPerComponent: 8, ColorSpace: colorSpace, ...(filter ? { Filter: filter } : {}),
    ...(decode ? { Decode: decode } : {}), ...(mask ? { SMask: mask(doc) } : {}) };
  const stream = doc.context.stream(bytes, dict);
  return { doc, image: { bytes, stream, resources: undefined, width, height } };
}

function centerRgb(bytes) {
  const image = jpeg.decode(bytes, { useTArray: true });
  const at = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
  return Array.from(image.data.subarray(at, at + 3));
}

test('PDF CMYK JPEG is decoded with PDF color semantics instead of returning its dark raw stream', async () => {
  const bytes = new Uint8Array(await fs.readFile(new URL('./fixtures/cmyk-light.jpg', import.meta.url)));
  const { doc, image } = await fixtureImage({ bytes });
  const result = await normalize(doc, image);
  const rgb = centerRgb(result);
  assert.ok(rgb.every(c => c > 150), `Expected light PDF colors; got ${rgb}`);
});

test('ordinary RGB JPEG retains its colors', async () => {
  const rgba = Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => [180, 120, 60, 255][i % 4]);
  const bytes = new Uint8Array(jpeg.encode({ width: 16, height: 16, data: rgba }, 95).data);
  const { doc, image } = await fixtureImage({ bytes, colorSpace: 'DeviceRGB' });
  const actual = centerRgb(await normalize(doc, image));
  actual.forEach((value, i) => assert.ok(Math.abs(value - [180, 120, 60][i]) < 5, String(actual)));
});

test('gray /Decode inversion is applied before JPEG encoding', async () => {
  const { doc, image } = await fixtureImage({ bytes: new Uint8Array(256).fill(25),
    colorSpace: 'DeviceGray', decode: [1, 0], filter: null });
  const actual = centerRgb(await normalize(doc, image));
  assert.ok(actual.every(c => Math.abs(c - 230) < 5), String(actual));
});

test('named indexed color space is resolved from the image resources', async () => {
  const { doc, image } = await fixtureImage({ bytes: new Uint8Array(256).fill(1), colorSpace: 'Palette', filter: null });
  image.resources = doc.context.obj({ ColorSpace: { Palette: ['Indexed', 'DeviceRGB', 1,
    pdfLib.PDFHexString.of('000000c86432')] } });
  const actual = centerRgb(await normalize(doc, image));
  actual.forEach((value, i) => assert.ok(Math.abs(value - [200, 100, 50][i]) < 5, String(actual)));
});

test('Lab color values are converted to RGB', async () => {
  const { doc, image } = await fixtureImage({
    bytes: Uint8Array.from({ length: 256 * 3 }, (_, i) => [230, 128, 128][i % 3]), filter: null });
  image.stream.dict.set(pdfLib.PDFName.of('ColorSpace'), doc.context.obj(['Lab', { WhitePoint: [0.9505, 1, 1.089] }]));
  const actual = centerRgb(await normalize(doc, image));
  assert.ok(actual.every(c => c > 200), String(actual));
});

test('soft-mask transparency is composited onto white instead of black', async () => {
  const { doc, image } = await fixtureImage({ colorSpace: 'DeviceRGB', filter: null,
    bytes: Uint8Array.from({ length: 256 * 3 }, (_, i) => [200, 0, 0][i % 3]),
    mask: d => d.context.register(d.context.stream(new Uint8Array(256).fill(128), {
      Type: 'XObject', Subtype: 'Image', Width: 16, Height: 16, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
    })),
  });
  const actual = centerRgb(await normalize(doc, image));
  actual.forEach((value, i) => assert.ok(Math.abs(value - [227, 127, 127][i]) < 6, String(actual)));
});

test('images of the same size keep their own decode settings', async () => {
  const first = await fixtureImage({ bytes: new Uint8Array(256).fill(25), colorSpace: 'DeviceGray', filter: null });
  const second = await fixtureImage({ bytes: new Uint8Array(256).fill(25), colorSpace: 'DeviceGray', decode: [1, 0], filter: null });
  assert.ok(centerRgb(await normalize(first.doc, first.image)).every(c => c < 30));
  assert.ok(centerRgb(await normalize(second.doc, second.image)).every(c => c > 225));
});

test('unsupported/corrupt data fails instead of returning the raw PDF stream', async () => {
  const { doc, image } = await fixtureImage({ bytes: new Uint8Array([1, 2, 3]) });
  await assert.rejects(normalize(doc, image));
  await assert.rejects(normalize(doc, { ...image, width: 100_000 }));
});

test('catalogue page 10 matches PDF-decoded colors', { skip: !process.env.FDS_PDF_COLOR_FIXTURE }, async () => {
  const input = new Uint8Array(await fs.readFile(process.env.FDS_PDF_COLOR_FIXTURE));
  const doc = await pdfLib.PDFDocument.load(input);
  const pdf = await getDocumentProxy(input.slice(), { isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    wasmUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/' });
  try {
    const expected = await extractImages(pdf, 10);
    const images = collectPdfPageImages(pdfLib, doc, 10).filter(i => i.width >= 200 && i.height >= 200);
    assert.equal(images.length, 3);
    let originalError = 0;
    for (const image of images) {
      const reference = expected.find(i => i.width === image.width && i.height === image.height);
      assert.ok(reference, 'reference image exists');
      const result = await normalize(doc, image);
      const corrected = jpeg.decode(result, { useTArray: true });
      const original = jpeg.decode(image.bytes, { useTArray: true });
      let total = 0, samples = 0;
      for (let y = 10; y < image.height; y += 37) for (let x = 10; x < image.width; x += 37) {
        const pixel = y * image.width + x;
        for (let c = 0; c < 3; c++) {
          total += Math.abs(corrected.data[pixel * 4 + c] - reference.data[pixel * reference.channels + c]);
          originalError += Math.abs(original.data[pixel * 4 + c] - reference.data[pixel * reference.channels + c]);
          samples++;
        }
      }
      assert.ok(total / samples < 8, `JPEG RGB error too high: ${total / samples}`);
      if (process.env.FDS_PDF_COLOR_OUTPUT && image === images[0]) await fs.writeFile(process.env.FDS_PDF_COLOR_OUTPUT, result);
    }
    assert.ok(originalError > 100_000, 'original extraction reproduces severe color error');
  } finally {
    await pdf.cleanup();
  }
});

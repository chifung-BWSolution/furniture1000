import assert from 'node:assert/strict';
import { planStructureUnits, unitImagePages } from '../supabase/functions/process-jobs/structureUnits.mjs';

const opts = { kinds: ['product', 'price_table', 'other'], minTextChars: 40, maxPages: 5, visionMaxPages: 2 };
const segments = [
  { id: 'cover', start_page: 1, end_page: 1, kind: 'cover' },
  { id: 'text', start_page: 2, end_page: 8, kind: 'product' },
  { id: 'scan', start_page: 9, end_page: 13, kind: 'product' },
  { id: 'blank', start_page: 14, end_page: 14, kind: 'other' },
];
const pages = [];
for (let p = 1; p <= 14; p++) {
  pages.push({
    page_no: p,
    char_count: p >= 2 && p <= 8 ? 200 : 0,
    image_count: p === 14 ? 0 : 1,
    text_source: p >= 2 && p <= 8 ? 'text' : 'none',
  });
}

const units = planStructureUnits(segments, pages, opts);
assert.deepEqual(units, [
  { segment_id: 'text', start: 2, end: 6 },
  { segment_id: 'text', start: 7, end: 8 },
  { segment_id: 'scan', start: 9, end: 10, vision: true },
  { segment_id: 'scan', start: 11, end: 12, vision: true },
  { segment_id: 'scan', start: 13, end: 13, vision: true },
]);

assert.deepEqual(unitImagePages(units[0], pages), [2, 3, 4, 5, 6]);
assert.deepEqual(unitImagePages(units[2], pages), [9, 10]);
// A text unit never sends scanned page images.
assert.deepEqual(unitImagePages({ start: 8, end: 9 }, pages), [8]);

console.log('structure units ok', { units: units.length });

// extractPagesPdf: copies only the requested pages, ignores out-of-range, respects the size cap.
const { PDFDocument } = await import('pdf-lib');
const { extractPagesPdf } = await import('../supabase/functions/process-jobs/structureUnits.mjs');
const src = await PDFDocument.create();
for (let i = 0; i < 6; i += 1) src.addPage([200 + i, 200]);
const sub = await extractPagesPdf(PDFDocument, src, [3, 4, 99], 10 * 1024 * 1024);
const loaded = await PDFDocument.load(sub);
assert.equal(loaded.getPageCount(), 2);
assert.equal(loaded.getPage(0).getWidth(), 202);
assert.equal(await extractPagesPdf(PDFDocument, src, [1], 10), null);
assert.equal(await extractPagesPdf(PDFDocument, src, [], 10 * 1024 * 1024), null);
console.log('extract pages pdf ok');

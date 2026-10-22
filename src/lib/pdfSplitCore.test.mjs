import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { partStoragePath, splitPdfUnderTarget } from './pdfSplitCore.mjs';

const doc = await PDFDocument.create();
for (let i = 0; i < 5; i += 1) {
  const page = doc.addPage([240, 240]);
  page.drawText(`page ${i + 1}`, { x: 40, y: 120, size: 24 });
}
const bytes = await doc.save();

const singles = await splitPdfUnderTarget(bytes, 1);
assert.equal(singles.length, 5);
singles.forEach((part, index) => {
  assert.equal(part.partIndex, index + 1);
  assert.equal(part.pageOffset, index);
  assert.equal(part.pageCount, 1);
  assert.ok(part.bytes.byteLength > 1);
});

const whole = await splitPdfUnderTarget(bytes, bytes.byteLength + 1024);
assert.equal(whole.length, 1);
assert.equal(whole[0].pageOffset, 0);
assert.equal(whole[0].pageCount, 5);

const grouped = await splitPdfUnderTarget(bytes, singles[0].bytes.byteLength + 300);
assert.ok(grouped.length >= 2 && grouped.length < 5);
assert.equal(grouped[0].pageOffset, 0);
let covered = 0;
for (const part of grouped) {
  assert.equal(part.pageOffset, covered);
  covered += part.pageCount;
  assert.ok(part.bytes.byteLength <= singles[0].bytes.byteLength + 300 || part.pageCount === 1);
}
assert.equal(covered, 5);

const capped = await splitPdfUnderTarget(bytes, bytes.byteLength + 1024, 2);
assert.deepEqual(capped.map((p) => p.pageCount), [2, 2, 1]);
assert.deepEqual(capped.map((p) => p.pageOffset), [0, 2, 4]);

assert.equal(
  partStoragePath('acme/abc123.pdf', 2, 'deadbeef'),
  'acme/abc123/part-002-deadbeef.pdf',
);

console.log('pdf split ok', { singles: singles.length, grouped: grouped.length });

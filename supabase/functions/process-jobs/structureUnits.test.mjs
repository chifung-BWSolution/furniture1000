import test from 'node:test';
import assert from 'node:assert/strict';
import { planStructureUnits } from './structureUnits.mjs';

const opts = { kinds: ['product', 'price_table'], minTextChars: 40, maxPages: 5, visionMaxPages: 2 };
const seg = { id: 's', start_page: 2, end_page: 9, kind: 'product' };
const page = (page_no, char_count, image_count) => ({ page_no, char_count, image_count });

test('mostly image-only segment with a few short OCR headings plans vision units', () => {
  // 向氏 part 8: 41 OCR chars over 8 photo/spec pages.
  const pages = [page(2, 0, 30), page(3, 0, 36), page(4, 0, 4), page(5, 0, 6), page(6, 18, 3), page(7, 23, 10), page(8, 0, 23), page(9, 0, 2)];
  const units = planStructureUnits([seg], pages, opts);
  assert.equal(units.length, 4);
  assert.ok(units.every((u) => u.vision === true));
});

test('text segment stays text', () => {
  const pages = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => page(n, 800, 2));
  const units = planStructureUnits([seg], pages, opts);
  assert.equal(units.length, 2);
  assert.ok(units.every((u) => !u.vision));
});

test('segment with no text and no images is skipped', () => {
  const pages = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => page(n, 0, 0));
  assert.deepEqual(planStructureUnits([seg], pages, opts), []);
});

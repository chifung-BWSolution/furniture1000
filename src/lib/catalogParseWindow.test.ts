import assert from 'node:assert/strict';
import { isCatalogParseWindow } from './catalogParseWindow.ts';

assert.equal(isCatalogParseWindow(new Date('2026-10-26T05:41:00.000Z')), false);
assert.equal(isCatalogParseWindow(new Date('2026-10-26T14:59:00.000Z')), false);
assert.equal(isCatalogParseWindow(new Date('2026-10-26T15:00:00.000Z')), true);
assert.equal(isCatalogParseWindow(new Date('2026-10-27T00:59:00.000Z')), true);
assert.equal(isCatalogParseWindow(new Date('2026-10-27T01:00:00.000Z')), false);

console.log('catalog parse window ok');

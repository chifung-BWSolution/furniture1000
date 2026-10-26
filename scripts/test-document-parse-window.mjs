import assert from 'node:assert/strict';
import { documentParseWindowOpen, requireDocumentParseWindow, ParseWindowClosed } from '../supabase/functions/process-jobs/parseWindow.mjs';

// UTC dates exercise Shanghai boundaries, including midnight and year rollover.
for (const [time, expected] of [
  ['2026-10-26T00:59:59.999Z', true], // 08:59:59
  ['2026-10-26T01:00:00.000Z', false], // 09:00
  ['2026-10-26T14:59:59.999Z', false], // 22:59:59
  ['2026-10-26T15:00:00.000Z', true], // 23:00
  ['2026-10-26T16:00:00.000Z', true], // midnight
  ['2026-12-31T16:00:00.000Z', true],
]) assert.equal(documentParseWindowOpen(new Date(time)), expected, time);

const RealDate = globalThis.Date;
try {
  globalThis.Date = class extends RealDate { constructor() { super('2026-10-26T01:00:00Z'); } };
  assert.throws(() => requireDocumentParseWindow(), ParseWindowClosed);
  globalThis.Date = class extends RealDate { constructor() { super('2026-10-26T15:00:00Z'); } };
  assert.doesNotThrow(() => requireDocumentParseWindow());
} finally { globalThis.Date = RealDate; }
console.log('Document parse window: boundaries and pause signal passed');

import test from 'node:test';
import assert from 'node:assert/strict';
import { JobError, validationRepair } from './job.mjs';

test('validation repairs carry the exported model and failed details, with a fixed limit', () => {
  const validation = { checks: [
    { name: 'semantic_1', ok: false, severity: 'error', detail: '腳 parts: 0, expected 4' },
    { name: 'textures', ok: false, severity: 'warning', detail: 'no texture' },
  ] };
  const repair = validationRepair(validation, 'existing.skp', 0);
  assert.equal(repair.seed, 'existing.skp');
  assert.equal(repair.round, 1);
  assert.match(repair.feedback, /semantic_1: 腳 parts: 0, expected 4/);
  assert.doesNotMatch(repair.feedback, /textures/);
  assert.equal(validationRepair(validation, 'existing.skp', 1).round, 2);
  assert.equal(validationRepair(validation, 'existing.skp', 2), null);
  assert.equal(new JobError('validation', 'failed').retryable, false);
  assert.equal(new JobError('network', 'failed').retryable, true);
});

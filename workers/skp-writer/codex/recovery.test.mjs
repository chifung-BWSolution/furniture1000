import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecovery, JobError } from './job.mjs';

test('export recovery preserves the saved model and report; invalid recovery never becomes a new model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fds-recovery-'));
  try {
    assert.equal(await loadRecovery(dir, 'job'), null);
    const skp = Buffer.from('\x0eSketchUp Model saved geometry');
    await writeFile(join(dir, 'working.skp'), skp);
    const state = { job_id: 'job', stage: 'export', report: { parts: [{ name: 'leg' }] }, toolCalls: 12 };
    await writeFile(join(dir, 'recovery.json'), JSON.stringify(state));
    assert.deepEqual(await loadRecovery(dir, 'job'), state);
    assert.deepEqual(await readFile(join(dir, 'working.skp')), skp);
    await assert.rejects(loadRecovery(dir, 'other'), /recovery_identity_mismatch/);
    await writeFile(join(dir, 'working.skp'), 'corrupt');
    await assert.rejects(loadRecovery(dir, 'job'), /recovery_skp_invalid/);
    // The server must not turn exhausted local recovery into a new modeling attempt.
    assert.equal(new JobError('export', 'bridge_closed').retryable, false);
    assert.equal(new JobError('modeling', 'interrupted').retryable, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

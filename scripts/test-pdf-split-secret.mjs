import assert from 'node:assert/strict';
import { readEnv, secretsMatch } from '../api/pdfSplitSecret.mjs';

assert.equal(secretsMatch('same-secret', 'same-secret'), true);
assert.equal(secretsMatch('same-secret\n', 'same-secret'), true);
assert.equal(secretsMatch('  same-secret  ', 'same-secret\r\n'), true);
assert.equal(secretsMatch('same-secret', 'other-secret'), false);
assert.equal(secretsMatch('short', 'longer-secret'), false);
assert.equal(secretsMatch(null, 'same-secret'), false);
assert.equal(secretsMatch('same-secret', ''), false);
assert.equal(secretsMatch('   ', '   '), false);
assert.equal(readEnv(' https://example.supabase.co \n'), 'https://example.supabase.co');
assert.equal(readEnv(undefined), '');

console.log('pdf split secret tests passed');

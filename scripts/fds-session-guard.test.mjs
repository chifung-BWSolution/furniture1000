import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/fdsSession.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function loadGuard(invoke, getUser = async () => ({ data: { user: null } })) {
  const exports = {};
  const dependencies = {
    '@/lib/supabase': { supabase: { functions: { invoke }, auth: { getUser } } },
    '@/lib/pmsStaff': { fetchPmsStaffName: async () => null },
  };
  runInNewContext(outputText, { exports, require: (id) => dependencies[id] });
  return exports;
}

const httpError = (status) => ({ data: null, error: { context: { status } } });
const loginOptions = { recordLogin: true, loginMethod: 'sso' };

test('a guard 401 during a VPN interruption does not force a logout', async () => {
  const { verifyActiveSession } = loadGuard(
    async () => httpError(401),
    async () => ({ data: { user: null }, error: { name: 'AuthRetryableFetchError' } }),
  );

  assert.equal((await verifyActiveSession('current-token')).valid, true);
});

test('an access token rejected during refresh can be checked again with the new token', async () => {
  const { registerActiveSession, verifyActiveSession } = loadGuard(async (_slug, options) => (
    options.headers.Authorization === 'Bearer old-token'
      ? httpError(401)
      : { data: { valid: true }, error: null }
  ));

  const first = await registerActiveSession('old-token', loginOptions);
  assert.equal(first.reason, undefined);
  assert.equal(first.network, true);
  assert.equal((await verifyActiveSession('new-token')).valid, true);
});

test('successful guard decisions still enforce session expiry, replacement and revocation', async () => {
  for (const reason of ['session_expired', 'session_replaced', 'signed_out']) {
    const { registerActiveSession, verifyActiveSession } = loadGuard(
      async () => ({ data: { valid: false, reason }, error: null }),
    );

    const verification = await verifyActiveSession('current-token');
    assert.equal(verification.valid, false);
    assert.equal(verification.reason, reason);
    assert.equal((await registerActiveSession('current-token', loginOptions)).reason, reason);
  }
});

test('the guard still falls back to the legacy slug when the preferred slug is unavailable', async () => {
  const calls = [];
  const { verifyActiveSession } = loadGuard(async (slug) => {
    calls.push(slug);
    return calls.length === 1
      ? httpError(404)
      : { data: { valid: false, reason: 'session_expired' }, error: null };
  });

  assert.equal((await verifyActiveSession('current-token')).reason, 'session_expired');
  assert.deepEqual(calls, ['supabase-functions-fds-session-guard', 'fds-session-guard']);
});

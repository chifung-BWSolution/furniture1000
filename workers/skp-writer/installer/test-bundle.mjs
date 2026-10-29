import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const payload = process.argv[2];
assert.ok(payload, 'payload directory required');
const requests = [];
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ path: req.url, authorization: req.headers.authorization, body });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, job: null }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
    FDS_SKP_ANON_KEY: 'fixture-anon',
    FDS_SKP_DEVICE_ID: '00000000-0000-4000-8000-000000000001',
    FDS_SKP_ACCESS_TOKEN: 'fixture-access-token',
    FDS_SKP_ACCESS_EXPIRES: '2099-01-01T00:00:00.000Z',
    FDS_SKP_REFRESH_TOKEN: 'fixture-refresh-token',
    SKETCHUP_EXE: join(payload, 'node.exe'),
    SKP_WRITER_EXE: join(payload, 'not-installed.exe'),
  };
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.NODE_OPTIONS;
  delete env.FDS_SKP_CONFIG;
  const child = spawn(join(payload, 'node.exe'), [join(payload, 'worker.mjs'), '--once'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(exit, 0, output);
    const ready = requests.find((request) => request.body?.action === 'ready');
    assert.ok(ready, 'worker must report readiness through the device proxy');
    assert.equal(ready.path, '/functions/v1/supabase-functions-skp-worker-agent');
    assert.equal(ready.authorization, 'Bearer fixture-access-token');
    assert.equal(ready.body.ready, true);
    assert.equal(ready.body.checks.sketchup, true);
    assert.equal(ready.body.checks.writer, false);
    assert.equal(typeof ready.body.checks.codex_ready, 'string');
    assert.ok(Array.isArray(ready.body.checks.capabilities), 'worker must report capabilities');
    assert.ok(String(ready.body.version).includes('codex-'), 'worker version must include the Codex job version');
    assert.ok(existsSync(join(payload, 'codex-mcp.mjs')), 'bundled MCP server missing');
    assert.ok(existsSync(join(payload, 'fds_codex_session.rb')), 'SketchUp session script missing');
    assert.equal(JSON.stringify(ready.body).includes('fixture-refresh-token'), false);
    assert.ok(requests.some((request) => request.body?.action === 'claim'), 'worker must claim through the device proxy');
    assert.equal(requests.some((request) => String(request.path).includes('/rest/v1/')), false);
    assert.equal(output.includes('fixture-refresh-token'), false);
    assert.equal(output.includes('service_role'), false);
    console.log('PASS: bundled Node reports readiness and claims through the device proxy; no service role or refresh token is sent on those calls.');
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill(); }
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const payload = process.argv[2];
assert.ok(payload, 'payload directory required');
const requests = [];
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  requests.push({ path: req.url, body: raw ? JSON.parse(raw) : null });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('[]');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const env = { ...process.env, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', SKETCHUP_EXE: join(payload, 'node.exe'), SKP_WRITER_EXE: join(payload, 'not-installed.exe') };
  delete env.NODE_OPTIONS;
  const child = spawn(join(payload, 'node.exe'), [join(payload, 'worker.mjs'), '--once'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(exit, 0, output);
    const heartbeat = requests.find((request) => request.path.startsWith('/rest/v1/fds_skp_workers'));
    assert.ok(heartbeat, 'bundled SDK must send heartbeat');
    assert.equal(heartbeat.body.ready, true);
    assert.equal(heartbeat.body.checks.sketchup, true);
    assert.equal(heartbeat.body.checks.writer, false);
    assert.ok(requests.some((request) => request.path === '/rest/v1/rpc/fds_processing_jobs_claim'), 'bundled SDK must claim existing SKP queue');
    console.log('PASS: bundled Node and Supabase SDK execute heartbeat and queue claim against a local fixture; no real jobs or credentials used.');
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill(); }
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }

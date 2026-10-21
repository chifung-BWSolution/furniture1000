import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/lib/resumableDocumentUpload.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleText = compiled.replace("'tus-js-client'", JSON.stringify(pathToFileURL(require.resolve('tus-js-client')).href));
const { uploadDocumentChunks, DOCUMENT_CHUNK_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString('base64')}`);

async function mockStorage(handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

// Use the Node transport with a Buffer, exposing the same size property as a browser File.
function file(size) { return Object.assign(Buffer.alloc(size, 17), { size }); }

test('large PDFs use 6MB chunks, recover an interrupted PATCH and report real byte progress', async () => {
  const input = file(13 * 1024 * 1024);
  let offset = 0;
  let failedOnce = false;
  let tokenReads = 0;
  const chunks = [];
  const events = [];
  const received = [];
  await mockStorage(async (req, res) => {
    res.setHeader('Tus-Resumable', '1.0.0');
    assert.match(req.headers.authorization, /^Bearer test-token-/);
    if (req.method === 'HEAD') {
      res.setHeader('Upload-Offset', offset);
      res.setHeader('Upload-Length', input.size);
      res.writeHead(200).end();
      return;
    }
    if (req.method === 'PATCH' && !failedOnce) {
      failedOnce = true;
      req.resume();
      res.writeHead(503).end();
      return;
    }
    if (req.method === 'POST') {
      assert.equal(req.url, '/storage/v1/upload/resumable');
      assert.equal(Number(req.headers['upload-length']), input.size);
      assert.match(req.headers['upload-metadata'], /bucketName/);
      res.setHeader('Location', '/upload/test');
    } else assert.equal(Number(req.headers['upload-offset']), offset);
    const body = [];
    for await (const chunk of req) body.push(chunk);
    const payload = Buffer.concat(body);
    received.push(payload);
    chunks.push(payload.length);
    offset += payload.length;
    res.setHeader('Upload-Offset', offset);
    res.writeHead(req.method === 'POST' ? 201 : 204).end();
  }, async supabaseUrl => {
    await uploadDocumentChunks({ file: input, path: 'factory/hash.pdf', bucket: 'supplier-documents', supabaseUrl, userId: 'user-a', getToken: async () => `test-token-${++tokenReads}`, onProgress: event => events.push(event) });
  });
  assert.deepEqual(chunks, [DOCUMENT_CHUNK_BYTES, DOCUMENT_CHUNK_BYTES, 1024 * 1024]);
  assert.ok(Buffer.concat(received).equals(input));
  assert.ok(events.some(event => event.phase === 'retrying'));
  assert.ok(events.some(event => event.uploadedBytes > 0 && event.uploadedBytes < input.size));
  assert.equal(events.at(-1).uploadedBytes, input.size);
  assert.ok(tokenReads >= 4);
});

test('authorization failures stop immediately and never report success', async () => {
  let requests = 0;
  const events = [];
  await mockStorage((req, res) => { requests++; req.resume(); res.writeHead(403).end('forbidden'); }, async supabaseUrl => {
    await assert.rejects(uploadDocumentChunks({ file: file(128), path: 'hash.pdf', bucket: 'supplier-documents', supabaseUrl, userId: 'user-a', getToken: async () => 'test-token', onProgress: event => events.push(event) }));
  });
  assert.equal(requests, 1);
  assert.ok(!events.some(event => event.phase === 'complete'));
});

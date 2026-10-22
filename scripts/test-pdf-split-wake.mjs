import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wakePdfSplitter } from '../supabase/functions/process-jobs/pdfSplitWake.mjs';

test('rejects authentication redirects without following them or leaking secrets', async () => {
  await assert.rejects(wakePdfSplitter('https://split.example?secret=private', 'private', async (_url, init) => {
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['x-pdf-split-secret'], 'private');
    return new Response(null, { status: 302, headers: { location: 'https://vercel.com/login' } });
  }), /^Error: pdf_split_http_302$/);
});

test('rejects SPA HTML, invalid JSON, HTTP errors, and failed jobs', async () => {
  for (const [response, message] of [
    [new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } }), 'expected_json'],
    [new Response('{', { headers: { 'content-type': 'application/json' } }), 'invalid_json'],
    [Response.json({ error: 'private' }, { status: 500 }), 'http_500'],
    [Response.json({ processed: 1, failed: true }), 'failed_response'],
    [Response.json({}), 'failed_response'],
  ]) {
    await assert.rejects(wakePdfSplitter('https://split.example', 'private', async () => response),
      new RegExp(`^Error: pdf_split_${message}$`));
  }
});

test('accepts idle and completed split responses', async () => {
  for (const processed of [0, 1]) {
    assert.deepEqual(await wakePdfSplitter('https://split.example', 'private', async () => Response.json({ processed })), { processed });
  }
});

test('redacts network errors containing the bypass URL', async () => {
  await assert.rejects(wakePdfSplitter('https://split.example', 'private', async () => {
    throw new Error('https://split.example?secret=private');
  }), /^Error: pdf_split_network_error$/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real handler, keeping Shopify and Supabase requests in memory.
const source = fs.readFileSync(new URL('../supabase/functions/refresh-shopify-token/index.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

async function run(managementToken) {
  let handler;
  const requests = [];
  const env = {
    SUPABASE_URL: 'https://test-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'project-service-role',
    MANAGEMENT_API_ACCESS_TOKEN: managementToken,
  };
  const query = new Proxy({}, { get: (_, name) => name === 'single'
    ? async () => ({ data: { shop_domain: 'test.myshopify.com', client_id: 'client', client_secret: 'secret' } })
    : name === 'upsert' ? async () => ({ error: null }) : () => query });
  vm.runInNewContext(code, {
    Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
    createClient: (_, key) => { assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY); return { from: () => query }; },
    console: { log() {}, warn() {}, error() {} },
    Response, URLSearchParams, setTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/access_token')) return Response.json({ access_token: 'shopify-token', expires_in: 3600 });
      if (url.endsWith('/shop.json')) return Response.json({ shop: { name: 'test shop' } });
      if (url.startsWith('https://api.supabase.com/')) {
        return options.headers.Authorization === `Bearer ${managementToken}`
          ? Response.json({})
          : Response.json({ message: 'JWT could not be decoded' }, { status: 401 });
      }
      throw Error(`Unexpected request: ${url}`);
    },
  });
  return { result: await (await handler(new Request('https://test/refresh', { method: 'POST' }))).json(), requests };
}

const configured = await run('sbp_test-management-token');
assert.equal(configured.result.secret_update.updated, true, 'Management API must use its own access token, not the project service-role key');
assert.equal(configured.result.verification.verified, true);
const missing = await run(undefined);
assert.equal(missing.result.secret_update.updated, false);
assert.equal(missing.result.secret_update.error, 'Missing MANAGEMENT_API_ACCESS_TOKEN');
assert.equal(missing.requests.some(r => r.url.startsWith('https://api.supabase.com/')), false, 'Do not send a project key to Management API when PAT is missing');
assert.equal(missing.result.verification.verified, true, 'Missing PAT must not prevent Shopify refresh and verification');
console.log('PASS: dedicated Management API token; missing-token handling; Shopify refresh preserved');

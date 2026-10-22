// Authenticated, read-only API benchmark. Credentials are loaded from .env.local
// and never printed. --capture/--compare keep reference data in the OS temp dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createServer, loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), 'VITE_');
const target = new URL(env.VITE_SUPABASE_URL).hostname;
const referencePath = path.join(os.tmpdir(), `fds-menu-reference-${target}.json`);
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const originalFetch = globalThis.fetch;
let requests = [];
globalThis.fetch = async (...args) => {
  const start = performance.now();
  const response = await originalFetch(...args);
  const bytes = (await response.clone().arrayBuffer()).byteLength;
  requests.push({ path: new URL(String(args[0])).pathname, status: response.status, bytes,
    ms: Math.round(performance.now() - start) });
  return response;
};

const values = {};
const results = [];
try {
  const { supabase } = await server.ssrLoadModule('/src/lib/supabase.ts');
  const login = await supabase.auth.signInWithPassword({ email: env.VITE_QUICK_LOGIN_EMAIL, password: env.VITE_QUICK_LOGIN_PASSWORD });
  assert.equal(login.error, null, 'configured login must succeed');
  console.log(JSON.stringify({ target }));
  for (const [name, module, method, args] of (process.argv.includes('--lists-only') ? [] : [
    ['rankings', 'quoteUsageReports', 'fetchQuoteUsageRankings', []],
    ['customer-products', 'solutionsApi', 'fetchActiveShopifyProducts', [1000]],
    ['custom-catalog', 'solutionsApi', 'fetchPortalBrowseProducts', [300]],
    ['review-documents', 'extractionReview', 'listReviewDocuments', []],
  ])) {
    const mod = await server.ssrLoadModule(`/src/lib/${module}.ts`);
    requests = [];
    const start = performance.now();
    let error;
    try { values[name] = await mod[method](...args); } catch (e) { error = e.message; }
    const result = { name, ms: Math.round(performance.now() - start), requests: requests.length,
      bytes: requests.reduce((n, r) => n + r.bytes, 0), statuses: requests.map(r => r.status), ...(error ? { error } : {}) };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  if (process.argv.includes('--lists-only')) {
    const query = await server.ssrLoadModule('/src/lib/quoteListData.ts');
    const summary = async (name, run) => {
      requests = [];
      const start = performance.now();
      const value = await run();
      const result = { name, ms: Math.round(performance.now() - start), requests: requests.length,
        bytes: requests.reduce((n, r) => n + r.bytes, 0), statuses: requests.map(r => r.status) };
      results.push(result);
      console.log(JSON.stringify(result));
      return value;
    };
    const oldColumns = 'id,quote_id,version,status,total_amount,cost_price,submitter,bwf_pitching_id,created_at,modified_date,project_data';
    const old = await summary('quote-legacy-page', async () => {
      const result = await supabase.from('bwf_quote').select(oldColumns, { count: 'exact' })
        .neq('status', '回收桶').order('created_at', { ascending: false }).range(0, 39);
      assert.equal(result.error, null);
      return result;
    });
    const current = await summary('quote-light-page', () => query.fetchQuoteListPage(0, 40, false));
    const facts = row => [row.id, row.quote_id, row.version, row.status, row.total_amount,
      row.cost_price, row.submitter, row.bwf_pitching_id, row.created_at, row.modified_date,
      ...['clientName', 'clientContactName', 'company', 'projectManager', 'clientIndustry', 'clientIndustryOther']
        .map(key => row.project_data?.formData?.[key] ?? null),
      row.project_data?.clientInfo?.name ?? null, row.project_data?.clientInfo?.contactName ?? null,
      row.project_data?.quoteMeta?.date ?? null];
    assert.equal(old.count, await summary('quote-independent-count', () => query.fetchQuoteListCount()));
    assert.ok(isDeepStrictEqual(current.rows.map(facts), old.data.map(facts)), 'preserve all list facts');
    const oldSiblings = await summary('quote-legacy-siblings', async () => {
      const result = await supabase.from('bwf_quote').select(oldColumns)
        .in('quote_id', [...new Set(old.data.map(r => r.quote_id))]).neq('status', '回收桶');
      assert.equal(result.error, null);
      return result.data;
    });
    const siblings = await summary('quote-light-siblings', () => query.attachQuoteListSiblings(current.rows));
    const sortedFacts = rows => [...new Map(rows.map(row => [row.id, facts(row)])).values()]
      .sort((a, b) => a[0].localeCompare(b[0]));
    assert.ok(isDeepStrictEqual(sortedFacts(siblings), sortedFacts([...old.data, ...oldSiblings])), 'preserve sibling versions');
    const large = await summary('quote-large-page', () => query.fetchQuoteListPage(0, 40, true, true));
    assert.ok(large.rows.every(row => row.total_amount > 50000));
    const admin = await server.ssrLoadModule('/src/lib/adminApi.ts');
    const cold = await summary('admin-cold', () => admin.fetchPlatformAdminData());
    const warm = await summary('admin-warm', () => admin.fetchPlatformAdminData());
    assert.ok(isDeepStrictEqual(warm, cold), 'same account can reuse the result');
    assert.equal(results.at(-1).requests, 0, 'warm load must not issue requests');
    await summary('admin-refresh', () => admin.fetchPlatformAdminData(true));
    assert.ok(results.at(-1).requests > 0, 'manual refresh issues fresh requests');
    // Each admin page must only pay for its own resource.
    await summary('admin-users-only', () => admin.fetchPlatformUsers(true));
    await summary('admin-logs-only', () => admin.fetchPlatformLoginLogs(true));
    console.log('PASS: quotation list facts, sibling versions, large-amount filter, admin reuse and refresh.');
  }
  if (process.argv.includes('--capture')) fs.writeFileSync(referencePath, JSON.stringify({ target, values }));
  fs.writeFileSync(referencePath.replace('.json', '-actual.json'), JSON.stringify({ target, values }));
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  if (output) fs.writeFileSync(output, JSON.stringify({ target, results }, null, 2));
  if (process.argv.includes('--compare') && !process.argv.includes('--lists-only')) {
    const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
    assert.equal(reference.target, target);
    for (const name of ['rankings', 'customer-products', 'custom-catalog']) {
      // Ordering of tied catalogue rows is not a database contract. Compare by
      // stable identity while checking every returned field and every count.
      const canonical = value => Array.isArray(value)
        ? value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
          : value;
      assert.ok(isDeepStrictEqual(canonical(values[name]), canonical(reference.values[name])), `${name}: preserve results (reference values retained in OS temp directory)`);
    }
    assert.ok(Array.isArray(values['review-documents']), 'review query must load successfully');
    console.log('PASS: ranking counts and all product fields match reference; review documents load.');
  }
  await supabase.auth.signOut({ scope: 'local' });
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}

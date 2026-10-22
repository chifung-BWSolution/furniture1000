import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

function load(name, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, console, ...globals, require(id) {
    assert.ok(id in dependencies, `unexpected dependency ${id}`);
    return dependencies[id];
  } };
  vm.runInNewContext(source, context, { filename: name });
  return context.exports;
}
const concurrent = load('mapConcurrent');
let active = 0;
let peak = 0;
const mapped = await concurrent.mapConcurrent([0, 1, 2, 3, 4, 5, 6], async (n) => {
  active++;
  peak = Math.max(peak, active);
  await Promise.resolve();
  active--;
  return n * 2;
});
assert.deepEqual(Array.from(mapped), [0, 2, 4, 6, 8, 10, 12]);
assert.equal(peak, 3);
await assert.rejects(concurrent.mapConcurrent([1], async () => { throw Error('failed page'); }), /failed page/);

// More than one 3-page wave catches gaps at 3000/4000 and >1000 items
// catches the PostgREST response cap. Older and trashed versions must not count.
const tables = {
  products: Array.from({ length: 4201 }, (_, n) => ({ title: `P${n}`, factories_display_name: 'F', image_url: `image-${n}` })),
  bwf_quote: [
    { id: 'latest', quote_id: 'Q', created_at: '2026-10-22', status: '已通過' },
    { id: 'old', quote_id: 'Q', created_at: '2026-10-21', status: '已通過' },
    { id: 'trash', quote_id: 'Q', created_at: '2026-10-23', status: '回收桶' },
  ],
  bwf_quote_item: [
    ...Array.from({ length: 1001 }, () => ({ name: 'P3500', factory_name: 'F', quantity: 2, quote_uuid: 'latest' })),
    { name: 'P4200', factory_name: 'F', quantity: 3, quote_uuid: 'latest' },
    { name: 'P3500', factory_name: 'F', quantity: 999, quote_uuid: 'old' },
    { name: 'P3500', factory_name: 'F', quantity: 999, quote_uuid: 'trash' },
    { name: 'P3500', factory_name: 'F', quantity: 999, quote_uuid: 'latest', is_section_title: true },
    { name: 'P3500', factory_name: 'F', quantity: 999, quote_uuid: 'latest', is_custom_term: true },
  ],
};
const queriedIds = [];
function from(table) {
  let rows = [...tables[table]];
  let start = 0;
  let end = Infinity;
  const q = {
    select() { return q; },
    neq(key, value) { rows = rows.filter(r => r[key] !== value); return q; },
    not(key, operator, value) { rows = rows.filter(r => r[key] != null); return q; },
    in(key, values) { queriedIds.push(...values); rows = rows.filter(r => values.includes(r[key])); return q; },
    order(key, { ascending }) { rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1)); return q; },
    range(a, b) { start = a; end = b; return q; },
    then(resolve, reject) { return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve, reject); },
  };
  return q;
}
const reports = load('quoteUsageReports', {
  '@/lib/mapConcurrent': concurrent,
  '@/lib/supabase': { supabase: { from } },
  '@/lib/factoryNames': { normalizeFactoryDisplayName: s => (s || '').trim() },
  '@/lib/quoteTrash': { QUOTE_TRASH_STATUS: '回收桶' },
});
const ranking = await reports.fetchQuoteUsageRankings();
assert.equal(ranking.products.length, 2);
assert.equal(ranking.products.find(p => p.name === 'P3500').quantitySum, 2002);
assert.equal(ranking.products.find(p => p.name === 'P4200').usageCount, 1);
assert.equal(ranking.factories[0].usageCount, 1002);
assert.equal(ranking.factories[0].quoteCount, 1);
assert.ok(queriedIds.length > 0 && queriedIds.every(id => id === 'latest'));

// A shared admin read must not cross logins, survive a manual refresh, or
// overwrite a newer cache when an older request resolves late. Users and login
// history are separate resources, so each one is cached and invalidated on its own.
let actor = 'one';
let listener;
const calls = [];
let resolveNext;
let now = 1000;
const fakeSupabase = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: actor } } } }),
    onAuthStateChange(callback) { listener = callback; },
  },
  functions: { async invoke(_slug, { body } = {}) {
    calls.push(body?.action ?? 'fetch');
    if (resolveNext) return resolveNext();
    return { data: { users: [{ id: actor }], logs: [], securityTrend: [] } };
  } },
  from() { const q = { update() { return q; }, upsert() { return q; }, eq() { return q; }, then(resolve) { resolve({ error: null }); } }; return q; },
};
class Clock extends Date { static now() { return now; } }
const admin = load('adminApi', {
  '@/lib/supabase': { supabase: fakeSupabase },
  '@/lib/loginLogEnrichment': { mergeUploadActivityLogs: async logs => logs },
}, { Date: Clock });
const countOf = (action) => calls.filter((a) => a === action).length;

await Promise.all([admin.fetchPlatformAdminData(), admin.fetchPlatformAdminData()]);
assert.equal(countOf('users'), 1, 'dedupe concurrent user loads');
assert.equal(countOf('logs'), 1, 'dedupe concurrent log loads');
assert.equal(calls.length, 2, 'users and login history load independently');
await admin.fetchPlatformAdminData();
assert.equal(calls.length, 2, 'reuse recent result');
await admin.fetchPlatformAdminData(true);
assert.equal(calls.length, 4, 'manual refresh bypasses cache');
now += 30_001;
await admin.fetchPlatformAdminData();
assert.equal(calls.length, 6, 'expiry reloads');
await admin.updatePlatformUserProfile('test', { active: false });
await admin.fetchPlatformAdminData();
assert.equal(calls.length, 8, 'write invalidates cache');
actor = 'two';
listener('SIGNED_IN');
assert.equal((await admin.fetchPlatformAdminData()).users[0].id, 'two');
assert.equal(calls.length, 10, 'new account reloads');
let release;
resolveNext = () => new Promise(resolve => { release = resolve; });
const pending = admin.fetchPlatformUsers(true);
while (!release) await Promise.resolve();
resolveNext = undefined;
actor = 'three';
listener('SIGNED_IN');
await admin.fetchPlatformUsers();
release({ data: { users: [{ id: 'two' }], logs: [], securityTrend: [] } });
await pending;
assert.equal((await admin.fetchPlatformUsers())[0].id, 'three');
console.log('PASS: bounded concurrency, multi-page rankings, latest/trash semantics, account-isolated cache and refresh invalidation.');

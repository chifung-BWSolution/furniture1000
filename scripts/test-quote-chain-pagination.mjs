import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

// 80 versions must occupy one chain slot, not two raw-row pages. Include
// latest-price changes to exercise the client RPC contract.
const rows = Array.from({ length: 80 }, (_, i) => ({
  id: `a-${i + 1}`, quote_id: 'A', version: `v${i + 1}`, status: '草稿',
  created_at: `2026-10-${String(i % 20 + 1).padStart(2, '0')}`, total_amount: 60000,
}));
rows.push({ id: 'b-1', quote_id: 'B', version: 'v1', status: '草稿', created_at: '2026-10-22', total_amount: 80000 });
rows.push({ id: 'b-2', quote_id: 'B', version: 'v2', status: '草稿', created_at: '2026-10-23', total_amount: 10000 });
const calls = [];
const supabase = {
  rpc(name, args, options) {
    assert.equal(name, 'latest_quote_version_ids');
    calls.push({ name, args });
    // Stub the server's chain result; this test verifies the client pages that
    // result, not raw quote records, and carries its count into the UI.
    const ids = args.p_large_amount ? [{ id: 'a-80' }] : [{ id: 'b-2' }, { id: 'a-80' }];
    return {
      range(start, end) { return Promise.resolve({ data: ids.slice(start, end + 1), count: options?.count ? ids.length : null }); },
      then(resolve, reject) { return Promise.resolve({ count: ids.length }).then(resolve, reject); },
    };
  },
  from(table) {
    assert.equal(table, 'bwf_quote');
    let data = [...rows];
    const q = {
      select() { return q; },
      in(key, ids) { data = data.filter(row => ids.includes(row[key])); return q; },
      not(key, _op, value) { const ids = value.slice(1, -1).split(','); data = data.filter(row => !ids.includes(row[key])); return q; },
      neq(key, value) { data = data.filter(row => row[key] !== value); return q; },
      order() { return q; },
      then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); },
    };
    return q;
  },
};
const context = { exports: {}, Date, Map, Set, require(name) {
  assert.equal(name, '@/lib/supabase');
  return { supabase };
} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/quoteListData.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const api = context.exports;
const first = await api.fetchQuoteListPage(0, 1, true);
const second = await api.fetchQuoteListPage(1, 1, true);
assert.equal(first.count, 2);
assert.equal(first.rows[0].quote_id, 'B');
assert.equal(second.rows[0].quote_id, 'A');
assert.equal((await api.fetchQuoteListPage(2, 1, true)).rows.length, 0);
const expanded = await api.attachQuoteListSiblings(second.rows);
assert.equal(expanded.length, 80);
assert.ok(expanded.every(row => row.quote_id === 'A'));
const large = await api.fetchQuoteListPage(0, 40, true, true);
assert.equal(large.count, 1);
assert.equal(large.rows[0].quote_id, 'A');
assert.equal(await api.fetchQuoteListCount(), 2);
const previousCalls = calls.length;
await api.fetchQuoteListPage(0, 1, true);
assert.equal(calls.length, previousCalls, 'repeat reads reuse cache');
api.invalidateQuoteListCache();
await api.fetchQuoteListPage(0, 1, true);
assert.equal(calls.length, previousCalls + 1);
console.log('PASS: chain paging, sibling expansion, chain counts, latest-amount filter and cache invalidation');

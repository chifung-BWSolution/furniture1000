import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-13 報價範圍（前端規則）。伺服器另有 `fds_quote_zone_scope` 重查同一組條件。
 */

const source = fs.readFileSync('src/lib/quoteZoneScope.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

const scope = (input) => {
  const row = M.quoteZoneScope(input);
  return [row.allowed, row.reason];
};

// 正式報價
assert.deepEqual(scope({ status: '待審核', quoteId: 'BWF-FD26-001' }), [true, 'ok']);
assert.deepEqual(scope({ status: '版本審核', quoteId: 'BWF-FD26-001', designProjectId: '' }), [true, 'ok']);

// 排除快速報價、客戶方案、回收桶
assert.deepEqual(scope({ status: '快速報價', quoteId: 'QQ-1' }), [false, 'not_formal_quote']);
assert.deepEqual(scope({ status: '客戶方案', quoteId: 'BWF-1' }), [false, 'not_formal_quote']);
assert.deepEqual(scope({ status: '回收桶', quoteId: 'BWF-1' }), [false, 'not_formal_quote']);

// 設計專案：DP- 單號或已掛 designProjectId
assert.deepEqual(scope({ status: '待審核', quoteId: 'DP-2026-001' }), [false, 'design_project']);
assert.deepEqual(scope({ status: '待審核', quoteId: 'dp-1' }), [false, 'design_project']);
assert.deepEqual(scope({ status: '待審核', quoteId: 'BWF-1', designProjectId: 'proj-1' }), [false, 'design_project']);

// 空白與缺值不會誤判
assert.deepEqual(scope({ status: null, quoteId: null, designProjectId: '   ' }), [true, 'ok']);

assert.ok(M.QUOTE_ZONE_SCOPE_MESSAGES.not_formal_quote.includes('正式報價'));
assert.ok(M.QUOTE_ZONE_SCOPE_MESSAGES.design_project.includes('設計專案'));

console.log('PASS quote zone scope only allows BWF formal quotes');

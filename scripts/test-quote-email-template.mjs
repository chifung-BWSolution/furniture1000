import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-15 郵件模板純邏輯測試：自訂段、發送前檢查。
 * 只抽 src/lib/quoteEmailFollowUp.ts 內不連資料庫的部分。
 */

const source = fs.readFileSync('src/lib/quoteEmailFollowUp.ts', 'utf8');
const start = source.indexOf('export const QUOTE_EMAIL_STATUS_LABELS');
const end = source.indexOf('export async function loadQuoteEmailStatus');
assert.ok(start > 0 && end > start, 'pure email helpers are present');
const snippet = source.slice(start, end);
const code = ts.transpileModule(snippet, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

// --- 自訂段落正規化 -------------------------------------------------------
assert.equal(M.normalizeCustomQuoteEmailSections(null).length, 0);
assert.equal(M.normalizeCustomQuoteEmailSections([{ title: '  ', body: '' }]).length, 0);
assert.deepEqual(
  Array.from(M.normalizeCustomQuoteEmailSections([
    { title: ' 送貨 ', body: ' 下月 ' },
    { title: '', body: '備註' },
    'junk',
  ]), (row) => [row.title, row.body]),
  [['送貨', '下月'], ['', '備註']],
);
assert.equal(M.normalizeCustomQuoteEmailSections(Array.from({ length: 15 }, (_, i) => ({ title: `T${i}`, body: 'x' }))).length, 10);
assert.equal(M.normalizeCustomQuoteEmailSections([{ title: 'a'.repeat(200), body: 'b'.repeat(2000) }])[0].title.length, 60);
assert.equal(M.normalizeCustomQuoteEmailSections([{ title: 'a', body: 'b'.repeat(2000) }])[0].body.length, 800);

// --- 發送前檢查 -----------------------------------------------------------
const ready = { recipient: 'a@b.com', contactPhone: '5163 7535', shareToken: 't' };
assert.equal(M.quoteEmailReadiness({ ...ready, recipient: '' }), 'recipient_missing');
assert.equal(M.quoteEmailReadiness({ ...ready, recipient: 'nope' }), 'recipient_invalid');
assert.equal(M.quoteEmailReadiness({ ...ready, contactPhone: ' ' }), 'contact_phone_missing');
assert.equal(M.quoteEmailReadiness({ ...ready, shareToken: null }), 'share_link_missing');
assert.equal(M.quoteEmailReadiness(ready), null);
assert.equal(M.isQuoteEmailAddress(' a@b.co '), true);
assert.equal(M.isQuoteEmailAddress('a@b'), false);
assert.equal(M.isQuoteEmailAddress('a b@c.com'), false);

console.log('PASS quote email custom sections and send checks');

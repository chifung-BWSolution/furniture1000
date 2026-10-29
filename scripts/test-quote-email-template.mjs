import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-15 郵件模板純邏輯測試：固定三段、自訂段、發送前檢查。
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
assert.equal(M.quoteEmailReadiness({ recipient: '', contactPhone: '1', shareToken: 't' }), 'recipient_missing');
assert.equal(M.quoteEmailReadiness({ recipient: 'nope', contactPhone: '1', shareToken: 't' }), 'recipient_invalid');
assert.equal(M.quoteEmailReadiness({ recipient: 'a@b.com', contactPhone: ' ', shareToken: 't' }), 'contact_phone_missing');
assert.equal(M.quoteEmailReadiness({ recipient: 'a@b.com', contactPhone: '1', shareToken: null }), 'share_link_missing');
assert.equal(M.quoteEmailReadiness({ recipient: 'a@b.com', contactPhone: '1', shareToken: 't' }), null);
assert.equal(M.isQuoteEmailAddress(' a@b.co '), true);
assert.equal(M.isQuoteEmailAddress('a@b'), false);
assert.equal(M.isQuoteEmailAddress('a b@c.com'), false);

// --- 固定三段永遠存在而且排在前面 ---------------------------------------
const sections = Array.from(M.buildQuoteEmailSections({
  itemCount: 4,
  totalCents: 1280000,
  sampleItems: '員工椅、會議桌',
  introText: '以下是方案。',
  contactPhone: '+852 9000 0000',
  quoteUrl: 'https://fds.app/customer?quote_share=qtok_x',
  customSections: [{ title: '送貨', body: '下月安排' }],
}));
assert.deepEqual(Array.from(sections, (row) => row.key), ['summary', 'contact', 'share', 'custom-0']);
assert.deepEqual(Array.from(sections, (row) => row.label), ['報價內容簡述', '可電話聯繫', '加單授權連結', '送貨']);
assert.ok(sections[0].body.includes('4 項傢俬'), 'summary counts items');
assert.ok(sections[0].body.includes('HK$ 12,800.00'), 'summary shows reference total');
assert.ok(sections[0].body.includes('員工椅、會議桌'), 'summary lists sample items');
assert.ok(sections[0].body.includes('以下是方案。'), 'summary keeps the custom intro');
assert.ok(sections[1].body.includes('+852 9000 0000'), 'contact section carries the staff phone');
assert.ok(sections[2].body.includes('quote_share=qtok_x'), 'share section carries the authorization link');

// 缺電話或連結時，固定段仍然存在，但會明確寫未能發送。
const missing = Array.from(M.buildQuoteEmailSections({
  itemCount: 0,
  totalCents: 0,
  sampleItems: null,
  introText: '',
  contactPhone: '',
  quoteUrl: '',
  customSections: [],
}));
assert.equal(missing.length, 3, 'fixed sections cannot be removed');
assert.ok(missing[1].body.includes('未填負責同事電話'));
assert.ok(missing[2].body.includes('未有有效客戶連結'));

assert.equal(M.formatQuoteEmailMoney(1280000), 'HK$ 12,800.00');

console.log('PASS quote email fixed sections, custom sections and send checks');

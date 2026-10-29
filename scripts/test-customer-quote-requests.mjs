import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-14 PM 檢視用的純邏輯：狀態標籤、只顯示客戶勾選的項目、金額與通知事實。
 */

const source = fs.readFileSync('src/lib/customerQuoteRequests.ts', 'utf8');
const start = source.indexOf('export const CUSTOMER_REQUEST_STATUS_LABELS');
const end = source.indexOf('export async function listCustomerQuoteRequests');
assert.ok(start >= 0 && end > start, 'request helpers are present');
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

assert.deepEqual(
  Array.from(M.CUSTOMER_REQUEST_STATUS_OPTIONS),
  ['submitted', 'acknowledged', 'converted', 'declined'],
);
assert.deepEqual(Object.assign({}, M.CUSTOMER_REQUEST_STATUS_LABELS), {
  submitted: '待處理',
  acknowledged: '已確認',
  converted: '已開正式報價',
  declined: '不採用',
});

// 只顯示已勾選且有數量的項目；未選或數量 0 的略過。
const lines = M.selectedRequestLines([
  { name: '員工椅', quantity: 3, selected: true, unit: 'PC' },
  { name: '會議桌', quantity: 0, selected: true },
  { name: '文件櫃', quantity: 2, selected: false },
  null,
]);
assert.equal(lines.length, 1);
assert.equal(M.requestLineLabel(lines[0]), '員工椅 × 3 PC');
assert.equal(M.requestLineLabel({ name: ' ', quantity: 1, unit: '', note: ' 淺色 ' }), '未命名項目 × 1（淺色）');
assert.equal(M.selectedRequestLines(null).length, 0);

assert.equal(M.formatRequestMoney(240000), 'HK$ 2,400.00');
assert.equal(M.formatRequestTime('2026-10-29T10:20:30.000Z'), '2026-10-29 10:20');
assert.equal(M.formatRequestTime(null), '');

assert.equal(M.requestNotifyLabel({ pm_notified_at: '2026-10-29T10:00:00Z', pm_notify_error: null }), '已通知負責同事');
assert.equal(M.requestNotifyLabel({ pm_notified_at: null, pm_notify_error: 'pm_email_missing' }), '未通知：找不到負責同事電郵');
assert.equal(M.requestNotifyLabel({ pm_notified_at: null, pm_notify_error: 'invalid_recipient' }), '未通知：負責同事電郵無效');
assert.equal(M.requestNotifyLabel({ pm_notified_at: null, pm_notify_error: 'smtp down' }), '未通知：smtp down');
assert.equal(M.requestNotifyLabel({ pm_notified_at: null, pm_notify_error: null }), '待通知負責同事');

assert.ok(M.customerRequestErrorMessage(new Error('permission_denied')).includes('沒有權限'));
assert.ok(M.customerRequestErrorMessage(new Error('request_not_found')).includes('找不到'));
assert.ok(M.customerRequestErrorMessage(new Error('PGRST202')).includes('尚未部署'));

console.log('PASS customer request labels, selected lines, money and notify facts');

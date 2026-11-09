import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * 報價一覽倒數：每張報價由建立日期起計 45 日；
 * 過了 45 日即顯示「不成功」，日期缺失不當作不成功。
 */

const source = fs.readFileSync('src/lib/quoteCountdown.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

const now = new Date('2026-11-09T12:00:00Z');

assert.equal(M.QUOTE_COUNTDOWN_DAYS, 45, '倒數固定 45 日');
assert.equal(
  M.quoteRemainingDays('2026-11-09T12:00:00Z', now),
  45,
  '建立當日顯示 45 天',
);
assert.equal(
  M.quoteRemainingDays('2026-11-08T12:00:00Z', now),
  44,
  '過了一日顯示 44 天',
);
assert.equal(
  M.quoteRemainingDays('2026-09-26T00:00:00Z', now),
  1,
  '第 45 日前仍顯示剩餘 1 天',
);
assert.equal(
  M.quoteRemainingDays('2026-09-25T12:00:00Z', now),
  0,
  '剛好 45 日為 0',
);
assert.equal(M.isQuoteUnsuccessful(0), true, '0 天即不成功');
assert.equal(
  M.quoteRemainingDays('2026-09-24T12:00:00Z', now),
  -1,
  '超過 45 日為負數',
);
assert.equal(M.isQuoteUnsuccessful(-1), true, '負數即不成功');
assert.equal(M.isQuoteUnsuccessful(1), false, '仍有 1 天未算不成功');
assert.equal(M.quoteRemainingDays(null, now), null, '沒有建立日期回傳 null');
assert.equal(M.quoteRemainingDays('not-a-date', now), null, '無效日期回傳 null');
assert.equal(M.isQuoteUnsuccessful(null), false, '日期缺失不當作不成功');

console.log('quote countdown tests passed');

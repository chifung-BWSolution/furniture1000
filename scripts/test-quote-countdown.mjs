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
assert.equal(
  M.countdownRemainingDays('2026-11-06T00:00:00Z', 45, now),
  42,
  '查詢日期 3 日前，45 日倒數剩 42 天',
);
assert.equal(
  M.quoteCountdownOutcome('Confirmed Project', -9),
  'won',
  'Confirmed Project 過了 45 日仍算成功，不顯示不成功',
);
assert.equal(
  M.quoteCountdownOutcome(' confirmed project ', 30),
  'won',
  'Confirmed Project 未到期亦以成功為準',
);
assert.equal(
  M.quoteCountdownOutcome('Case Closed', 30),
  'unsuccessful',
  'Case Closed 未到期亦算不成功',
);
assert.equal(
  M.quoteCountdownOutcome('Pitching', 30),
  'active',
  'Pitching 階段仍在倒數',
);
assert.equal(
  M.quoteCountdownOutcome('Pitching', 0),
  'unsuccessful',
  '過了 45 日仍未成功即不成功',
);
assert.equal(
  M.quoteCountdownOutcome(null, -1),
  'unsuccessful',
  '沒有階段但過期仍算不成功',
);
assert.equal(
  M.isWonPitchingStage('不成功'),
  false,
  '「不成功」不可被當成成功階段',
);

// PMS Recover Pitching: stage returns to Enquiry, enquiry_date is unchanged,
// and modified_date becomes the recovery time.
assert.equal(
  M.pitchingReopenedAt(
    '2026-08-01T00:00:00Z',
    '2026-11-01T00:00:00Z',
    'Enquiry',
  ),
  '2026-11-01T00:00:00Z',
  '原 45 日已過，復原後以 modified_date 重新起算',
);
assert.equal(
  M.pitchingReopenedAt(
    '2026-08-01T00:00:00Z',
    '2026-09-01T00:00:00Z',
    'Enquiry',
  ),
  null,
  '未過原 45 日就復原，不重新起算',
);
assert.equal(
  M.pitchingReopenedAt(
    '2026-08-01T00:00:00Z',
    '2026-11-01T00:00:00Z',
    'Case Closed',
  ),
  null,
  'Case Closed 不當作復原',
);
assert.equal(
  M.pitchingReopenedAt(
    '2026-08-01T00:00:00Z',
    '2026-11-01T00:00:00Z',
    'Confirmed Project',
  ),
  null,
  '已成功提案不當作復原',
);
assert.equal(
  M.pitchingCountdownStart(
    '2026-08-01T00:00:00Z',
    '2026-11-01T00:00:00Z',
    'Pitching',
  ),
  '2026-11-01T00:00:00Z',
  '復原後再推進階段，仍由 modified_date 起算',
);
assert.equal(
  M.quoteCountdownStart('2026-08-10T00:00:00Z', {
    enquiry_date: '2026-08-01T00:00:00Z',
    modified_date: '2026-11-01T00:00:00Z',
    pitching_stages: 'Enquiry',
  }),
  '2026-11-01T00:00:00Z',
  '報價建立早於復原日期時，用復原日期起算',
);
assert.equal(
  M.quoteCountdownStart('2026-11-05T00:00:00Z', {
    enquiry_date: '2026-08-01T00:00:00Z',
    modified_date: '2026-11-01T00:00:00Z',
    pitching_stages: 'Enquiry',
  }),
  '2026-11-05T00:00:00Z',
  '報價在復原後才建立時，仍用報價建立日期',
);
assert.equal(
  M.quoteCountdownStart('2026-08-10T00:00:00Z', null),
  '2026-08-10T00:00:00Z',
  '沒有 PMS 提案時，用報價建立日期',
);

console.log('quote countdown tests passed');

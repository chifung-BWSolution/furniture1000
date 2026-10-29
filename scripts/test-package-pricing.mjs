import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-08 參考計價回歸測試（純數學／驗證，不連資料庫）。
 * 覆蓋：仙為單位的小計、數量 0／負數／非法值、分區小計與總額、
 * 手動匹配與未完成匹配、來源追溯、快照複製。
 */

const source = fs.readFileSync('src/lib/packagePricingMath.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

const line = (over = {}) => ({
  id: 'line-1',
  area: 'Staff Area',
  itemName: '員工椅',
  grade: '標準價',
  material: 'Mesh',
  dimension: '',
  unit: 'PC',
  quantity: 10,
  unitPrice: 800,
  standardNote: '200-600',
  premiumNote: '300-800',
  ...over,
});

// --- 金額以仙處理 ---------------------------------------------------------
assert.equal(M.lineCents(10, 800), 800000, '10 × 800 = 800,000 cents');
assert.equal(M.lineCents(2.5, 1620), 405000, 'decimal quantity keeps cents exact');
assert.equal(M.lineCents(3, 875.006), 262503, 'unit price rounds to cents before multiplying');
assert.equal(M.lineCents(3, 875.004), 262500, 'unit price rounds down to the nearest cent');
assert.equal(M.lineCents(0, 800), 0, 'quantity 0 gives 0');
assert.equal(M.lineCents(-5, 800), 0, 'negative quantity never gives a subtotal');
assert.equal(M.lineCents(5, -800), 0, 'negative price never gives a negative subtotal');
assert.equal(M.lineCents(5, null), 0, 'missing price gives 0');
assert.equal(M.lineCents(Number.NaN, 800), 0, 'NaN quantity gives 0');

// --- 分區小計與總額一致 ---------------------------------------------------
const lines = [
  line({ id: 'a', area: 'Staff Area', quantity: 10, unitPrice: 800 }),
  line({ id: 'b', area: 'Staff Area', quantity: 3, unitPrice: 1100 }),
  line({ id: 'c', area: 'Meeting Room', quantity: 2, unitPrice: 1620.5 }),
];
const areas = M.areaTotals(lines);
assert.deepEqual(Array.from(areas, (area) => [area.area, area.cents]), [
  ['Staff Area', 1130000],
  ['Meeting Room', 324100],
], 'area subtotals keep the sheet order');
assert.equal(M.totalCents(lines), 1454100, 'total equals the sum of area subtotals');
assert.equal(
  M.totalCents(lines),
  areas.reduce((sum, area) => sum + area.cents, 0),
  'total and area subtotals always agree',
);
assert.equal(M.formatPackageMoney(M.lineCents(10, 800)), 'HK$ 8,000.00');

// --- 驗證：負數與非法值不可形成有效報價 -----------------------------------
const fields = (list) => Array.from(list, (problem) => problem.field);
assert.deepEqual(fields(M.packageLineProblems(line({ quantity: -1 }))), ['quantity']);
assert.ok(M.packageLineProblems(line({ quantity: -1 }))[0].message.includes('負數'));
assert.deepEqual(fields(M.packageLineProblems(line({ quantity: Number.NaN }))), ['quantity']);
assert.deepEqual(fields(M.packageLineProblems(line({ quantity: M.PACKAGE_MAX_QUANTITY + 1 }))), ['quantity']);
assert.deepEqual(fields(M.packageLineProblems(line({ unitPrice: -1 }))), ['price']);
assert.deepEqual(fields(M.packageLineProblems(line({ unitPrice: Number.NaN }))), ['price']);
assert.deepEqual(fields(M.packageLineProblems(line({ unitPrice: null }))), ['price']);
assert.equal(M.packageLineProblems(line({ quantity: 0 })).length, 0, 'quantity 0 is valid, subtotal 0');
assert.equal(M.packageLineProblems(line()).length, 0);
assert.deepEqual(
  fields(M.packageLineProblems(line({ templateId: undefined, itemName: '   ' }))),
  ['match'],
  'unmatched line is rejected',
);
assert.equal(M.validatePackageLines([])[0].message, '這張單還沒有項目');
assert.equal(M.validatePackageLines(lines).length, 0);

// --- 輸入解析不把壞值靜靜變成有效數字 -------------------------------------
assert.equal(M.parsePackageQuantity(''), 0);
assert.ok(Number.isNaN(M.parsePackageQuantity('abc')));
assert.equal(M.parsePackageQuantity('2.5'), 2.5);
assert.equal(M.parsePackagePrice(''), null);
assert.ok(Number.isNaN(M.parsePackagePrice('abc')));
assert.equal(M.parsePackagePrice('1620.5'), 1620.5);

// --- 快照複製：舊單不跟隨後來的修改 ---------------------------------------
const working = [line()];
const frozen = M.clonePackageLines(working);
working[0].quantity = 99;
working[0].unitPrice = 1;
assert.equal(frozen[0].quantity, 10, 'saved snapshot keeps the original quantity');
assert.equal(frozen[0].unitPrice, 800, 'saved snapshot keeps the original price');
assert.equal(M.totalCents(frozen), 800000, 'saved total does not follow base-price changes');

// --- 來源追溯欄位保留 -----------------------------------------------------
const traced = line({
  templateId: 'tpl-1',
  sourcePitchingId: 'p-1',
  sourcePitchingCode: 'BWF-FD26-001',
  sourceQuotationId: 'q-1',
  sourceQuotationNo: 'Q-2026-018 V2',
  sourceSectionId: 's-1',
  sourceSectionName: '傢俬',
  sourceItem: '員工椅',
  sourceDescription: '網背',
});
assert.equal(M.packageLineProblems(traced).length, 0);
assert.equal(traced.sourceQuotationNo, 'Q-2026-018 V2');
assert.equal(traced.sourceSectionName, '傢俬');

console.log('PASS package pricing money, validation, snapshot and traceability');

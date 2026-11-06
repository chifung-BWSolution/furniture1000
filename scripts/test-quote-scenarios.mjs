import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * 客戶報價「相關家具」用途排序的純邏輯：
 * - 推薦用途以客戶對應設計專案的工程類型優先，其次用 PMS 客戶行業推算，
 *   兩者都沒有就回傳空（正常 A 類目錄）。
 * - 商品用 products.tags（既有可多選標籤）比對，分類／標題作回退。
 * - 排序只把相符商品排前，不會刪除其他家具。
 */

const source = fs.readFileSync('src/lib/quoteScenarios.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

// --- 用途來源 -------------------------------------------------------------
assert.deepEqual(
  Array.from(M.scenariosFromProjectType('office')),
  ['office'],
  '工程類型 → 推薦用途',
);
assert.deepEqual(
  Array.from(M.scenariosFromProjectType('clinic')),
  ['clinic'],
);
assert.deepEqual(
  Array.from(M.scenariosFromProjectType('other')),
  [],
  '其他工程沒有特定用途',
);
assert.deepEqual(Array.from(M.scenariosFromProjectType('unknown')), []);
assert.deepEqual(
  Array.from(M.resolveQuoteScenarios({ formData: { clientIndustry: ['教育 - Education'] } }, 'office')),
  ['office'],
  '工程類型優先於客戶行業',
);
assert.deepEqual(
  Array.from(M.resolveQuoteScenarios({ formData: { clientIndustry: ['教育 - Education'] } })),
  ['school'],
  '沒有工程類型時用客戶行業推算',
);
assert.deepEqual(
  Array.from(M.resolveQuoteScenarios({ formData: { clientIndustry: ['餐飲 - Food & Beverage'] } })),
  ['restaurant'],
);
assert.deepEqual(
  Array.from(M.resolveQuoteScenarios({ formData: { clientIndustry: ['金融 - Finance'] } })),
  ['office'],
);
assert.deepEqual(Array.from(M.resolveQuoteScenarios({ formData: {} }, 'other')), []);
assert.deepEqual(Array.from(M.resolveQuoteScenarios({ formData: {} })), []);
assert.deepEqual(Array.from(M.resolveQuoteScenarios(null)), []);

// --- 商品比對 -------------------------------------------------------------
const products = [
  {
    id: 'p-chair',
    title: '學生椅 Student Chair',
    level1Category: '學校傢俬',
    level2Category: '學生課室',
    tags: ['學生課室', '學校傢俬'],
  },
  {
    id: 'p-desk',
    title: '辦公枱 Office Desk',
    level1Category: '辦公傢俬',
    level2Category: '辦公枱',
    tags: ['辦公枱'],
  },
  {
    id: 'p-table',
    title: '餐桌 Dining Table',
    level1Category: '餐廳傢俬',
    level2Category: '餐桌',
    tags: [],
  },
  {
    id: 'p-sofa',
    title: '梳化 Sofa',
    level1Category: '休閒家具',
    level2Category: '梳化',
    tags: ['SOFA梳化'],
  },
];

assert.deepEqual(
  Array.from(M.productScenarioMatches(products[0], ['school'])),
  ['school'],
);
assert.deepEqual(
  Array.from(M.productScenarioMatches(products[1], ['school'])),
  [],
  '標籤與分類都不符時不算相符',
);
assert.deepEqual(
  Array.from(M.productScenarioMatches(products[2], ['restaurant'])),
  ['restaurant'],
  '沒有標籤時用分類回退',
);

// --- 排序 -----------------------------------------------------------------
const ranked = M.rankProductsForScenarios(products, ['school', 'office']);
assert.equal(ranked[0].id, 'p-chair');
assert.equal(ranked[1].id, 'p-desk');
// 其餘商品保持原本目錄次序，不會被刪除。
assert.deepEqual(
  ranked.map((row) => row.id),
  ['p-chair', 'p-desk', 'p-table', 'p-sofa'],
);

const untouched = M.rankProductsForScenarios(products, []);
assert.deepEqual(
  untouched.map((row) => row.id),
  ['p-chair', 'p-desk', 'p-table', 'p-sofa'],
  '沒有用途時維持原目錄次序',
);

// --- 分類選項 -------------------------------------------------------------
const categories = M.categoryOptionsFromProducts(products);
assert.deepEqual(
  Array.from(categories.level1),
  Array.from(['休閒家具', '學校傢俬', '餐廳傢俬', '辦公傢俬']).sort((a, b) => a.localeCompare(b, 'zh-Hant')),
);
assert.ok(Array.from(categories.level2['學校傢俬'] ?? []).includes('學生課室'));

console.log('PASS quote scenarios: source precedence, tag/category match, ranking and categories');

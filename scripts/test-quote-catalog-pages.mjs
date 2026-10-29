import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-07 圖冊附件純邏輯（離線）：框選正規化、PDF 裁切框、頁面上限、附件標籤。
 * 不含真正的 PDF 合併（需已授權圖冊與瀏覽器），那部分仍列待驗收。
 */

const source = fs.readFileSync('src/lib/quoteCatalogPages.ts', 'utf8');
const start = source.indexOf('export const QUOTE_CATALOG_PAGE_LIMIT');
const end = source.indexOf('export async function listQuoteCatalogs');
assert.ok(start >= 0 && end > start, 'catalog page helpers are present');
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {}, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' } };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

// --- 上限與半頁常數 ------------------------------------------------------
assert.equal(M.QUOTE_CATALOG_PAGE_LIMIT, 24);
assert.deepEqual(Object.assign({}, M.CATALOG_TOP_HALF), { x: 0, y: 0, width: 1, height: 0.5 });
assert.deepEqual(Object.assign({}, M.CATALOG_BOTTOM_HALF), { x: 0, y: 0.5, width: 1, height: 0.5 });

const round = (value) => Number(value.toFixed(6));
const rect = (value) => [round(value.x), round(value.y), round(value.width), round(value.height)];
const box = (value) => [round(value.left), round(value.bottom), round(value.right), round(value.top)];

// --- 框選正規化：夾回圖內、太細丟棄 ----------------------------------
assert.deepEqual(rect(M.parseCatalogCrop({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })), [0.1, 0.2, 0.3, 0.4]);
assert.deepEqual(rect(M.parseCatalogCrop({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 })), [0.9, 0.9, 0.1, 0.1]);
assert.deepEqual(rect(M.parseCatalogCrop({ x: -1, y: -1, width: 0.5, height: 0.5 })), [0, 0, 0.5, 0.5]);
assert.equal(M.parseCatalogCrop({ x: 0, y: 0, width: 0.001, height: 0.5 }), null, 'too narrow is dropped');
assert.equal(M.parseCatalogCrop(null), null);
assert.equal(M.parseCatalogCrop({ x: 'x', y: 0, width: 0.5, height: 0.5 }), null);

// --- PDF 裁切框：左上原點 → PDF 左下原點 -----------------------------
assert.equal(M.catalogCropBox(600, 800, null), undefined, 'whole page has no crop box');
assert.deepEqual(box(M.catalogCropBox(600, 800, M.CATALOG_TOP_HALF)), [0, 400, 600, 800]);
assert.deepEqual(box(M.catalogCropBox(600, 800, M.CATALOG_BOTTOM_HALF)), [0, 0, 600, 400]);
assert.deepEqual(box(M.catalogCropBox(1000, 500, { x: 0.25, y: 0.2, width: 0.5, height: 0.4 })), [250, 200, 750, 400]);

// --- 頁面清單：上限 24、必要欄位、附件標籤 ---------------------------
const pages = M.parseQuoteCatalogPages([
  { documentId: 'doc-1', pageNo: 3, factoryName: '華座', title: '辦公椅', documentYear: 2026, series: 'A' },
  { documentId: 'doc-2', pageNo: 5, factoryName: '未來', crop: { x: 0, y: 0, width: 1, height: 0.5 } },
  { documentId: '', pageNo: 1, factoryName: '無效' },
  { documentId: 'doc-3', pageNo: 0, factoryName: '無效' },
  { documentId: 'doc-4', pageNo: 1 },
]);
assert.equal(pages.length, 2, 'only rows with document, page and factory are kept');
assert.equal(pages[0].title, '辦公椅');
assert.equal(pages[0].crop, null, 'whole page has no crop');
assert.deepEqual(Object.assign({}, pages[1].crop), { x: 0, y: 0, width: 1, height: 0.5 });
assert.equal(M.catalogPageLabel(pages[0]), '華座 · 2026 · A · 辦公椅 · 第 3 頁');
assert.equal(M.catalogPageLabel(pages[1]), '未來 · 第 5 頁框選');
assert.equal(M.catalogPageLabel({ factoryName: 'A', pageNo: 1, title: null, documentYear: null, series: null, crop: null }), 'A · 第 1 頁');

const many = M.parseQuoteCatalogPages(
  Array.from({ length: 30 }, (_, i) => ({ documentId: 'd', pageNo: i + 1, factoryName: 'F' })),
);
assert.equal(many.length, 24, 'attachment list is capped at 24 pages');

// --- 附件標籤：只用頁面資料重建，PDF 本身不再印來源帶 -----------------
// 報價 PDF 附錄只放圖冊頁面本身，不畫頁底來源；標籤僅供編輯器清單辨識。
assert.equal(M.catalogPageLabel(pages[1]).includes('未來'), true);
assert.equal(M.catalogPageLabel(pages[1]).includes('第 5 頁'), true);

console.log('PASS catalog crop boxes, 24-page cap and attachment labels');

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
assert.deepEqual(Object.assign({}, M.CATALOG_SPLIT_LEFT), { x: 0, y: 0, width: 0.5, height: 1 });
assert.deepEqual(Object.assign({}, M.CATALOG_SPLIT_RIGHT), { x: 0.5, y: 0, width: 0.5, height: 1 });

const round = (value) => Number(value.toFixed(6));
const rect = (value) => [round(value.x), round(value.y), round(value.width), round(value.height)];
const box = (value) => [round(value.left), round(value.bottom), round(value.right), round(value.top)];
const pieces = (value) => Array.from(value, (crop) => (crop ? rect(crop) : null));

// --- 跨頁判斷：圖冊把左、右兩個直向版面印在同一張橫向 PDF 頁 ----------
assert.equal(M.isSpreadSize(1207.5591, 824.8819), true, '左右並排的跨頁');
assert.equal(M.isSpreadSize(595, 842), false, 'A4 直向是單頁');
assert.equal(M.isSpreadSize(842, 595), true, '橫向單頁也當成跨頁：整頁輸出會是橫的');
assert.equal(M.isSpreadSize(0, 800), false);

// --- 一張 PDF 頁 → 附錄要出哪幾塊 -------------------------------------
assert.deepEqual(pieces(M.catalogPagePieces({}, 595, 842)), [null], '直向單頁整頁輸出');
assert.deepEqual(pieces(M.catalogPagePieces({ split: 'left' }, 595, 842)), [null], '直向頁不按左右拆');
assert.deepEqual(
  pieces(M.catalogPagePieces({}, 1207.5591, 824.8819)),
  [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  '跨頁整頁＝左、右兩個直向版面',
);
assert.deepEqual(pieces(M.catalogPagePieces({ split: 'right' }, 1207.5591, 824.8819)), [[0.5, 0, 0.5, 1]]);
const framed = { x: 0.1, y: 0.1, width: 0.3, height: 0.3 };
assert.deepEqual(pieces(M.catalogPagePieces({ crop: framed, split: 'left' }, 1207.5591, 824.8819)), [rect(framed)], '框選優先於左右拆頁');
assert.deepEqual(pieces(M.catalogPagePieces({ crop: framed }, 595, 842)), [rect(framed)]);

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

// 跨頁的「左半」在 PDF 座標是寬 0.5、高 1 的左半邊，輸出頁仍然是直向。
assert.deepEqual(box(M.catalogCropBox(1207.5591, 824.8819, M.CATALOG_SPLIT_LEFT)), [0, 0, 603.77955, 824.8819]);
assert.deepEqual(M.normalizePageRotation(-450), 270);
assert.deepEqual(M.normalizePageRotation(90), 90);
assert.deepEqual(M.normalizePageRotation(720), 0);

// /Rotate 90：看到的方向 = (高, 寬)，看到的左半 = PDF 的下半。
assert.deepEqual(box(M.catalogCropBox(1200, 800, M.CATALOG_SPLIT_LEFT, 90)), [0, 0, 1200, 400]);
assert.deepEqual(box(M.catalogCropBox(1200, 800, M.CATALOG_TOP_HALF, 90)), [0, 0, 600, 800]);
assert.deepEqual(box(M.catalogCropBox(1200, 800, M.CATALOG_TOP_HALF, 180)), [0, 0, 1200, 400]);
assert.deepEqual(box(M.catalogCropBox(1200, 800, M.CATALOG_SPLIT_LEFT, 270)), [0, 400, 1200, 800]);

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

// --- 跨頁左右半：解析、標籤、舊資料轉換 -------------------------------
const splitPages = M.parseQuoteCatalogPages([
  { documentId: 'doc-9', pageNo: 8, factoryName: '向氏', split: 'left' },
  { documentId: 'doc-9', pageNo: 8, factoryName: '向氏', split: 'right' },
  { documentId: 'doc-9', pageNo: 9, factoryName: '向氏', split: 'bogus' },
  { documentId: 'doc-9', pageNo: 10, factoryName: '向氏', split: 'left', crop: { x: 0, y: 0, width: 1, height: 1 } },
]);
assert.equal(splitPages.length, 4);
assert.equal(splitPages[0].split, 'left');
assert.equal(splitPages[1].split, 'right');
assert.equal(splitPages[2].split, null, 'unknown split value is dropped');
assert.equal(splitPages[3].split, null, 'an explicit crop wins over the left/right split');
assert.equal(M.catalogPageLabel(splitPages[0]), '向氏 · 第 8 頁左半');
assert.equal(M.catalogPageLabel(splitPages[1]), '向氏 · 第 8 頁右半');
assert.equal(M.catalogPageLabel(splitPages[3]), '向氏 · 第 10 頁框選');

// --- 清單短標籤：整頁／上下半／左右半／框選 ---------------------------
assert.equal(M.catalogPageBadge({}), '整頁');
assert.equal(M.catalogPageBadge({ split: 'left' }), '左半');
assert.equal(M.catalogPageBadge({ split: 'right' }), '右半');
assert.equal(M.catalogPageBadge({ crop: { x: 0, y: 0, width: 1, height: 0.5 } }), '上半頁');
assert.equal(M.catalogPageBadge({ crop: { x: 0, y: 0.5, width: 1, height: 0.5 } }), '下半頁');
assert.equal(M.catalogPageBadge({ crop: { x: 0, y: 0, width: 0.5, height: 1 } }), '左半');
assert.equal(M.catalogPageBadge({ crop: { x: 0.5, y: 0, width: 0.5, height: 1 } }), '右半');
assert.equal(M.catalogPageBadge({ crop: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 } }), '框選');

const base = { factoryName: 'F', title: null, documentYear: null, series: null, crop: null, split: null };
const legacy = [
  { ...base, id: 'a', documentId: 'doc-1', pageNo: 2 },
  { ...base, id: 'b', documentId: 'doc-1', pageNo: 3, crop: { x: 0, y: 0, width: 1, height: 0.5 } },
  { ...base, id: 'c', documentId: 'doc-2', pageNo: 4 },
];
const converted = M.splitSpreadAttachments(legacy, 'doc-1');
assert.equal(converted.length, 4, 'one whole page becomes a left and a right piece');
assert.deepEqual(
  Array.from(converted, (page) => [page.documentId, page.pageNo, page.split]),
  [['doc-1', 2, 'left'], ['doc-1', 2, 'right'], ['doc-1', 3, null], ['doc-2', 4, null]],
  'crops and other catalogs stay as they were',
);
assert.equal(M.splitSpreadAttachments(converted, 'doc-1'), converted, 'already split rows are left alone');

const spreadMany = M.splitSpreadAttachments(
  Array.from({ length: 24 }, (_, i) => ({ ...base, id: `s${i}`, documentId: 'doc-1', pageNo: i + 1 })),
  'doc-1',
);
assert.equal(spreadMany.length, 24, 'splitting still obeys the 24-piece cap');

console.log('PASS catalog crop boxes, spread split, 24-page cap and attachment labels');

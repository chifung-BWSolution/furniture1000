import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-13 報價分區資料規則（離線）：矩形範圍、最多 24 區、換圖重新確認、
 * 刪分區移除範圍與圖片、每區最多 8 張圖。純資料層，不呼叫 Gemini。
 */

const source = fs.readFileSync('src/lib/quoteFloorPlan.ts', 'utf8');
// Everything before the Gemini/fetch helpers is pure data logic (import.meta.env
// cannot run inside a vm script, and those helpers are not under test here).
const cut = source.indexOf('/** Read labeled rooms and their boxes off a floor-plan JPEG.');
assert.ok(cut > 0, 'pure floor-plan helpers are present');
const code = ts.transpileModule(source.slice(0, cut), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {}, console };
sandbox.module = { exports: sandbox.exports };
sandbox.require = (id) => {
  if (String(id).includes('imageStorage')) {
    return { isHttpImageUrl: (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim()) };
  }
  return { DEFAULT_GEMINI_MODEL: 'test-model' };
};
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

// --- 矩形：必須在圖內，太細的框丟棄 --------------------------------
assert.deepEqual(Object.assign({}, M.normalizeZoneRect({ x: 10, y: 20, w: 30, h: 25 })), { x: 10, y: 20, w: 30, h: 25 });
assert.deepEqual(Object.assign({}, M.normalizeZoneRect({ x: 90, y: 90, w: 50, h: 50 })), { x: 90, y: 90, w: 10, h: 10 });
assert.deepEqual(Object.assign({}, M.normalizeZoneRect([0.1, 0.2, 0.3, 0.4])), { x: 10, y: 20, w: 30, h: 40 });
assert.equal(M.normalizeZoneRect({ x: 0, y: 0, w: 1.5, h: 1.5 }), null, 'too small is dropped');
assert.equal(M.normalizeZoneRect({ x: 'x', y: 0, w: 10, h: 10 }), null, 'non numeric is dropped');
assert.deepEqual(Object.assign({}, M.normalizeZoneRect({ rect: { x: 5, y: 5, w: 20, h: 20 } })), { x: 5, y: 5, w: 20, h: 20 });

// --- 最多 24 區、同一分區只留一個範圍 ------------------------------
const many = Array.from({ length: 30 }, (_, i) => ({ zoneId: `z${i}`, rect: { x: 1, y: 1, w: 5, h: 5 }, confirmed: true }));
assert.equal(M.parseQuoteZoneRegions(many).length, 24, 'regions are capped at 24');
const duplicate = M.parseQuoteZoneRegions([
  { zoneId: 'z1', rect: { x: 1, y: 1, w: 5, h: 5 }, confirmed: true },
  { zoneId: 'z1', rect: { x: 20, y: 20, w: 5, h: 5 }, confirmed: true },
]);
assert.equal(duplicate.length, 1);
assert.equal(duplicate[0].rect.x, 1);
assert.equal(duplicate[0].confirmed, true);

// --- 換圖後需要重新確認 --------------------------------------------
const regions = M.parseQuoteZoneRegions([
  { zoneId: 'a', rect: { x: 1, y: 1, w: 5, h: 5 }, confirmed: true },
]);
const unconfirmed = M.unconfirmZoneRegions(regions);
assert.equal(unconfirmed[0].confirmed, false, 'changing the floor plan unconfirms ranges');
assert.equal(regions[0].confirmed, true, 'original list is not mutated');

// --- 只有畫了框的分區才會有範圍；確認後才成立 ----------------------
const rows = [
  { id: 'a', name: '老闆房', nameEn: '', spaceType: '', quantity: 1, rect: { x: 10, y: 10, w: 20, h: 20 } },
  { id: 'b', name: '會議室', nameEn: '', spaceType: '', quantity: 1, rect: null },
];
const fromRows = M.regionsFromZoneRows(rows);
assert.deepEqual(Array.from(fromRows, (row) => row.zoneId), ['a']);
assert.equal(fromRows[0].confirmed, true);

// --- 識別結果疊上既有分區 ------------------------------------------
let seq = 0;
const existing = [
  { id: 'z-a', name: '會議室', nameEn: '', spaceType: '', quantity: 1, rect: { x: 1, y: 1, w: 10, h: 10 } },
  { id: 'z-b', name: '舊儲物室', nameEn: '', spaceType: '', quantity: 1, rect: null },
];
const detected = [
  { name: ' 會議室 ', rect: { x: 30, y: 30, w: 10, h: 10 } },
  { name: '老闆房', rect: { x: 50, y: 50, w: 10, h: 10 } },
  { name: '老闆房', rect: { x: 60, y: 60, w: 10, h: 10 } },
  { name: '   ', rect: null },
];
const applied = M.applyDetectedZones(existing, detected, () => `new-${++seq}`);
assert.equal(applied.added, 1, 'only genuinely new room names are added');
assert.deepEqual(Array.from(applied.rows, (row) => row.name), ['老闆房', '會議室', '舊儲物室']);
assert.equal(applied.rows[0].rect.x, 50, 'new room keeps its detected box');
assert.equal(applied.rows[1].id, 'z-a', 'existing room is matched by name');
assert.equal(applied.rows[1].rect.x, 30, 'existing room takes the new box');
assert.equal(applied.rows[2].rect, null, 'room without a box stays name-only');

// 超過 24 區就不再新增
const full = Array.from({ length: 24 }, (_, i) => ({
  id: `z${i}`, name: `房間${i}`, nameEn: '', spaceType: '', quantity: 1, rect: null,
}));
const capped = M.applyDetectedZones(full, [{ name: '新房間', rect: { x: 1, y: 1, w: 5, h: 5 } }], () => 'x');
assert.equal(capped.added, 0, 'never invents more than 24 rooms');

// --- 每區最多 8 張圖、只收 http(s)、去重 ---------------------------
const images = M.parseQuoteZoneImages({
  zoneA: [
    'https://cdn.example.com/1.jpg',
    'https://cdn.example.com/1.jpg',
    'data:image/png;base64,AAA',
    ...Array.from({ length: 10 }, (_, i) => `https://cdn.example.com/${i + 2}.jpg`),
  ],
  unzoned: ['https://cdn.example.com/u.jpg'],
  zoneB: [],
});
assert.equal(images.zoneA.length, 8, 'zone images capped at 8');
assert.equal(images.unzoned.length, 1, 'unzoned uploads are kept');
assert.equal(images.zoneB, undefined, 'empty lists are dropped');

// --- 刪分區要移除它的圖片，但保留 unzoned --------------------------
const pruned = M.pruneQuoteZoneImages(
  {
    'z-a': ['https://cdn.example.com/a.jpg'],
    'z-gone': ['https://cdn.example.com/gone.jpg'],
    unzoned: ['https://cdn.example.com/u.jpg'],
  },
  ['z-a'],
);
assert.deepEqual(Object.keys(pruned).sort(), ['unzoned', 'z-a']);

// --- 平面圖解析 -----------------------------------------------------
const plan = M.parseQuoteFloorPlan({
  url: 'https://cdn.example.com/plan.pdf',
  mimeType: 'application/pdf',
  fileName: 'plan.pdf',
  previewUrl: 'https://cdn.example.com/plan.png',
  regions: [{ zoneId: 'z-a', rect: { x: 1, y: 2, w: 30, h: 40 }, confirmed: false }],
});
assert.equal(plan.url, 'https://cdn.example.com/plan.pdf');
assert.equal(plan.previewUrl, 'https://cdn.example.com/plan.png');
assert.equal(plan.regions.length, 1);
assert.equal(plan.regions[0].confirmed, false);
assert.equal(plan.fileName, 'plan.pdf');
assert.equal(M.parseQuoteFloorPlan({ url: 'javascript:alert(1)' }), null, 'non http floor plan is rejected');
assert.equal(
  M.parseQuoteFloorPlan({ url: 'https://cdn.example.com/plan.png', previewUrl: 'blob:abc' }).previewUrl,
  null,
  'unsafe preview url is dropped',
);

console.log('PASS quote zone rects, 24-zone cap, reconfirm, image cap and prune');

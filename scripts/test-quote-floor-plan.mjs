import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * FDS-13 報價分區資料規則（離線）：矩形範圍、最多 24 區、換圖重新確認、
 * 刪分區移除範圍與圖片、每區最多 8 張圖。純資料層，不呼叫 Gemini。
 */

const source = fs.readFileSync('src/lib/quoteFloorPlan.ts', 'utf8');
// Everything above the Gemini marker is pure data logic (import.meta.env cannot
// run inside a vm script, and the network helpers are not under test here).
const cut = source.indexOf('// ---- Gemini: prompts and network calls below this line ----');
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

// --- 最多 24 區；同一空間可以有多個範圍（複製），完全相同的框才合併 -----
const many = Array.from({ length: 30 }, (_, i) => ({ zoneId: `z${i}`, rect: { x: 1, y: 1, w: 5, h: 5 }, confirmed: true }));
assert.equal(M.parseQuoteZoneRegions(many).length, 24, 'regions are capped at 24');
const duplicate = M.parseQuoteZoneRegions([
  { zoneId: 'z1', rect: { x: 1, y: 1, w: 5, h: 5 }, confirmed: true },
  { zoneId: 'z1', rect: { x: 20, y: 20, w: 5, h: 5 }, confirmed: true },
  { zoneId: 'z1', rect: { x: 20, y: 20, w: 5, h: 5 }, confirmed: true },
]);
assert.equal(duplicate.length, 2, 'one space keeps its copied areas');
assert.equal(duplicate[0].rect.x, 1);
assert.equal(duplicate[1].rect.x, 20);
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

// 複製出來的第二個範圍要一併保存，同一個空間共用同一個 zoneId
const copied = M.regionsFromZoneRows([
  {
    id: 'z-open',
    name: '開放辦公區',
    nameEn: '',
    spaceType: '',
    quantity: 2,
    rect: { x: 10, y: 10, w: 20, h: 20 },
    rects: [{ x: 10, y: 10, w: 20, h: 20 }, { x: 60, y: 55, w: 15, h: 12 }],
  },
  { id: 'z-empty', name: '未框選', nameEn: '', spaceType: '', quantity: 1, rect: null, rects: [] },
]);
assert.deepEqual(Array.from(copied, (row) => row.zoneId), ['z-open', 'z-open']);
assert.deepEqual(Array.from(copied, (row) => row.rect.x), [10, 60]);
assert.equal(copied[1].confirmed, true);

// 舊資料只有 rect 時仍然只有一個範圍（不會重複）
const legacy = M.regionsFromZoneRows([
  { id: 'z-old', name: '舊空間', nameEn: '', spaceType: '', quantity: 1, rect: { x: 5, y: 5, w: 10, h: 10 } },
]);
assert.equal(legacy.length, 1);

// 存檔 → 重開：多個範圍要原樣回到列表
const reopened = M.parseQuoteZoneRegions(Array.from(copied, (row) => ({ ...row })));
assert.equal(reopened.length, 2);
assert.deepEqual(Array.from(reopened, (row) => row.zoneId), ['z-open', 'z-open']);

// --- 畫布：一個空間多個範圍（複製）要獨立拖動，列表仍是一個空間 --------------
const canvasZones = {
  id: 'a', name: '開放辦公區', nameEn: '', spaceType: '', quantity: 1,
  rect: { x: 10, y: 10, w: 20, h: 20 },
  rects: [{ x: 10, y: 10, w: 20, h: 20 }, { x: 60, y: 55, w: 15, h: 12 }],
};
const canvasRows = M.zoneCanvasRows([canvasZones, { id: 'b', name: '儲物室', nameEn: '', spaceType: '', quantity: 1, rect: { x: 80, y: 5, w: 10, h: 10 } }, { id: 'c', name: '未框選', nameEn: '', spaceType: '', quantity: 1, rect: null }]);
assert.deepEqual(Array.from(canvasRows, (row) => row.id), ['a::0', 'a::1', 'b::0', 'c::0']);
assert.equal(canvasRows[1].rect.x, 60, 'the copied area keeps its own box');
assert.equal(canvasRows[3].rect, null, 'a space without an area still gets a canvas row');

// 拖動第二個範圍：只影響那一個，列表仍然一個空間
const movedCanvas = Array.from(canvasRows, (row) => (row.id === 'a::1' ? { ...row, rect: { ...row.rect, x: 62 } } : row));
const moved = M.applyZoneCanvasChange([canvasZones], movedCanvas);
assert.equal(moved.length, 1);
assert.deepEqual(Array.from(moved[0].rects, (rect) => rect.x), [10, 62]);
assert.equal(moved[0].rect.x, 10, 'the first area stays the zone rect');

// 刪掉其中一個範圍：空間仍在，範圍少一個
const oneArea = M.applyZoneCanvasChange([canvasZones], canvasRows.filter((row) => row.id !== 'a::1'));
assert.equal(oneArea[0].rects.length, 1);

// 把最後一個範圍也刪掉：空間列一併移除（與現在的行為一致）
const noAreas = M.applyZoneCanvasChange([canvasZones], []);
assert.equal(noAreas.length, 0, 'deleting every area removes the space');

// 空白處畫新框：新增一個空間
const drawn = M.applyZoneCanvasChange([], [{ ...canvasZones, id: 'fresh', rect: { x: 5, y: 6, w: 7, h: 8 }, rects: undefined }]);
assert.equal(drawn.length, 1);
assert.equal(drawn[0].id, 'fresh');
assert.deepEqual(Array.from(drawn[0].rects, (rect) => rect.x), [5]);

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

// 重新識別到同一個空間時，新的框要取代它舊的多個範圍
const reboxed = M.applyDetectedZones(
  [{
    id: 'z-a', name: '會議室', nameEn: '', spaceType: '', quantity: 1,
    rect: { x: 1, y: 1, w: 10, h: 10 },
    rects: [{ x: 1, y: 1, w: 10, h: 10 }, { x: 40, y: 40, w: 10, h: 10 }],
  }],
  [{ name: '會議室', rect: { x: 30, y: 30, w: 10, h: 10 } }],
  () => 'detected',
);
assert.deepEqual(Array.from(reboxed.rows[0].rects, (rect) => rect.x), [30], 'a new box replaces the old areas');

// 超過 24 區就不再新增
const full = Array.from({ length: 24 }, (_, i) => ({
  id: `z${i}`, name: `房間${i}`, nameEn: '', spaceType: '', quantity: 1, rect: null,
}));
const capped = M.applyDetectedZones(full, [{ name: '新房間', rect: { x: 1, y: 1, w: 5, h: 5 } }], () => 'x');
assert.equal(capped.added, 0, 'never invents more than 24 rooms');

// --- 模型輸出的框要收得下（名稱照收，框盡量收）----------------------
const percentText = `\`\`\`json
{"zones":[
  {"name":"STORAGE","x":4,"y":30,"w":5,"h":12},
  {"name":"MEETING RM 1","x":9,"y":30,"w":5,"h":12},
  {"name":"WORKING AREA"}
]}
\`\`\``;
const percentZones = M.zonesFromDetectedText(percentText);
assert.deepEqual(Array.from(percentZones, (zone) => zone.name), ['STORAGE', 'MEETING RM 1', 'WORKING AREA']);
assert.deepEqual(Object.assign({}, percentZones[0].rect), { x: 4, y: 30, w: 5, h: 12 });
assert.equal(percentZones[2].rect, null, 'a name without a box stays name-only');

// 0–1000（Gemini 的 box 慣例）不可以被夾成 0 寬而被丟掉
const thousand = M.zonesFromDetectedText(JSON.stringify({
  zones: [
    { name: 'STORAGE', box_2d: [301, 39, 414, 93] },
    { name: 'PANTRY', box_2d: [484, 68, 638, 157] },
  ],
}));
assert.deepEqual(Object.assign({}, thousand[0].rect), { x: 3.9, y: 30.1, w: 5.4, h: 11.3 });
assert.deepEqual(Object.assign({}, thousand[1].rect), { x: 6.8, y: 48.4, w: 8.9, h: 15.4 });

// 同一份答案用 x/y/w/h 寫 0–1000 也要換算
const thousandKeys = M.zonesFromDetectedText(JSON.stringify({
  zones: [
    { name: 'STORAGE', x: 40, y: 300, w: 50, h: 120 },
    { name: 'PANTRY', x: 80, y: 500, w: 70, h: 140 },
  ],
}));
assert.deepEqual(Object.assign({}, thousandKeys[0].rect), { x: 4, y: 30, w: 5, h: 12 });

// 對角兩點、百分比字串、0–1 分數、label 與 rooms 都要認得
const mixed = M.zonesFromDetectedText(JSON.stringify({
  rooms: [
    { label: 'STORAGE', x1: 10, y1: 20, x2: 30, y2: 40 },
    { name: 'MEETING RM 2', x: '14%', 'y': '30%', w: '8%', h: '12%' },
  ],
}));
assert.deepEqual(Object.assign({}, mixed[0].rect), { x: 10, y: 20, w: 20, h: 20 });
assert.deepEqual(Object.assign({}, mixed[1].rect), { x: 14, y: 30, w: 8, h: 12 });

const fractions = M.zonesFromDetectedText(JSON.stringify({
  zones: [{ name: 'A', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
}));
assert.deepEqual(Object.assign({}, fractions[0].rect), { x: 10, y: 20, w: 30, h: 40 });

// 一個框都沒有時，名稱仍然保留（使用者可以在圖上補框）
assert.deepEqual(
  Array.from(M.zonesFromDetectedText('{"zones":[{"name":"SERVER"},{"name":"PANTRY"}]}'), (zone) => zone.rect),
  [null, null],
);
assert.equal(M.zonesFromDetectedText('no json here').length, 0, 'unparsable answers yield no zones');

// 單一個略為爆出 100 的百分比框，仍然當百分比處理
const slightOverflow = M.zonesFromDetectedText(JSON.stringify({
  zones: [{ name: 'PANTRY', x: 95, y: 60, w: 20, h: 25 }],
}));
assert.deepEqual(Object.assign({}, slightOverflow[0].rect), { x: 95, y: 60, w: 5, h: 25 });

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, mocks = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('import.meta.env', '({})');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => mocks[id] || {}, console, URL });
  return exports;
}
const { layoutZones, layoutDescription, detectedLayoutNotes, productSheet, groupZoneRects } = load('../src/lib/quoteLayoutRender.ts');
const placement = load('../src/lib/quoteFurniturePlacement.ts');
const { parseQuoteFloorPlan, zonesFromDetectedText } = load('../src/lib/quoteFloorPlan.ts', { './quoteFurniturePlacement': placement, '@/lib/imageStorage': { isHttpImageUrl: v => typeof v === 'string' && /^https?:/.test(v) } });
const product = (id, extra = {}) => ({ id, name: id, image: '', quantity: 2, ...extra });
test('rendering reports missing product images instead of silently omitting products', async () => {
  await assert.rejects(productSheet([{ id: 'room', name: 'Room', products: [product('desk', { image: 'https://example.com/desk.jpg' }), product('chair')] }]), /chair/);
});
test('groups products by section and excludes unzoned, terms and optional alternatives', () => {
  const zones = layoutZones([product('unzoned'), product('room-a', { isSectionTitle: true }), product('desk'), product('option', { isOptional: true }), product('term', { isCustomTerm: true }), product('room-b', { isSectionTitle: true }), product('chair')]);
  assert.deepEqual(JSON.parse(JSON.stringify(zones.map(z => [z.id, z.products.map(p => p.id)]))), [['room-a', ['desk']], ['room-b', ['chair']]]);
});
test('generation description retains quantities, dimensions, materials and multiple zone ranges', () => {
  const zones = layoutZones([product('a', { isSectionTitle: true }), product('desk', { material: 'oak', dimensionLMm: '1200' })]);
  const regions = [{ zoneId: 'a', rect: { x: 1, y: 2, w: 10, h: 20 } }, { zoneId: 'a', rect: { x: 40, y: 2, w: 10, h: 20 } }];
  const description = JSON.parse(layoutDescription(zones, { regions }));
  assert.equal(description[0].regions.length, 2);
  assert.equal(description[0].products[0].quantity, 2);
  assert.equal(description[0].products[0].dimensionsMm[0], '1200');
  assert.equal(description[0].products[0].material, 'oak');
});
test('floor plan reload retains render settings and Storage URLs while rejecting base64 results', () => {
  const parsed = parseQuoteFloorPlan({ url: 'https://example.com/plan.png', regions: [], rendering: { style: 'warm', notes: { a: 'desk faces south', invalid: 5 }, images: { overview: 'https://example.com/render.jpg', bad: 'data:image/png;base64,abc' } } });
  assert.equal(parsed.rendering.style, 'warm');
  assert.equal(parsed.rendering.notes.a, 'desk faces south');
  assert.equal(parsed.rendering.notes.invalid, undefined);
  assert.equal(parsed.rendering.images.bad, undefined);
  assert.equal(parsed.rendering.images.overview, 'https://example.com/render.jpg');
});


test('upload recognition retains furniture positions and matches notes to quote zone IDs', () => {
  const detected = zonesFromDetectedText(JSON.stringify({ zones: [{ name: 'MEETING ROOM', x: 10, y: 20, w: 40, h: 30, furnitureLayout: '會議桌中心(30,35)，朝向90度；6張椅子' }] }));
  assert.equal(detected[0].furnitureLayout, '會議桌中心(30,35)，朝向90度；6張椅子');
  const notes = detectedLayoutNotes([{ id: 'quote-zone-1', name: ' meeting room ' }, { id: 'other', name: 'Pantry' }], detected);
  assert.equal(notes['quote-zone-1'], detected[0].furnitureLayout);
  assert.equal(notes.other, undefined);
});
test('legacy zone recognition remains compatible when furniture layout is missing', () => {
  const detected = zonesFromDetectedText('{"zones":[{"name":"ROOM","x":0,"y":0,"w":40,"h":40}]}');
  assert.equal(detected[0].name, 'ROOM');
  assert.equal(Object.hasOwn(detected[0], 'furnitureLayout'), false);
  assert.equal(Object.keys(detectedLayoutNotes([{ id: 'a', name: 'ROOM' }], detected)).length, 0);
});

test('multi-area zones group touching rects into one room and keep separate rooms apart', () => {
  const rect = (x, y, w, h) => ({ x, y, w, h });
  // 4 間互不相連的 MANAGER ROOM：4 個候選區域，生成時只會抽其中一間。
  assert.equal(groupZoneRects([rect(10, 10, 20, 20), rect(60, 10, 20, 20), rect(10, 40, 20, 20), rect(60, 40, 20, 20)]).length, 4);
  // 同一間房被拆成兩個重疊或緊貼的框：仍算一間，不應該只生成半間。
  assert.equal(groupZoneRects([rect(10, 10, 20, 20), rect(15, 15, 20, 20)]).length, 1);
  assert.equal(groupZoneRects([rect(10, 10, 20, 20), rect(30, 10, 20, 20)]).length, 1);
  // 中間有明顯空隙才當成不同區域。
  assert.equal(groupZoneRects([rect(10, 10, 20, 20), rect(31, 10, 20, 20)]).length, 2);
});

test('automatic positions require a confident exact product match and respect quantity', () => {
  const positions = placement.parseFurniturePositions([
    { x: 10, y: 20, category: 'desk', productId: 'desk', confidence: 0.95, angle: 90 },
    { x: 20, y: 20, category: 'chair', productId: 'chair', confidence: 0.4 },
    { x: 30, y: 20, productId: 'desk', confidence: 0.99 },
    { x: 40, y: 20, productId: 'outside-zone', confidence: 1 },
  ]);
  const result = placement.autoFurniturePlacements([{ id: 'zone-a', name: 'Room' }], [{ name: 'ROOM', positions }], [{ id: 'zone-a', products: [{ id: 'desk', quantity: 1 }, { id: 'chair', quantity: 2 }] }]);
  assert.equal(result.assignments.desk.length, 1);
  assert.equal(result.assignments.desk[0], 'zone-a:P1');
  assert.equal(result.assignments.chair.length, 0);
  assert.equal(result.assignments['outside-zone'], undefined);
});
test('manual selection enforces one product instance per position and supports clearing', () => {
  const positions = placement.parseFurniturePositions([{ x: 20, y: 20 }]);
  const initial = { positions: { zone: positions }, assignments: { a: ['P1'], b: [] } };
  const assigned = placement.assignFurniturePosition(initial, 'zone', ['a', 'b'], 'b', 0, 'P1');
  assert.equal(assigned.assignments.a[0], '');
  assert.equal(assigned.assignments.b[0], 'P1');
  const cleared = placement.assignFurniturePosition(assigned, 'zone', ['a', 'b'], 'b', 0, '');
  assert.equal(cleared.assignments.b[0], '');
  assert.equal(placement.assignFurniturePosition(initial, 'zone', ['a'], 'a', 0, 'P2'), initial);
});
test('position IDs remain stable across reload and invalid coordinates stay absent', () => {
  const parsed = parseQuoteFloorPlan({ url: 'https://example.com/plan.png', regions: [], placements: { positions: { zone: [
    { id: 'zone:P2', x: 40, y: 35, angle: null, category: 'chair' },
    { x: -1, y: 20 }, { x: 40, y: 101 }, { x: '20', y: 30 },
  ] }, assignments: { item: ['zone:P2'] } } });
  assert.equal(parsed.placements.positions.zone.length, 1);
  assert.equal(parsed.placements.positions.zone[0].id, 'zone:P2');
  assert.equal(parsed.placements.positions.zone[0].label, 'P2');
  assert.equal(parsed.placements.assignments.item[0], 'zone:P2');
});
test('rendering uses selected positions within the product zone and quantity', () => {
  const zones = layoutZones([product('a', { isSectionTitle: true }), product('desk', { quantity: 1 })]);
  const pos = { id: 'a:P1', label: 'P1', category: 'desk', x: 10, y: 20, angle: 90 };
  const description = JSON.parse(layoutDescription(zones, { regions: [], placements: { positions: { a: [pos] }, assignments: { desk: ['a:P1', 'a:P1'] } } }));
  assert.equal(description[0].products[0].placements.length, 1);
  assert.equal(description[0].products[0].placements[0].angle, 90);
});

test('drawing in a cropped zone maps to original plan coordinates in either drag direction', () => {
  const zone = { x: 20, y: 30, w: 40, h: 50 };
  const rect = placement.furnitureRectFromDrag(zone, { x: 75, y: 80 }, { x: 25, y: 20 });
  assert.equal(rect.x, 30); assert.equal(rect.y, 40); assert.equal(rect.w, 20); assert.equal(rect.h, 30);
  assert.equal(placement.furnitureRectFromDrag(zone, { x: 20, y: 20 }, { x: 20.1, y: 20.1 }), null);
  const clamped = placement.furnitureRectFromDrag(zone, { x: -10, y: -5 }, { x: 110, y: 120 });
  assert.equal(clamped.x, 20); assert.equal(clamped.y, 30); assert.equal(clamped.w, 40); assert.equal(clamped.h, 50);
});
test('manual selection saves a bounding box, center and direction and survives quote reload', () => {
  const initial = { positions: { zone: [] }, assignments: {} };
  const saved = placement.saveFurnitureSelection(initial, 'zone', ['desk'], 'desk', 0, { category: 'desk', angle: 90, rect: { x: 10, y: 20, w: 8, h: 6 } });
  assert.equal(initial.positions.zone.length, 0);
  assert.equal(saved.assignments.desk[0], 'zone:P1');
  assert.equal(saved.positions.zone[0].x, 14);
  assert.equal(saved.positions.zone[0].y, 23);
  const reloaded = placement.parseFurniturePlacements(JSON.parse(JSON.stringify(saved)));
  assert.equal(reloaded.positions.zone[0].rect.w, 8);
  assert.equal(reloaded.positions.zone[0].angle, 90);
  assert.equal(reloaded.assignments.desk[0], 'zone:P1');
});
test('selecting a later product instance keeps earlier unknown positions blank on reload', () => {
  const initial = { positions: { zone: [{ id: 'zone:P1', label: 'P1', x: 10, y: 20, category: 'desk', angle: null }] }, assignments: {} };
  const selected = placement.saveFurnitureSelection(initial, 'zone', ['desk'], 'desk', 1, { category: 'desk', positionId: 'zone:P1', angle: null });
  const reloaded = placement.parseFurniturePlacements(JSON.parse(JSON.stringify(selected)));
  assert.equal(reloaded.assignments.desk.length, 2);
  assert.equal(reloaded.assignments.desk[0], '');
  assert.equal(reloaded.assignments.desk[1], 'zone:P1');
});
test('manual selection rejects invalid boxes and unknown positions without modifying assignments', () => {
  const initial = { positions: {}, assignments: {} };
  assert.equal(placement.saveFurnitureSelection(initial, 'zone', ['desk'], 'desk', 0, { category: 'desk', angle: null, rect: { x: 95, y: 20, w: 10, h: 5 } }), initial);
  assert.equal(placement.saveFurnitureSelection(initial, 'zone', ['desk'], 'desk', 0, { category: 'desk', angle: null, positionId: 'missing' }), initial);
});


test('render references require explicit confirmation and replace scene images without changing quote products', () => {
  const { confirmedLayoutProducts } = load('../src/lib/quoteLayoutRender.ts');
  const zone = { id: 'room', products: [product('desk', { image: 'https://example.com/scene.jpg' })] };
  assert.throws(() => confirmedLayoutProducts(zone), /desk/);
  const chosen = confirmedLayoutProducts(zone, { desk: 'https://example.com/single.jpg' });
  assert.equal(chosen[0].image, 'https://example.com/single.jpg');
  assert.equal(zone.products[0].image, 'https://example.com/scene.jpg');
});

test('render product image choices survive reload and reject embedded image data', () => {
  const result = parseQuoteFloorPlan({ url: 'https://example.com/plan.png', regions: [], rendering: { productImages: { desk: 'https://example.com/single.jpg', bad: 'data:image/png;base64,abc' } } });
  assert.equal(result.rendering.productImages.desk, 'https://example.com/single.jpg');
  assert.equal(result.rendering.productImages.bad, undefined);
});

test('render reference URLs list the main product image first, then the gallery', () => {
  const { renderReferenceImages } = load('../src/lib/quoteRenderProductImages.ts', {
    './supabase': { supabase: { auth: { getSession: async () => ({ data: {} }) } } },
    './geminiModel': { DEFAULT_GEMINI_MODEL: 'test' },
    './productSearch': { fetchProductDetail: async () => null },
    './quoteFloorPlan': { imageBlobToJpegBase64: async () => '' },
    './quotePhotoLibrary': { generateQuoteReferenceImage: async () => ({ url: '' }) },
  });
  const gallery = renderReferenceImages({ images: ['https://e/1.jpg', 'https://e/2.jpg'], image_urls: ['https://e/1.jpg', 'https://e/3.jpg'], image_url: 'https://e/1.jpg' }, { image: 'https://e/1.jpg' });
  assert.deepEqual(JSON.parse(JSON.stringify(gallery)), ['https://e/1.jpg', 'https://e/2.jpg', 'https://e/3.jpg']);
  const single = renderReferenceImages({ images: ['https://e/1.jpg'], image_url: 'https://e/1.jpg' }, { image: 'https://e/1.jpg' });
  assert.deepEqual(JSON.parse(JSON.stringify(single)), ['https://e/1.jpg']);
});

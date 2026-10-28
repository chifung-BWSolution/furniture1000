import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
function load(path, deps = {}) {
  const c = { exports: {}, require: name => deps[name] ?? require(name), Date, crypto, structuredClone };
  vm.createContext(c);
  vm.runInContext(ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, c);
  return c.exports;
}
const p = load('../src/lib/furnitureParametric.ts');
const k = load('../src/lib/furnitureKeyDimensions.ts', { './furnitureParametric': p });
const e = load('../src/lib/modelEvidence.ts');

// PRD 典型案例：資料 1400 × 700 × 750，圖紙標註板厚 25，照片見四腳，沒有腳距。
const desk = [{ part_id: 'top', name: '桌板', shape: 'box', role: 'top', form: 'panel', size_mm: [1400, 700, 25], center_mm: [0, 0, 737.5], connects_to: [1, 2, 3, 4] }];
for (const x of [-650, 650]) for (const y of [-300, 300]) desk.push({ name: '腳', shape: 'box', role: 'leg', form: 'straight', size_mm: [50, 50, 725], center_mm: [x, y, 362.5], connects_to: [0] });
const keys = k.deriveKeyDimensions(desk);
same(keys.map(d => [d.key, d.value_mm]), [['top_thickness', 25], ['leg_span_x', 1300], ['leg_span_y', 600]]);

const base = e.buildEvidence({
  productScope: 'single',
  catalog: { width: 1400, depth: 700, height: 750 },
  aiOverall: { width: 1380, depth: 700, height: 748 },
  labels: [{ dimension: 'top_thickness', value: 2.5, unit: 'cm', raw_text: 'T=2.5cm', image_index: 2, applies_to: 'single' }],
  keyDimensions: keys,
});
const status = (ev, key) => e.findDimension(ev, key).status;
assert.equal(status(base, 'width'), 'pending', 'Catalogue data is not confirmed until a person confirms it');
assert.equal(status(base, 'top_thickness'), 'pending');
assert.equal(e.findDimension(base, 'top_thickness').candidates.find(c => c.source === 'drawing_label').value_mm, 25, 'cm label normalised to mm with its raw text kept');
assert.equal(e.findDimension(base, 'top_thickness').candidates.find(c => c.source === 'drawing_label').raw_text, 'T=2.5cm');
// AC-03：腳距只有零件推算 → 缺失；接受估算 → 估算草稿，但不能驗收。
assert.equal(status(base, 'leg_span_x'), 'missing');
assert.equal(e.modelingState(base), '待補資料');
let ev = e.confirmAgreed(base, 'pm@example.com');
assert.equal(status(ev, 'width'), 'confirmed');
assert.equal(status(ev, 'top_thickness'), 'confirmed');
assert.ok(e.generationBlockers(ev).some(n => n.includes('腳距')), 'Missing leg span blocks generation');
ev = e.acceptRemainingEstimates(ev, 'pm@example.com');
assert.equal(status(ev, 'leg_span_x'), 'estimated');
same(e.generationBlockers(ev), []);
assert.equal(e.modelingState(ev), '可建模');
assert.ok(e.acceptanceBlockers(ev).some(n => n.includes('腳距') && n.includes('估算')), 'Accepted estimates cannot pass acceptance');
same(e.pinnedKeyValues(ev), { top_thickness: 25 }, 'Estimates follow the geometry; only confirmed data pins it');

// AC-04：圖紙與產品資料衝突 → 並列候選，選定值要理由。
const clash = e.buildEvidence({
  productScope: 'single',
  catalog: { width: 1400, depth: 700, height: 750 },
  labels: [{ dimension: 'width', value: 1600, unit: 'mm', raw_text: 'W1600', image_index: 1 }],
});
assert.equal(status(clash, 'width'), 'conflict');
assert.match(e.generationBlockers(clash).join(), /產品資料 1400 \/ 圖紙標註 1600/);
const label = e.findDimension(clash, 'width').candidates.find(c => c.source === 'drawing_label');
let chosen = e.selectCandidate(clash, 'width', label.id, 'pm@example.com');
assert.equal(status(chosen, 'width'), 'conflict', 'Choosing without a reason does not resolve a conflict');
chosen = e.setReason(chosen, 'width', '圖紙為最新版');
assert.equal(status(chosen, 'width'), 'confirmed');
assert.equal(e.findDimension(chosen, 'width').candidates.length, 2, 'Both sources are kept');
assert.equal(e.valueOf(e.findDimension(chosen, 'width'), 'single'), 1600, 'No silent averaging');

// AI 與資料差 > 8% 也是衝突。
const aiOff = e.buildEvidence({ productScope: 'single', catalog: { width: 1400 }, aiOverall: { width: 1600 } });
assert.equal(status(aiOff, 'width'), 'conflict');

// AC-06：重新辨認不覆蓋人工確認值，接受過的估算跟新幾何。
const manual = e.enterManual(ev, 'leg_span_x', 1250, 'pm@example.com');
assert.equal(status(manual, 'leg_span_x'), 'confirmed');
const reread = e.buildEvidence({
  productScope: 'single',
  catalog: { width: 1400, depth: 700, height: 750 },
  aiOverall: { width: 1500, depth: 650, height: 760 },
  keyDimensions: k.deriveKeyDimensions(desk).map(d => ({ ...d, value_mm: d.value_mm + 40 })),
  previous: manual,
});
assert.equal(e.valueOf(e.findDimension(reread, 'leg_span_x'), 'single'), 1250, 'Confirmed leg span survives the new reading');
assert.equal(e.valueOf(e.findDimension(reread, 'top_thickness'), 'single'), 25, 'Confirmed drawing value survives even if the label is not read again');
assert.equal(status(reread, 'leg_span_y'), 'estimated');
assert.equal(e.valueOf(e.findDimension(reread, 'leg_span_y'), 'single'), 640, 'An accepted estimate follows the new geometry');

// AC-08：整組尺寸不能套在單件。
const set = e.buildEvidence({ productScope: 'single', catalogScope: 'arrangement', catalog: { width: 2800, depth: 1400, height: 750 }, aiOverall: { width: 1400, depth: 700, height: 750 } });
assert.equal(status(set, 'width'), 'missing', 'A whole-set catalogue width is not evidence for one desk');
assert.equal(e.valueOf(e.findDimension(set, 'width'), 'single'), 1400);
const group = e.buildEvidence({ productScope: 'arrangement', catalogScope: 'arrangement', catalog: { width: 2800, depth: 1400, height: 750 } });
assert.equal(status(group, 'width'), 'pending', 'The same catalogue size applies when the whole set is modelled');

// 關鍵尺寸驅動幾何：板厚保持上表面、腳頂接新底面；腳距移動腳；不呼叫 AI。
const thin = k.applyKeyDimensions(desk, { top_thickness: 40 });
same(thin.conflicts, []);
assert.equal(p.specBounds(thin.parts[0]).max[2], 750, 'Top surface height is unchanged');
assert.equal(p.specBounds(thin.parts[0]).min[2], 710);
for (const leg of thin.parts.slice(1)) assert.equal(p.specBounds(leg).max[2], 710, 'Legs reach the new underside');
const spread = k.applyKeyDimensions(desk, { leg_span_x: 1200 });
same(spread.conflicts, []);
same(spread.parts.slice(1).map(l => l.center_mm[0]), [-600, -600, 600, 600]);
same(spread.parts.slice(1).map(l => l.size_mm), Array(4).fill([50, 50, 725]), 'Moving legs keeps their section');
assert.ok(k.applyKeyDimensions(desk, { leg_span_x: 1500 }).conflicts.some(n => n.includes('超出')), 'Legs outside the top are named');
same(k.applyKeyDimensions(desk, { leg_span_x: 1300, top_thickness: 25 }).parts, desk, 'Unchanged values leave the parts as they are');

// 椅：座高移動座及上方部件，支撐腳拉長。
const chair = [
  { name: '座', shape: 'box', role: 'seat', size_mm: [450, 450, 30], center_mm: [0, 0, 435], connects_to: [1, 2] },
  { name: '前腳', shape: 'box', role: 'leg', size_mm: [30, 30, 420], center_mm: [0, 200, 210], connects_to: [0] },
  { name: '靠背', shape: 'box', role: 'back', size_mm: [450, 20, 400], center_mm: [0, -215, 650], connects_to: [0] },
];
const raised = k.applyKeyDimensions(chair, { seat_height: 480 });
same(raised.conflicts, []);
assert.equal(p.specBounds(raised.parts[0]).max[2], 480);
assert.equal(p.specBounds(raised.parts[1]).max[2], 450, 'Front leg reaches the new seat underside');
assert.equal(p.specBounds(raised.parts[1]).min[2], 0, 'Front leg stays on the floor');
assert.equal(p.specBounds(raised.parts[2]).min[2], 480, 'Backrest moves with the seat');

// AC-06：AI 重新辨識的零件差異逐項採用；沒採用的保持人工版本。
const s = load('../src/lib/partSuggestions.ts');
const mine = s.ensurePartIds(desk.map(part => ({ ...part, part_id: undefined })));
same(mine.map(part => part.part_id), ['p1', 'p2', 'p3', 'p4', 'p5']);
mine[0] = { ...mine[0], locked_axes: ['z'] };
const ai = structuredClone(desk.map(part => ({ ...part, part_id: undefined })));
ai[0].size_mm = [1400, 700, 40];
ai[1].size_mm = [60, 60, 725];
ai.push({ name: '橫樑', shape: 'box', role: 'frame', size_mm: [1250, 30, 30], center_mm: [0, 0, 600], connects_to: [1, 3] });
const changes = s.diffParts(mine, ai);
same(changes.map(c => c.id), ['chg-0', 'chg-1', 'add-5']);
const adopted = s.applyPartChanges(mine, ai, new Set(['chg-1', 'add-5']));
assert.equal(adopted[0].size_mm[2], 25, 'Rejected change keeps the confirmed top');
same(adopted[1].size_mm, [60, 60, 725]);
assert.equal(adopted[1].part_id, 'p2', 'Adopted change keeps the stable id');
assert.equal(adopted[0].locked_axes[0], 'z');
assert.equal(adopted.length, 6);
same(adopted[5].connects_to, [1, 3]);
assert.equal(adopted[5].part_id, 'p6');
same(s.referencesTo(mine, 1), ['桌板']);
const cut = s.removePartAt(mine, 1);
same(cut[0].connects_to, [1, 2, 3]);
same(s.setJoint(mine, 1, 2, true)[2].connects_to, [0, 1]);
assert.equal(s.duplicatePart(mine, 1).length, 6);

// labelled_dimensions 防禦式讀取。
same(e.labelledDimensionsFrom([{ dimension: 'width', value: 1200, unit: 'mm', raw_text: 'W1200' }, { dimension: 'width', value: -1, unit: 'mm', raw_text: 'x' }, { value: 3 }]).length, 1);
console.log('PASS: evidence statuses, missing/estimate/conflict rules, AC-03/04/06/08, whole-set scope, key dimensions drive geometry');

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const plain = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
import ts from 'typescript';
import * as THREE from 'three';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function load(path, deps = {}) {
  const c = { exports: {}, require: name => deps[name] ?? require(name), Date, crypto };
  vm.createContext(c);
  vm.runInContext(ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, c);
  return c.exports;
}
const p = load('../src/lib/furnitureParametric.ts');
const s = load('../src/lib/furnitureStructure.ts', { './furnitureParametric': p, three: THREE });

// PRD 典型案例：1400 × 700 × 750 桌，桌板 25 mm，四腳 50 × 50。
const desk = [{ part_id: 'top', name: '桌板', shape: 'box', role: 'top', form: 'panel', size_mm: [1400, 700, 25], center_mm: [0, 0, 737.5], connects_to: [1, 2, 3, 4] }];
for (const x of [-650, 650]) for (const y of [-300, 300]) desk.push({ part_id: `leg-${x}-${y}`, name: '腳', shape: 'box', role: 'leg', form: 'straight', size_mm: [50, 50, 725], center_mm: [x, y, 362.5], connects_to: [0] });
const evidence = { leg_count: 4, part_counts: { leg: 4, top: 1, seat: 0, back: 0, arm: 0, frame: 0, body: 0, shelf: 0, other: 0 }, symmetric: true, uncertainties: [] };

// AC-05：改桌寬 → 桌板變闊、腳跟着邊緣移動；板厚與腳截面不變；不需要 AI。
const wide = p.fitCustomPartsWithConstraints(desk, 1800, 700, 750);
same(wide.conflicts, []);
const top = wide.parts[0];
assert.equal(top.size_mm[0], 1800);
assert.equal(top.size_mm[2], 25, 'Top thickness must not follow the width');
for (const leg of wide.parts.slice(1)) {
  same(leg.size_mm, [50, 50, 725], 'Leg section and height must not change with the width');
  assert.equal(Math.abs(leg.center_mm[0]), 850, 'Legs keep their distance from the edge');
}
const model = p.buildParametric({ kind: 'custom', width_mm: 1800, depth_mm: 700, height_mm: 750, parts: wide.parts });
same(s.validateFurnitureStructure(model, evidence), []);
same(p.customPartsSize(wide.parts), [1800, 700, 750]);

// Height: the top stays 25 mm and moves up; legs grow to meet it.
const tall = p.fitCustomPartsWithConstraints(desk, 1400, 700, 800).parts;
assert.equal(tall[0].size_mm[2], 25);
assert.equal(tall[0].center_mm[2], 787.5);
assert.equal(tall[1].size_mm[2], 775);

// Deterministic: same parts, same size → same geometry.
same(p.fitCustomPartsWithConstraints(desk, 1800, 700, 750), wide);

// A locked axis that cannot fit is a named contradiction, not a silent rewrite.
const locked = structuredClone(desk);
locked[0].locked_axes = ['x'];
const clash = p.fitCustomPartsWithConstraints(locked, 1200, 700, 750);
assert.ok(clash.conflicts.some(n => n.includes('桌板') && n.includes('已鎖定闊 1400')));
assert.equal(clash.parts[0].size_mm[0], 1400);

// Compressing below the leg sections is reported with the part and the axis.
const crushed = p.fitCustomPartsWithConstraints(desk, 1400, 700, 20);
assert.ok(crushed.conflicts.some(n => n.includes('腳') && n.includes('高')));

// Bent tube frames keep their section when stretched along their run.
const sweep = [{ part_id: 'frame', name: 'U 形管', shape: 'sweep', role: 'frame', form: 'bent', size_mm: [600, 30, 400], center_mm: [0, 0, 0], path_mm: [[-285, 0, 0], [-285, 0, 385], [285, 0, 385], [285, 0, 0]], section: 'round', section_mm: [30, 30] }];
const checked = p.sanitizeCustomParts(sweep);
const stretched = p.fitCustomPartsWithConstraints(checked, 900, p.customPartsSize(checked)[1], p.customPartsSize(checked)[2]);
same(stretched.conflicts, []);
same(stretched.parts[0].section_mm, [30, 30]);
assert.equal(stretched.parts[0].geometry_scale, undefined, 'Stretching must not scale the tube section');
assert.ok(Math.abs(p.customPartsSize(stretched.parts)[0] - 900) <= 1);
assert.ok(Math.abs(p.customPartsSize(stretched.parts)[1] - 30) <= 0.5, 'Tube diameter is unchanged');

assert.equal(p.buildParametric({ kind: 'desk', width_mm: 1400, depth_mm: 700, height_mm: 750 }).engine_version, p.PARAMETRIC_ENGINE_VERSION);
const kept = p.sanitizeCustomParts([{ ...desk[0], connects_to: [], locked_axes: ['z', 'q'], part_id: 'top' }]);
same(kept[0].locked_axes, ['z']);
assert.equal(kept[0].part_id, 'top');
console.log('PASS: width/height change by constraints, locked thickness and leg sections, deterministic fit, named contradictions, sweep section preserved');

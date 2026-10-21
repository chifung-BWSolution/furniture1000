import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/furnitureParametric.ts', import.meta.url), 'utf8');
const context = { exports: {} };
vm.createContext(context);
vm.runInContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { initialModelStyle, buildParametric } = context.exports;
const catalogueName = 'G620L款乾字型四人位20款';
const initial = initialModelStyle('desk', catalogueName, { top: 'L', seats: 4, return_side: 'right' });
assert.equal(initial.seats, 1, 'Catalogue and image counts must not override single-desk output');
const build = (style) => buildParametric({ kind: 'desk', width_mm: 1420, depth_mm: 1210, height_mm: 1050, style });
const single = build(initial);
assert.equal(single.components.filter(p => /(^|-)top$/.test(p.id)).length, 1);
const right = single.components.find(p => p.id === 'top');
const left = build({ ...initial, return_side: 'left' }).components.find(p => p.id === 'top');
const rounded = n => Math.round(n * 1000) / 1000;
const points = (part, flipX = 1, flipY = 1) => part.outline.points_mm.map(([x,y]) => `${rounded(x * flipX)},${rounded(y * flipY)}`).sort();
assert.deepEqual(points(left), points(right, -1), 'Changing side must mirror the L footprint');
const frontEdge = part => part.outline.points_mm.filter(([,y]) => y > 500).map(([x]) => x);
assert.ok(frontEdge(right).every(x => x < 0), 'User right is negative X when facing -Y');
assert.ok(frontEdge(left).every(x => x > 0));
const cluster = buildParametric({ kind: 'desk', width_mm: 2840, depth_mm: 2420, height_mm: 1050, style: { ...initial, seats: 4 } });
assert.equal(cluster.components.filter(p => /-top$/.test(p.id)).length, 4, 'Manual multi-desk selection remains supported');
const top = id => cluster.components.find(p => p.id === id);
assert.deepEqual(points(top('ws3-top')), points(top('ws1-top'), -1, -1), 'Back-row desks must rotate 180 degrees, not reflect');
assert.equal(initialModelStyle('sofa', '三人梳化', { seats: 3 }).seats, 3, 'Integral sofa seats remain intact');
console.log('PASS: single-desk default, explicit multi-desk selection, handedness, back-row rotation, sofa seats');

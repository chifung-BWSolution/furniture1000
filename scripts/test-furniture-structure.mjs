import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const context = { exports: {} };
vm.createContext(context);
vm.runInContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/furnitureParametric.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { initialModelStyle, inferModelStyle, buildParametric, sanitizeCustomParts } = context.exports;
const failures = [];
const check = (name, run) => {
  try { run(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL: ${name}: ${error.message}`); }
};
check('image four-leg choice survives conflicting catalogue text', () => {
  const style = initialModelStyle('side_chair', '弓字系列 四腳會議椅', { chair_base: 'four', arms: false });
  const model = buildParametric({ kind: 'side_chair', width_mm: 500, depth_mm: 500, height_mm: 850, style });
  assert.equal(model.components.filter(p => p.id.startsWith('leg-')).length, 4);
  assert.equal(model.components.filter(p => p.id.startsWith('runner-')).length, 0);
  const table = buildParametric({ kind: 'conference', style: initialModelStyle('conference', '折板腳會議枱', { legs: 'four' }) });
  const legs = table.components.filter(p => p.id.startsWith('leg-'));
  assert.equal(legs.length, 4);
  assert.ok(legs.every(p => !p.outline), 'Four straight table legs must not acquire the bent panel profile');
});
check('explicit four-leg text and negation do not select a sled', () => {
  for (const name of ['四腳椅', '四脚椅', '非弓字四腳椅', '非弓字椅', '無弓字架椅', 'four-leg chair']) {
    assert.equal(inferModelStyle(name).chair_base, 'four', name);
  }
  assert.equal(inferModelStyle('弓字椅').chair_base, 'sled');
});
check('four-leg stool geometry respects the selected base', () => {
  const model = buildParametric({ kind: 'stool', width_mm: 450, depth_mm: 450, height_mm: 750, style: { legs: 'four' } });
  assert.equal(model.components.filter(p => p.id.startsWith('leg-')).length, 4);
  assert.equal(model.components.some(p => p.id === 'column'), false);
  assert.equal(buildParametric({ kind: 'stool', style: { legs: 'pedestal' } }).components.some(p => p.id === 'column'), true);
});
check('invalid custom outlines fail instead of becoming boxes', () => {
  assert.throws(() => sanitizeCustomParts([{ name: '彎腳', shape: 'profile', axis: 'y', size_mm: [30, 30, 450], center_mm: [0, 0, 225], points_mm: [[0, 0], [1, 1]] }]));
  assert.throws(() => buildParametric({ kind: 'custom', parts: [] }));
  assert.throws(() => sanitizeCustomParts([{ name: '腳', shape: 'profile', axis: 'y', size_mm: [30, 30, 450], center_mm: [0, 0, 225], points_mm: [[-15, -225], ['bad', 0], [15, -225], [15, 225], [-15, 225]] }]));
});
check('valid custom profiles remain profiles', () => {
  const parts = sanitizeCustomParts([{ name: '腳', shape: 'profile', axis: 'y', size_mm: [30, 30, 450], center_mm: [0, 0, 225], points_mm: [[-15, -225], [15, -225], [15, 225], [-15, 225]] }]);
  assert.equal(parts[0].shape, 'profile');
});
check('malformed or oversized part lists cannot silently lose supports', () => {
  const leg = { name: '腳', shape: 'box', size_mm: [30, 30, 450], center_mm: [0, 0, 225] };
  assert.throws(() => sanitizeCustomParts([leg, { ...leg, size_mm: [0, 30, 450] }]));
  assert.throws(() => sanitizeCustomParts([leg, { ...leg, shape: 'unknown' }]));
  assert.throws(() => sanitizeCustomParts(Array(200).fill(leg)));
});
check('image false and zero values override name hints; absent fields retain hints', () => {
  const style = initialModelStyle('cabinet', '三抽雙門扶手', { drawers: 0, doors: 0, arms: false });
  assert.equal(style.drawers, 0);
  assert.equal(style.doors, 0);
  assert.equal(style.arms, false);
  assert.equal(initialModelStyle('side_chair', '四腳椅', { chair_base: undefined }).chair_base, 'four');
});
if (failures.length) process.exitCode = 1;

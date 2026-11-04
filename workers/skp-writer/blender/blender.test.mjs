import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBlender } from './config.mjs';
import { runBlender } from './driver.mjs';
import { loadEngine } from '../engine.mjs';

test('manager selection persists Blender and discovery fails closed for a missing explicit executable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fds-engine-test-'));
  await writeFile(join(dir, 'engine.json'), '\uFEFF{"engine":"blender"}');
  assert.equal(loadEngine(dir), 'blender');
  assert.equal(findBlender({ FDS_BLENDER_EXE: join(dir, 'missing.exe') }), null);
});

test('real Blender adapter applies modifiers and world transforms in millimetres; failures remove stale output', { skip: !findBlender() }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fds-blender-test-'));
  await mkdir(join(dir, 'outputs'));
  await writeFile(join(dir, 'build_model.py'), `import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.25))
obj = bpy.context.object
obj.name = 'Top'
obj.scale = (1.2, 0.6, 0.5)
mod = obj.modifiers.new('Triangulate', 'TRIANGULATE')
mat = bpy.data.materials.new('Oak')
mat.diffuse_color = (0.4, 0.2, 0.1, 1)
obj.data.materials.append(mat)
`);
  assert.equal(await runBlender(findBlender(), dir), 1);
  const data = JSON.parse(await readFile(join(dir, 'outputs/blender-mesh.json'), 'utf8'));
  assert.equal(data.parts[0].name, 'Top');
  assert.equal(data.parts[0].faces.length, 12);
  const verts = data.parts[0].vertices;
  assert.ok(Math.abs(Math.max(...verts.map((p) => p[0])) - 600) < 0.01);
  assert.equal(Math.min(...verts.map((p) => p[2])), 0);
  assert.ok((await readFile(join(dir, 'outputs/model.blend'))).length > 0);
  await writeFile(join(dir, 'build_model.py'), 'raise RuntimeError("intentional_test_failure")');
  await assert.rejects(runBlender(findBlender(), dir), /intentional_test_failure/);
  await assert.rejects(readFile(join(dir, 'outputs/blender-mesh.json')), { code: 'ENOENT' });
});

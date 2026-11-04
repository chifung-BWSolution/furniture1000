// Local integration check, no server credentials or AI calls. Starts only a dedicated SketchUp.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBlender } from './config.mjs';
import { runBlender } from './driver.mjs';
import { assertIdentity, bridgeCall, pickPort } from '../codex/bridge.mjs';
import { codexEnv } from '../codex/env.mjs';
import { killTree } from '../codex/lock.mjs';
import { inspectFbx, inspectGlb, looksLikeSkp } from '../codex/artifacts.mjs';

const worker = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'fds-blender-smoke-'));
const output = join(dir, 'outputs');
const screens = join(dir, 'screens');
await mkdir(output);
await mkdir(screens);
await mkdir(join(output, 'fbx'));
const seed = process.env.FDS_SKP_SEED || join(process.env.LOCALAPPDATA, 'FDS/SkpWorker/seed.skp');
await copyFile(seed, join(dir, 'working.skp'));
await writeFile(join(dir, 'build_model.py'), `import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0.25))
obj=bpy.context.object
obj.name='Top'
obj.scale=(1.2,0.6,0.5)
mat=bpy.data.materials.new('Oak')
mat.diffuse_color=(0.5,0.25,0.1,1)
mat.use_nodes=True
image=bpy.data.images.new('Grain',width=2,height=2)
image.pixels=[0.5,0.25,0.1,1]*4
node=mat.node_tree.nodes.new('ShaderNodeTexImage')
node.image=image
mat.node_tree.links.new(node.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
obj.data.materials.append(mat)
`);
await runBlender(findBlender(), dir);
const port = await pickPort(19877);
const jobId = 'blender-smoke';
const nonce = crypto.randomUUID();
const ready = join(dir, 'ready.json');
const failed = join(dir, 'failed.json');
const exe = process.env.SKETCHUP_EXE || 'C:\\Program Files\\SketchUp\\SketchUp 2026\\SketchUp\\SketchUp.exe';
const child = spawn(exe, ['-RubyStartup', join(worker, 'fds_codex_session.rb'), join(dir, 'working.skp')], {
  windowsHide: true, stdio: 'ignore', env: codexEnv(process.env, {
    FDS_CODEX_JOB_ID: jobId, FDS_CODEX_NONCE: nonce, FDS_CODEX_PORT: String(port),
    FDS_CODEX_READY_FILE: ready, FDS_CODEX_ERROR_FILE: failed,
    FDS_CODEX_SCREEN_DIR: screens, FDS_CODEX_OUTPUT_DIR: output,
  }),
});
try {
  const start = Date.now();
  while (!existsSync(ready)) {
    if (existsSync(failed)) throw new Error(await readFile(failed, 'utf8'));
    if (child.exitCode !== null || Date.now() - start > 120_000) throw new Error('SketchUp startup failed/timed out');
    await new Promise((r) => setTimeout(r, 1000));
  }
  await assertIdentity(port, jobId, nonce);
  await bridgeCall(port, 'import_blender', {}, { timeoutMs: 170_000 });
  const scene = await bridgeCall(port, 'scene_info');
  assert.equal(scene.product.parts[0].name, 'Top');
  assert.ok(Math.abs(scene.bounds_mm.size[0] - 1200) < 0.1);
  // A second import replaces the previous Blender root rather than duplicating it.
  await bridgeCall(port, 'import_blender');
  assert.equal((await bridgeCall(port, 'scene_info')).top_level_groups.length, 1);
  const out = { skp: join(output, 'test.skp'), fbx: join(output, 'fbx/test.fbx'), glb: join(output, 'test.glb'), preview: join(output, 'preview.png') };
  await bridgeCall(port, 'export', { ...out, product: { name: 'Blender adapter smoke' } }, { timeoutMs: 600_000 });
  assert.ok(looksLikeSkp(await readFile(out.skp)));
  assert.ok(inspectFbx(await readFile(out.fbx)));
  const glb = inspectGlb(await readFile(out.glb));
  assert.ok(glb.meshes > 0);
  assert.equal(glb.external.length, 0);
  assert.ok(glb.images > 0, 'GLB must contain the Blender texture');
  assert.ok(Math.abs(glb.bounds.size[0] - 1.2) < 0.001);
  console.log(`PASS Blender → editable SketchUp → SKP/FBX/GLB: ${dir}`);
} finally {
  await bridgeCall(port, 'quit', {}, { timeoutMs: 10_000 }).catch(() => {});
  for (let i = 0; i < 10 && child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 1000));
  if (child.exitCode === null) await killTree(child.pid);
}

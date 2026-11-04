// Replay a retained furniture draft locally. No database mutations or online publication.
// --codex also exercises the real CLI + MCP + report/measurement validation path.
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runBlender } from './driver.mjs';
import { findBlender } from './config.mjs';
import { loadCodexConfig } from '../codex/config.mjs';
import { generateBlenderDraft } from './job.mjs';
import { inspectFbx, inspectGlb } from '../codex/artifacts.mjs';
const source = process.argv[2];
if (!source || source.startsWith('--')) throw new Error('Usage: node native-smoke.mjs <retained-job-directory> [--codex]');
const dir = await mkdtemp(join(tmpdir(),'fds-native-replay-'));
const paths = Object.fromEntries([['outputs','outputs'],['fbxDir','outputs/fbx'],['logs','logs'],['screens','screens'],['refs','references']].map(([k,v])=>[k,join(dir,v)]));
for(const p of Object.values(paths)) await mkdir(p,{recursive:true});
await copyFile(join(source,'outputs/model.blend'),join(paths.outputs,'model.blend'));
await copyFile(join(source,'build_model.py'),join(dir,'build_model.py'));
console.log(`Local replay: ${dir}`);
if (process.argv.includes('--codex')) {
  const job=JSON.parse(await readFile(join(source,'job.json'),'utf8'));
  const config=loadCodexConfig(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
  const deps={config,blenderExe:findBlender(),feedback:'接續保留的家具。先修正地面不為零、目錄外廓高度及深度不符的問題；用 get_scene_info 實測並依目錄尺寸檢查。重新看四張 Blender 截圖、撰寫完整報告。不要為了通過檢查而虛報方向或部件。',convertSkp:async()=>({path:null,warning:'Replay deliberately omits SketchUp to verify independent FBX/GLB'})};
  const generated=await generateBlenderDraft({job,deps,dir,paths,stage:async(name,p,detail)=>console.log(`${name}: ${detail}`),signal:new AbortController().signal});
  await writeFile(join(dir,'replay-result.json'),JSON.stringify(generated,null,2));
  console.log(`PASS real Codex → Blender → four-view review → validated FBX/GLB; SKP unavailable: ${dir}`);
} else {
  const start=Date.now();
  await runBlender(findBlender(),dir,{exportOnly:true});
  const glb=inspectGlb(await readFile(join(paths.outputs,'model.glb')));
  inspectFbx(await readFile(join(paths.fbxDir,'model.fbx')));
  console.log(`PASS retained model → Blender-native FBX/GLB and four renders, ${glb.meshes} meshes, ${(Date.now()-start)/1000}s. ${dir}`);
}

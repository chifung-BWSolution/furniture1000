import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { findBlender } from './config.mjs';
import { orientationGaps, validateBlender } from './validation.mjs';
import { inspectGlb, inspectFbx, sha256 } from '../codex/artifacts.mjs';
import { runCodexJob } from '../codex/job.mjs';

test('orientation errors identify missing/current evidence instead of reporting an incorrect model orientation', () => {
  const report={reference_analysis:[{}],unit_plan:{instances:[{}]},orientation_review:{passed:true,unresolved:[]}};
  const screens=['iso','front','side','top'].map((view)=>({tool:'screenshot',ok:true,view}));
  assert.deepEqual(orientationGaps(report,[{}],[{tool:'run_blender',ok:true},...screens]),[]);
  assert.ok(orientationGaps(report,[{}],[...screens,{tool:'run_blender',ok:false}]).some((s)=>s.includes('最後一次')));
  assert.ok(orientationGaps(report,[{}],[{tool:'run_blender',ok:true},...screens,{tool:'run_blender',ok:true}]).some((s)=>s.includes('最新')));
});

test('Blender MCP builds/renders/exports without any SketchUp port; missing SKP still reaches reviewed publication', {skip:!findBlender()}, async () => {
  const dir=await mkdtemp(join(tmpdir(),'fds-native-test-'));
  for(const name of ['outputs','screens','logs']) await mkdir(join(dir,name));
  const child=spawn(process.execPath,[resolve('workers/skp-writer/codex/mcp-server.mjs')],{windowsHide:true,env:{...process.env,FDS_BLENDER_EXE:findBlender(),FDS_CODEX_JOB_ID:'native-test',FDS_CODEX_JOB_DIR:dir,FDS_CODEX_SCREEN_DIR:join(dir,'screens'),FDS_CODEX_TOOL_LOG:join(dir,'logs/mcp-tools.jsonl'),FDS_CODEX_PORT:''},stdio:['pipe','pipe','pipe']});
  let serial=0; const pending=new Map();
  const lines=createInterface({input:child.stdout});
  lines.on('line',(line)=>{const r=JSON.parse(line);pending.get(r.id)?.(r.result);pending.delete(r.id);});
  const call=(method,params)=>new Promise((resolve,reject)=>{
    const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`MCP timeout ${method}`));},350000);
    pending.set(id,(r)=>{clearTimeout(timer);r?.isError?reject(new Error(JSON.stringify(r))):resolve(r);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  const tool=(name,args={})=>call('tools/call',{name,arguments:args});
  try {
    const tools=(await call('tools/list',{})).tools;
    assert.ok(!tools.some((t)=>t.name==='eval_ruby'));
    await tool('write_blender_file',{path:'build_model.py',content:`import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0.25))
o=bpy.context.object
o.name='Top'
o.scale=(1.2,0.6,0.5)
m=bpy.data.materials.new('Oak')
m.use_nodes=True
image=bpy.data.images.new('Grain',width=2,height=2)
image.pixels=[0.5,0.25,0.1,1]*4
node=m.node_tree.nodes.new('ShaderNodeTexImage')
node.image=image
m.node_tree.links.new(node.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
o.data.materials.append(m)
`});
    await tool('run_blender');
    const info=JSON.parse((await tool('get_scene_info')).content[0].text);
    for(const view of ['iso','front','side','top']) assert.equal((await tool('screenshot',{view})).content[0].type,'image');
    const glbBytes=await readFile(join(dir,'outputs/model.glb'));
    const fbxBytes=await readFile(join(dir,'outputs/fbx/model.fbx'));
    assert.ok(inspectGlb(glbBytes).images>0);
    assert.ok(inspectFbx(fbxBytes));
    assert.ok(fbxBytes.includes(Buffer.from('Video')) && fbxBytes.includes(Buffer.from('Content')), 'FBX must embed the generated texture');
    const report={reference_analysis:[{}],unit_plan:{instances:[{}]},orientation_review:{passed:true,unresolved:[]},parts:[{name:'Top'}],batches:['Top'],known_issues:[],semantic_checks:[{check:'count',name_contains:'Top',expected:1}]};
    const validation=validateBlender({snapshot:{catalog_dimensions_mm:{width:1200,depth:600,height:500}},info,report,glbBytes,fbxBytes,previewBytes:await readFile(join(dir,'outputs/view-iso.png'))});
    assert.equal(validation.ok,true,JSON.stringify(validation.checks));
    const entries=(await readFile(join(dir,'logs/mcp-tools.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(orientationGaps(report,[{}],entries),[]);
    // A completed no-SKP draft is accepted and uploaded through the same real review/publish path.
    await writeFile(join(dir,'outputs/report.json'),JSON.stringify(report));
    await writeFile(join(dir,'validation.json'),JSON.stringify({...validation,skp_status:'unavailable'}));
    await writeFile(join(dir,'engine.json'),JSON.stringify({engine:'blender'}));
    await writeFile(join(dir,'outputs/fbx-bundle.zip'),'fixture-zip');
    const out={skp:null,fbx:join(dir,'outputs/fbx/model.fbx'),glb:join(dir,'outputs/model.glb'),preview:join(dir,'outputs/view-iso.png'),blend:join(dir,'outputs/model.blend')};
    const files=await Promise.all([...Object.values(out).filter(Boolean),join(dir,'outputs/fbx-bundle.zip')].map(async(p)=>({path:p.slice(dir.length+1),hash:sha256(await readFile(p))})));
    await writeFile(join(dir,'checkpoint.json'),JSON.stringify({out,files,validation:{...validation,skp_status:'unavailable'},report,base:'model',zipEntries:['model.fbx']}));
    await writeFile(join(dir,'review.json'),JSON.stringify({status:'accepted'}));
    const uploaded=new Map();const actions=[];
    await runCodexJob({id:'native-test',attempt:1,lease_id:'fixture',input:{}},{engine:'blender',blenderExe:findBlender(),resumeDir:dir,config:{workRoot:dir},log:()=>{},callAgent:async(action,body)=>{
      actions.push(action);if(action==='artifact-upload')return {path:body.role,token:'fixture'};if(action==='artifact-download')return {url:body.role};return {};
    },uploadSigned:async(p,t,b)=>uploaded.set(p,b),downloadSigned:async(p)=>uploaded.get(p)});
    assert.equal(uploaded.has('skp'),false);
    assert.ok(uploaded.has('fbx')&&uploaded.has('glb')&&actions.includes('publish'));
    assert.equal(JSON.parse(uploaded.get('manifest')).skp_status,'unavailable');
    console.log(`Native no-SketchUp integration artifacts: ${dir}`);
  } finally { child.stdin.end();lines.close();if(child.exitCode===null)child.kill(); }
});

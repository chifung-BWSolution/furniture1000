import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateBlenderDraft} from './job.mjs';
import {sha256} from '../codex/artifacts.mjs';
test('failed orientation returns concrete issues to Codex and preserves the local blend until retry limit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fds-orientation-repair-'));
 const paths=Object.fromEntries(['outputs','logs','screens','refs','fbxDir'].map(k=>[k,join(dir,k)]));
 for(const p of Object.values(paths))await mkdir(p,{recursive:true});
 await writeFile(join(paths.outputs,'model.blend'),'existing-model');
 await writeFile(join(dir,'build_model.py'),'existing-script');
 let calls=0;
 const deps={blenderExe:'fixture',downloadReferences:async()=>({saved:[{path:'ref.jpg'}]}),executeBlenderCodex:async({prompt})=>{
  calls++;assert.equal(await readFile(join(paths.outputs,'model.blend'),'utf8'),'existing-model');
  if(calls>1)assert.match(prompt,/mesh edges/);
  await writeFile(join(paths.outputs,'report.json'),JSON.stringify({reference_analysis:[{}],unit_plan:{instances:[{}]},orientation_review:{passed:false,unresolved:['mesh edges']},parts:[{}],batches:[{}],semantic_checks:[],known_issues:[]}));
  return [{tool:'run_blender',ok:true,script_sha256:sha256(await readFile(join(dir,'build_model.py')))},...['iso','front','side','top'].map(view=>({tool:'screenshot',ok:true,view}))];
 }};
 await assert.rejects(generateBlenderDraft({job:{id:'orientation-test',input:{}},deps,dir,paths,stage:async()=>{}}),/orientation_review_required.*mesh edges/);
 assert.equal(calls,3);
 assert.equal(JSON.parse(await readFile(join(dir,'blender-recovery.json'),'utf8')).stage,'modeling');
});

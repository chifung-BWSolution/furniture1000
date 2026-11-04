import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
const code=ts.transpileModule(fs.readFileSync('supabase/functions/_shared/modelSync.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup({duplicate=false,corrupt=false}={}) {
 const writes=[],acks=[],requests=[];const model={id:'model1',product_id:'p1',format:'glb',source:'generated',model_type:'3d',storage_path:'generated/job/model.glb',preview_storage_path:'preview/job/model.glb',file_name:'model_Blender建立.glb',version_note:'Blender建立',content_hash:'hash',created_by:'dev-user',generation_job_id:'dev-job',furniture_model_id:'dev-furniture'};
 const product={id:'p1',sku:'sku',model:'table'};
 const source={rpc:async(name,body)=>{if(name==='fds_claim_model_sync')return {data:{model,revision:3,paths:[model.storage_path,model.preview_storage_path]},error:null};acks.push(body);return {data:null,error:null};},from:()=>({select:()=>({eq:()=>({single:async()=>({data:product,error:null})})})})};
 const target={from:(table)=>{const query={select:()=>query,eq:()=>query,single:async()=>({data:product,error:null}),maybeSingle:async()=>({data:null,error:null}),limit:async()=>({data:duplicate?[{id:'existing-main-model'}]:[],error:null}),upsert:async(payload)=>{writes.push(payload);return {error:null};}};return query;}};
 const context={exports:{},require:()=>crypto,Uint8Array,fetch:async(url,init={})=>{requests.push({url,method:init.method});if(init.method==='POST')return new Response('{}');return new Response(corrupt&&url.includes('riaubh')?'bad':'model-bytes');}};
 vm.runInNewContext(code,context);return {...context.exports,source,target,writes,acks,requests,model};
}
test('develop sync copies and verifies artifacts before inserting an isolated production row',async()=>{
 const t=setup();assert.equal((await t.syncDevelopModels(t.source,t.target,'source-key','target-key')).ok,true);
 assert.equal(t.writes.length,1);assert.equal(t.writes[0].file_name,t.model.file_name);
 assert.equal(t.writes[0].storage_path,'generated/develop-sync/generated/job/model.glb');
 for(const key of ['id','created_by','generation_job_id','furniture_model_id'])assert.equal(key in t.writes[0],false);
 assert.equal(t.acks[0].p_revision,3);assert.equal(t.acks[0].p_error,null);
});
test('copy verification failure retries without registering a missing production model',async()=>{
 const t=setup({corrupt:true});assert.equal((await t.syncDevelopModels(t.source,t.target,'a','b')).retry,true);
 assert.equal(t.writes.length,0);assert.equal(t.acks[0].p_error,'model_sync_hash_mismatch');
});
test('identical production models are retained and retries do not duplicate files',async()=>{
 const t=setup({duplicate:true});assert.equal((await t.syncDevelopModels(t.source,t.target,'a','b')).already_present,true);
 assert.equal(t.writes.length,0);assert.equal(t.requests.length,0);
});
test('sync destination rejects traversal and keeps relative FBX texture paths',()=>{
 const t=setup();assert.throws(()=>t.destinationPath('generated/../x'));
 assert.equal(t.destinationPath('generated/job/textures/oak.png'),'generated/develop-sync/generated/job/textures/oak.png');
});

test('queue endpoint accepts only the dedicated develop credential, never main or device/user credentials',async()=>{
 let handler,called=0;
 const env={SUPABASE_URL:'https://omxizeukbcqzsnjsuwod.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'local-service',FDS_MODEL_SYNC_CRON_KEY:'cron-only',FDS_MODEL_SYNC_PRODUCTION_KEY:'target-service'};
 const entry=ts.transpileModule(fs.readFileSync('supabase/functions/skp-worker-agent/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(entry,{exports:{},URL,Response,Request,console,Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},require:name=>name.includes('modelSync')?{syncDevelopModels:async()=>{called++;return {ok:true};}}:name.includes('supabase-js')?{createClient:()=>({})}:crypto});
 const call=key=>handler(new Request('https://function.invalid',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{"action":"sync-models"}'}));
 assert.equal((await call('device-token')).status,403);
 assert.equal((await call('local-service')).status,403);
 assert.equal((await call('cron-only')).status,200);assert.equal(called,1);
 env.SUPABASE_URL='https://riaubhtruisbwdlwjzur.supabase.co';
 assert.equal((await call('cron-only')).status,403);assert.equal(called,1);
});

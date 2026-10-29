import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCodexJob } from './job.mjs';
import { sha256 } from './artifacts.mjs';

test('restart keeps pending draft offline, then uploads only after acceptance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fds-review-'));
  try {
    const out = Object.fromEntries(['skp','fbx','glb','preview'].map(k => [k,join(dir,k)]));
    const bundle = join(dir,'outputs');
    const {mkdir} = await import('node:fs/promises');
    await mkdir(bundle);
    const files=[];
    for(const path of [...Object.values(out),join(bundle,'fbx-bundle.zip')]) {
      const bytes=Buffer.from('fixture'); await writeFile(path,bytes);
      files.push({path:path.slice(dir.length+1),hash:sha256(bytes)});
    }
    await writeFile(join(dir,'checkpoint.json'),JSON.stringify({out,files,validation:{ok:true,source_skp_sha256:'fixture'},report:{},base:'fixture',zipEntries:['fixture.fbx']}));
    const review=join(dir,'review.json');
    await writeFile(review,JSON.stringify({status:'pending'}));
    const calls=[],uploaded=new Map();
    const deps={resumeDir:dir,config:{workRoot:dir},log:()=>{},callAgent:async(action,body)=>{
      calls.push(action);
      if(action==='artifact-upload')return {path:body.role,token:'test'};
      if(action==='artifact-download')return {url:body.role};
      return {};
    },uploadSigned:async(path,token,bytes)=>uploaded.set(path,bytes),downloadSigned:async(url)=>uploaded.get(url)};
    const running=runCodexJob({id:'test',attempt:1,lease_id:'lease',input:{}},deps);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(calls.includes('artifact-upload'),false);
    await writeFile(review,JSON.stringify({status:'accepted'}));
    await running;
    assert.equal(uploaded.size,8);
    assert.equal(JSON.parse(await readFile(review,'utf8')).status,'published');
    // A modified checkpoint must never upload.
    await writeFile(out.skp,'tampered');
    calls.length=0;
    await assert.rejects(runCodexJob({id:'test',attempt:1,lease_id:'lease'},deps),/checkpoint_hash_mismatch/);
    assert.equal(calls.includes('artifact-upload'),false);
    await writeFile(out.skp,'fixture');
    await writeFile(review,JSON.stringify({status:'discarded'}));
    calls.length=0;
    assert.deepEqual(await runCodexJob({id:'test',attempt:1,lease_id:'lease'},deps),{discarded:true});
    assert.equal(calls.includes('artifact-upload'),false);
    assert.equal(calls.includes('fail'),true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireSketchUpLock, killTree } from '../codex/lock.mjs';
import { assertIdentity, bridgeCall, pickPort } from '../codex/bridge.mjs';
import { codexEnv, assertNoSecrets } from '../codex/env.mjs';
import { looksLikeSkp } from '../codex/artifacts.mjs';

// Optional bounded conversion; Blender exports and review remain usable if this fails.
export async function convertSkp({ job, dir, config, sketchupExe, seedPath, signal, secrets = [], timeoutMs = 90_000 }) {
  if (!existsSync(sketchupExe || '') || !existsSync(seedPath || '') || !existsSync(config.sessionScript)) return { path: null, warning: '未安裝或未設定 SketchUp，已保留 FBX／GLB；SKP 尚未轉換' };
  let child, lock;
  let stopped = false;
  const stop = () => { stopped = true; if (child?.pid) killTree(child.pid); };
  signal?.addEventListener('abort',stop,{once:true});
  const deadline = Date.now()+timeoutMs;
  const remaining = () => {
    if (signal?.aborted) throw signal.reason;
    if (stopped || Date.now() >= deadline) throw new Error('SKP 轉換逾時');
    return Math.max(1,deadline-Date.now());
  };
  const timer = setTimeout(stop,timeoutMs);
  try {
    remaining();
    lock = await acquireSketchUpLock(config.lockPath,{token:randomUUID(),job_id:job.id,kind:'blender-skp'},{onWait:async()=>{remaining();}});
    remaining();
    const port = await pickPort(config.bridgePort);
    const nonce = randomUUID();
    const working = join(dir,'convert-working.skp');
    const ready = join(dir,'convert-ready.json');
    const failed = join(dir,'convert-error.json');
    const output = join(dir,'outputs','model.skp');
    await Promise.all([ready,failed,output].map((p)=>rm(p,{force:true})));
    await copyFile(seedPath,working);
    const env = codexEnv(process.env,{ FDS_CODEX_JOB_ID:job.id,FDS_CODEX_NONCE:nonce,FDS_CODEX_PORT:String(port),FDS_CODEX_READY_FILE:ready,FDS_CODEX_ERROR_FILE:failed,FDS_CODEX_OUTPUT_DIR:join(dir,'outputs'),FDS_CODEX_SCREEN_DIR:join(dir,'screens') });
    assertNoSecrets(env,secrets);
    child = spawn(sketchupExe,['-RubyStartup',config.sessionScript,working],{env,windowsHide:true,stdio:'ignore'});
    let spawnError;
    child.once('error',(e)=>{spawnError=e;});
    await lock.update({sketchup_pid:child.pid,port});
    while (!existsSync(ready)) {
      remaining();
      if (spawnError) throw spawnError;
      if (existsSync(failed)) throw new Error(await readFile(failed,'utf8'));
      if (child.exitCode !== null) throw new Error('SketchUp 已結束');
      await new Promise((r)=>setTimeout(r,300));
    }
    await assertIdentity(port,job.id,nonce,{timeoutMs:remaining()});
    await bridgeCall(port,'import_blender',{}, {timeoutMs:remaining()});
    const measured = await bridgeCall(port,'scene_info',{}, {timeoutMs:remaining()});
    const expected = JSON.parse(await readFile(join(dir,'outputs','scene-info.json'),'utf8'));
    if (!measured.bounds_mm || [0,1,2].some((i)=>Math.abs(measured.bounds_mm.size[i]-expected.bounds_mm.size[i])>2) || measured.product?.parts?.length !== expected.parts.length) throw new Error('SKP 轉換後的尺寸或部件數量與 Blender 不符');
    await bridgeCall(port,'save_skp',{path:output,product:job.input?.product ?? {}},{timeoutMs:remaining()});
    if (!looksLikeSkp(await readFile(output))) throw new Error('SKP 格式驗證失敗');
    await bridgeCall(port,'quit',{}, {timeoutMs:Math.min(remaining(),3000)}).catch(()=>{});
    return {path:output,warning:null};
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    return {path:null,warning:`SKP 尚未完成：${error.message}；FBX／GLB 可獨立驗收及發布`};
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',stop);
    if (child?.pid && child.exitCode === null) await killTree(child.pid);
    await lock?.release();
  }
}

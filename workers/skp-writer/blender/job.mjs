import { existsSync } from 'node:fs';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { downloadReferences } from '../codex/images.mjs';
import { createZip, sha256 } from '../codex/artifacts.mjs';
import { buildBlenderPrompt } from './driver.mjs';
import { executeBlenderCodex } from './codex.mjs';
import { convertSkp } from './convert-skp.mjs';
import { orientationGaps, validateBlender } from './validation.mjs';

export async function generateBlenderDraft({job,deps,dir,paths,stage,signal}) {
  if (!deps.blenderExe) throw Object.assign(new Error('找不到 Blender，請安裝或設定 FDS_BLENDER_EXE'),{kind:'setup',retryable:false});
  const input = job.input ?? {};
  const write = (name,data) => writeFile(join(dir,name),JSON.stringify(data,null,2));
  const fail = (kind,message) => Object.assign(new Error(`${kind}: ${message}`),{kind,retryable:false});
  await stage('download',0.05,'下載 Blender 建模參考圖');
  const refs = await downloadReferences(input.references ?? [],paths.refs);
  await write('references.json',refs);
  if (!refs.saved.length) throw fail('input','參考圖片下載失敗');
  const blend = join(paths.outputs,'model.blend');
  const script = join(dir,'build_model.py');
  if (deps.revisionSeed && !existsSync(blend)) {
    const old = dirname(deps.revisionSeed);
    if (!existsSync(join(old,'model.blend'))) throw fail('validation','缺少上一版 Blender 原始檔');
    await copyFile(join(old,'model.blend'),blend);
    await copyFile(join(dirname(old),'build_model.py'),script);
  }
  const recovery = join(dir,'blender-recovery.json');
  const saved = existsSync(recovery) ? JSON.parse(await readFile(recovery,'utf8')) : null;
  if (saved && saved.job_id !== job.id) throw fail('validation','Blender recovery identity mismatch');
  let report;
  if (saved?.stage === 'export' && !deps.feedback) {
    report = JSON.parse(await readFile(join(paths.outputs,'report.json'),'utf8'));
  } else {
    await write('blender-recovery.json',{job_id:job.id,stage:'modeling'});
    await stage('codex',0.15,'Codex 操作 Blender 建模、渲染及四視角檢查');
    let prompt = buildBlenderPrompt({snapshot:input,references:refs.saved,reportPath:join(paths.outputs,'report.json')});
    if (existsSync(blend)) prompt += '\n現有 model.blend 和 build_model.py 已保留，請接續修正，保留無關部件。';
    if (deps.feedback) prompt += `\n修正要求：${deps.feedback}`;
    await writeFile(join(dir,'prompt.md'),prompt);
    const entries = await executeBlenderCodex({job,dir,paths,config:deps.config,blenderExe:deps.blenderExe,prompt,references:refs.saved,signal,secrets:deps.secrets});
    report = JSON.parse((await readFile(join(paths.outputs,'report.json'),'utf8')).replace(/^\uFEFF/,''));
    const gaps = orientationGaps(report,refs.saved,entries);
    if (entries.findLast((e)=>e.tool==='run_blender'&&e.ok)?.script_sha256 !== sha256(await readFile(script))) gaps.push('建模腳本在最後一次執行後被修改，需重新執行及檢查');
    if (!Array.isArray(report.parts) || !report.parts.length || !Array.isArray(report.batches) || !report.batches.length || !Array.isArray(report.semantic_checks) || !Array.isArray(report.known_issues)) gaps.push('建模報告欄位不完整');
    if (gaps.length) throw fail('validation',`orientation_review_required: ${gaps.join('；')}`);
    await write('blender-recovery.json',{job_id:job.id,stage:'export'});
  }
  await stage('validate',0.6,'檢查 Blender 原生 FBX／GLB、尺寸及部件');
  const out = {fbx:join(paths.fbxDir,'model.fbx'),glb:join(paths.outputs,'model.glb'),preview:join(paths.outputs,'view-iso.png'),blend};
  const info = JSON.parse(await readFile(join(paths.outputs,'scene-info.json'),'utf8'));
  const validation = validateBlender({snapshot:input,info,report,glbBytes:await readFile(out.glb),fbxBytes:await readFile(out.fbx),previewBytes:await readFile(out.preview)});
  if (!validation.ok) {
    await write('validation.json',validation);
    const detail=validation.checks.filter((c)=>!c.ok&&c.severity==='error').map((c)=>`${c.name}: ${c.detail}`).join('；');
    if ((deps.blenderRepairRound ?? 0) < 2) return generateBlenderDraft({job,deps:{...deps,blenderRepairRound:(deps.blenderRepairRound??0)+1,feedback:[deps.feedback,`現有 Blender 模型已保留，請只修正以下量測失敗項目，再重看四視角並更新報告：${detail}`].filter(Boolean).join('\n')},dir,paths,stage,signal});
    throw fail('validation',detail);
  }
  await stage('export',0.7,'Blender FBX／GLB 已完成；獨立轉換 SKP（失敗不阻擋發布）');
  const skp = await (deps.convertSkp ?? convertSkp)({job,dir,config:deps.config,sketchupExe:deps.sketchupExe,seedPath:deps.seedPath,signal,secrets:deps.secrets});
  out.skp = skp.path;
  validation.skp_status = skp.path ? 'ready' : 'unavailable';
  validation.checks.push({name:'skp_conversion',ok:!!skp.path,severity:'warning',detail:skp.warning || 'SKP 已獨立轉換'});
  await write('validation.json',validation);
  const fbxFiles = [];
  async function walk(folder) {
    for (const e of await readdir(folder,{withFileTypes:true})) {
      const p=join(folder,e.name);
      if(e.isDirectory()) await walk(p);
      else fbxFiles.push({name:relative(paths.fbxDir,p).replaceAll('\\','/'),data:await readFile(p)});
    }
  }
  await walk(paths.fbxDir);
  const zip = createZip(fbxFiles);
  const zipPath=join(paths.outputs,'fbx-bundle.zip');
  await writeFile(zipPath,zip);
  const files=await Promise.all([out.skp,out.fbx,out.glb,out.preview,blend,script,join(paths.outputs,'report.json'),join(dir,'validation.json'),zipPath].filter(Boolean).map(async(p)=>({path:relative(dir,p),hash:sha256(await readFile(p))})));
  return {out,validation,report,base:'model',zipEntries:fbxFiles.map((f)=>f.name),files};
}

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function load(path, deps = {}) {
  const c = { exports: {}, require: name => deps[name] ?? require(name), Blob, TextEncoder, ArrayBuffer, DataView, Uint8Array, Float32Array, Uint16Array };
  vm.createContext(c);
  vm.runInContext(ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, c);
  return c.exports;
}
const p = load('../src/lib/furnitureParametric.ts');
const s = load('../src/lib/furnitureStructure.ts', { './furnitureParametric': p, three: THREE });
const glb = load('../src/lib/furnitureGlb.ts', { '@/lib/furnitureParametric': p });
const fbx = load('../src/lib/furnitureFbx.ts', { '@/lib/furnitureParametric': p });
const workerAst=ts.createSourceFile('worker.mjs',fs.readFileSync(new URL('../workers/skp-writer/worker.mjs',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const writerContext={clean:String}; vm.createContext(writerContext);
vm.runInContext(workerAst.statements.filter(node=>ts.isFunctionDeclaration(node)&&['writerInput','boxFaces'].includes(node.name?.text)).map(node=>node.getText(workerAst)).join('\n'),writerContext);
const table = [{ name: '桌面', shape: 'box', role: 'top', form: 'panel', size_mm: [600,400,30], center_mm: [0,0,735], connects_to: [1,2,3,4] }];
for (const x of [-260,260]) for (const y of [-160,160]) table.push({ name: '腳', shape: 'box', role: 'leg', form: 'straight', size_mm: [40,40,720], center_mm: [x,y,360], connects_to: [0] });
const evidence = { leg_count: 4, part_counts: {leg:4,top:1,seat:0,back:0,arm:0,frame:0,body:0,shelf:0,other:0}, symmetric: true, uncertainties: [] };
const build = parts => p.buildParametric({ kind: 'custom', width_mm:600,depth_mm:400,height_mm:750,parts });
assert.equal(s.validateFurnitureStructure(build(table), evidence).length, 0);
assert.ok(s.validateFurnitureStructure(build(table.slice(0,4).map(part => ({...part,connects_to:part.connects_to.filter(i=>i<4)}))), evidence).some(n=>n.includes('腳數')));
const detached=structuredClone(table); detached[1].center_mm[0]=1000;
assert.ok(s.validateFurnitureStructure(build(detached), evidence).some(n=>n.includes('未接合')));
assert.ok(s.validateFurnitureStructure(build(table), {...evidence,uncertainties:['背面不清楚']}).some(n=>n.includes('待確認')));
{
  const open = {...evidence,uncertainties:['背面不清楚','腳距未標註']};
  const checked = s.resolveUncertainty(open, '背面不清楚', 'checked', '側面照可見', 'pm@x');
  assert.ok(s.validateFurnitureStructure(build(table), checked).some(n=>n.includes('腳距未標註')));
  assert.ok(!s.validateFurnitureStructure(build(table), checked).some(n=>n.includes('背面不清楚')));
  const both = s.resolveUncertainty(checked, '腳距未標註', 'estimate', undefined, 'pm@x');
  assert.ok(!s.validateFurnitureStructure(build(table), both).some(n=>n.includes('待確認')));
  assert.deepEqual([...s.estimatedUncertainties(both)], ['腳距未標註']);
  assert.ok(s.validateFurnitureStructure(build(table), s.reopenUncertainty(both, '腳距未標註')).some(n=>n.includes('腳距未標註')));
  const reread = s.carryResolutions(both, {...evidence,uncertainties:['腳距未標註','新問題']});
  assert.equal(JSON.stringify(reread.resolved.map(r=>r.text)), '["腳距未標註"]');
  assert.ok(s.validateFurnitureStructure(build(table), reread).some(n=>n.includes('新問題')));
}
const asymmetric=structuredClone(table); asymmetric[1].center_mm[0]+=50;
assert.ok(s.validateFurnitureStructure(build(asymmetric), evidence).some(n=>n.includes('不對稱')));
const noConnections=table.map(part=>({...part,connects_to:[]}));
assert.ok(s.validateFurnitureStructure(build(noConnections), evidence).some(n=>n.includes('懸空')));
assert.ok(s.validateFurnitureStructure(build(table.slice(1).map(part=>({...part,connects_to:[]}))),evidence).some(n=>n.includes('主要部件數量不符')),'Removing a tabletop must not pass just because all four legs remain');
assert.equal(s.selectFurnitureGeometry({kind:'conference',width_mm:600,depth_mm:400,height_mm:750,style:{legs:'four'},parts:table}).kind,'custom');
const template=p.buildParametric({kind:'coffee',width_mm:600,depth_mm:400,height_mm:750,style:{legs:'four'}});
const identical=template.components.map(part=>({name:part.name,shape:'box',size_mm:part.size_mm,center_mm:part.position_mm}));
assert.equal(s.selectFurnitureGeometry({kind:'coffee',width_mm:600,depth_mm:400,height_mm:750,style:{legs:'four'},parts:identical}).templateMatched,true);
for (const section of ['rect','round']) for (const path of [[[0,0,-200],[80,40,200]], [[-150,0,-200],[-150,0,100],[-100,0,150],[150,0,150]]]) {
  const spec={name:'路徑腳',shape:'sweep',size_mm:[400,80,450],center_mm:[0,0,225],path_mm:path,section,section_mm:[30,30],end_section_mm:[20,20]};
  const checked=p.sanitizeCustomParts([spec]);
  const model=build(checked);
  const mesh=model.components[0];
  assert.ok(mesh.faces_mm.length>=10);
  assert.ok(mesh.faces_mm.flat().every(v=>v.every(Number.isFinite)));
  const edges=new Map();
  for (const face of mesh.faces_mm) for(let i=0;i<face.length;i++) { const key=[face[i],face[(i+1)%face.length]].map(v=>v.map(n=>n.toFixed(5)).join(',')).sort().join('|'); edges.set(key,(edges.get(key)??0)+1); }
  assert.ok([...edges.values()].every(n=>n===2),'Swept solid must be watertight');
  const fit=p.fitCustomPartsWithConstraints(checked,600,400,750);
  const size=p.customPartsSize(fit.parts);
  const flat=path.every(v=>v[1]===0);
  if (flat) assert.ok(fit.conflicts.some(n=>n.includes('路徑腳')&&n.includes('深')),'A flat tube cannot gain depth without changing its section; the contradiction is named');
  else assert.ok(fit.conflicts.length===0&&size.every((n,i)=>Math.abs(n-[600,400,750][i])<=1),'Stretching an oriented sweep reaches the confirmed size');
  assert.ok(fit.parts[0].geometry_scale===undefined,'Constraint fit never scales the tube section');
  const buffer=await glb.buildFurnitureGlb(model).arrayBuffer();
  assert.equal(new DataView(buffer).getUint32(0,true),0x46546c67);
  const jsonLength=new DataView(buffer).getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength)));
  assert.equal(json.meshes.length,model.components.length);
  assert.ok((await fbx.buildFurnitureFbx(model).text()).includes('FBXHeaderExtension'));
  const serialized=writerContext.writerInput({parametric:model});
  let origin;
  const recovered=[];
  for(const line of serialized.trim().split('\n')) {
    const cells=line.split('\t');
    if(cells[0]==='part')origin=cells.slice(2).map(Number);
    if(cells[0]==='face')recovered.push(...cells[1].split(';').map(pt=>pt.split(',').map((n,i)=>Number(n)+origin[i])));
  }
  const expected=mesh.faces_mm.flat();
  assert.equal(recovered.length,expected.length);
  recovered.forEach((point,i)=>point.forEach((n,k)=>assert.ok(Math.abs(n-expected[i][k])<0.001,'SKP writer input must preserve the preview mesh')));
}
assert.throws(()=>p.sanitizeCustomParts([{name:'壞路徑',shape:'sweep',size_mm:[30,30,400],center_mm:[0,0,200],path_mm:[[0,0,0],[0,0,0]],section:'round',section_mm:[30,30]}]));

const frame = load('../src/lib/frameGlb.ts', { three: THREE });
const offsetGroup = new THREE.Group();
const offsetMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.4));
offsetMesh.position.set(2.5, 0.4, -1.2);
offsetGroup.add(offsetMesh);
const offsetCamera = new THREE.PerspectiveCamera(35, 16 / 9, 0.01, 100);
frame.frameGlbRoot(offsetGroup, offsetCamera);
offsetGroup.updateWorldMatrix(true, true);
const framed = new THREE.Box3().setFromObject(offsetGroup, true).getCenter(new THREE.Vector3());
assert.ok(framed.length() < 1e-4, `framed model center should be the origin, got ${framed.toArray()}`);
offsetCamera.updateMatrixWorld(true);
const ndc = framed.clone().project(offsetCamera);
assert.ok(Math.abs(ndc.x) < 0.02 && Math.abs(ndc.y) < 0.02, `framed model should project to the middle, got ${ndc.toArray()}`);
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const generatedBuffer = await glb.buildFurnitureGlb(template).arrayBuffer();
const generated = await new Promise((resolve, reject) => new GLTFLoader().parse(generatedBuffer, '', resolve, reject));
const generatedRoot = new THREE.Group();
generatedRoot.add(generated.scene);
const generatedCamera = new THREE.PerspectiveCamera(35, 4 / 3, 0.01, 100);
frame.frameGlbRoot(generatedRoot, generatedCamera);
generatedRoot.updateWorldMatrix(true, true);
generatedCamera.updateMatrixWorld(true);
const generatedCenter = new THREE.Box3().setFromObject(generatedRoot, true).getCenter(new THREE.Vector3()).project(generatedCamera);
assert.ok(Math.abs(generatedCenter.x) < 0.02 && Math.abs(generatedCenter.y) < 0.02, `generated GLB should land in the middle, got ${generatedCenter.toArray()}`);

console.log('PASS: structural counts, uncertainty, symmetry, contact, grounding, exact template matching, watertight slanted/bent/tapered solids, scaling, GLB/FBX and unchanged SKP writer vertices');

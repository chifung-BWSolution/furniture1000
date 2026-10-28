import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function load(path, deps = {}) {
  const c = { exports: {}, require: name => deps[name] ?? require(name), Blob, TextEncoder, ArrayBuffer, DataView, Uint8Array, Float32Array, Uint16Array, Uint32Array };
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
assert.ok(!s.validateFurnitureStructure(build(detached), evidence).some(n=>n.includes('未接合')), 'A gap between declared parts does not block generation');
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
{
  // Boat top: 10 control points, smooth; 40 mm body, edge bevelled underneath.
  const boat = (inset) => [[-1200+inset,0],[-1150+inset,-420+inset],[-600,-560+inset],[0,-600+inset],[600,-560+inset],[1150-inset,-420+inset],[1200-inset,0],[1150-inset,420-inset],[0,600-inset],[-1150+inset,420-inset]];
  const top = { name:'桌面', shape:'loft', role:'top', form:'panel', axis:'z', smooth:true, size_mm:[2400,1200,40], center_mm:[0,0,730], connects_to:[1,2],
    sections_mm:[{at:-20,points_mm:boat(60)},{at:-5,points_mm:boat(0)},{at:20,points_mm:boat(0)}] };
  // Folded plate: straight to the fold, then leaning inward and narrowing under the top.
  const leg = (side) => ({ name:'折板腳', shape:'loft', role:'leg', form:'bent', axis:'z', size_mm:[300,700,710], center_mm:[side*700,0,355], connects_to:[0],
    sections_mm:[
      {at:-355,points_mm:[[side*130,-350],[side*150,-350],[side*150,350],[side*130,350]]},
      {at:60,points_mm:[[side*130,-350],[side*150,-350],[side*150,350],[side*130,350]]},
      {at:355,points_mm:[[side*-150,-150],[side*-130,-150],[side*-130,150],[side*-150,150]]},
    ] });
  const parts = p.sanitizeCustomParts([top, leg(-1), leg(1)]);
  const model = p.buildParametric({ kind:'custom', width_mm:2400, depth_mm:1200, height_mm:750, parts:p.fitCustomParts(parts,2400,1200,750) });
  for (const mesh of model.components) {
    const edges=new Map();
    for (const face of mesh.faces_mm) for(let i=0;i<face.length;i++) { const key=[face[i],face[(i+1)%face.length]].map(v=>v.map(n=>n.toFixed(5)).join(',')).sort().join('|'); edges.set(key,(edges.get(key)??0)+1); }
    assert.ok([...edges.values()].every(n=>n===2),`Loft ${mesh.name} must be watertight`);
  }
  const ring = model.components[0].faces_mm[1];
  assert.ok(ring.length >= 48, 'Smooth outline is sampled into a curve, not the 10 control points');
  const longEdgeY = ring.filter(v=>Math.abs(v[0])<50).map(v=>Math.abs(v[1]));
  assert.ok(longEdgeY.some(y=>y>595 && y<=601), 'The curve passes through the mid control point');
  const bottomZ = Math.min(...model.components[0].faces_mm.flat().map(v=>v[2]));
  const rimXs = model.components[0].faces_mm.flat().filter(v=>Math.abs(v[2]-bottomZ)<0.01).map(v=>Math.abs(v[0]));
  assert.ok(Math.max(...rimXs) < 1200 - 50, 'The underside is inset by the bevel');
  const size = model.components.reduce((acc,m)=>{ for(const v of m.faces_mm.flat()) for(let k=0;k<3;k++){acc[0][k]=Math.min(acc[0][k],v[k]);acc[1][k]=Math.max(acc[1][k],v[k]);} return acc; },[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]]);
  [2400,1200,750].forEach((n,k)=>assert.ok(Math.abs(size[1][k]-size[0][k]-n)<=1,`Loft parts fit the confirmed size on axis ${k}`));
  const loftEvidence = { leg_count:2, part_counts:{leg:2,top:1,seat:0,back:0,arm:0,frame:0,body:0,shelf:0,other:0}, symmetric:true, uncertainties:[] };
  const loftErrors = s.validateFurnitureStructure(model, loftEvidence);
  assert.ok(!loftErrors.some(n=>n.includes('未表達')), `A three-section loft expresses a bent plate: ${loftErrors}`);
  assert.equal(JSON.stringify(p.buildParametric({ kind:'custom', width_mm:2400, depth_mm:1200, height_mm:750, parts:model.custom_parts }).components), JSON.stringify(model.components), 'Same loft parts rebuild the same mesh');
  const serialized=writerContext.writerInput({parametric:model});
  assert.equal(serialized.split('\n').filter(l=>l.startsWith('face')).length, model.components.reduce((n,m)=>n+m.faces_mm.length,0), 'SKP writer receives every loft face');
  assert.throws(()=>p.sanitizeCustomParts([{...top, sections_mm:[top.sections_mm[0], {at:0, points_mm:boat(0).slice(1)}]}]), 'Sections with different point counts are rejected');
  assert.throws(()=>p.sanitizeCustomParts([{...top, sections_mm:[top.sections_mm[1], top.sections_mm[0]]}]), 'Sections out of order are rejected');
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

{
  const cushion = p.sanitizeCustomParts([{ name: '座墊', shape: 'box', role: 'seat', form: 'panel', size_mm: [640, 600, 160], center_mm: [0, 0, 80], radius_mm: 50, connects_to: [] }]);
  assert.equal(cushion[0].radius_mm, 50);
  const model = p.buildParametric({ kind: 'custom', width_mm: 640, depth_mm: 600, height_mm: 160, parts: cushion });
  const mesh = model.components[0];
  assert.ok(mesh.faces_mm.length > 6, 'Rounded box must not fall back to six faces');
  const edges = new Map();
  for (const face of mesh.faces_mm) for (let i = 0; i < face.length; i++) { const key = [face[i], face[(i + 1) % face.length]].map(v => v.map(n => n.toFixed(5)).join(',')).sort().join('|'); edges.set(key, (edges.get(key) ?? 0) + 1); }
  assert.ok([...edges.values()].every(n => n === 2), 'Rounded box must be watertight');
  const pts = mesh.faces_mm.flat();
  for (const [k, size] of [[0, 640], [1, 600], [2, 160]]) {
    const span = Math.max(...pts.map(q => q[k])) - Math.min(...pts.map(q => q[k]));
    assert.ok(Math.abs(span - size) < 0.01, `Rounded box keeps its size on axis ${k}`);
  }
  assert.ok(!pts.some(q => Math.abs(q[0]) > 319.9 && Math.abs(q[1]) > 299.9), 'Corners are rounded off');
  const tiny = p.buildParametric({ kind: 'custom', width_mm: 600, depth_mm: 400, height_mm: 18, parts: p.sanitizeCustomParts([{ name: '板', shape: 'box', role: 'top', form: 'panel', size_mm: [600, 400, 18], center_mm: [0, 0, 9], radius_mm: 40, connects_to: [] }]) });
  assert.equal(tiny.components[0].faces_mm.length, 6, 'A radius larger than a thin board allows falls back to a sharp box');
  const serialized = writerContext.writerInput({ parametric: model });
  assert.ok(JSON.stringify(serialized).length > 0, 'SKP writer accepts a rounded box');
  const fitted = p.fitCustomParts(cushion, 800, 600, 160);
  assert.equal(fitted[0].radius_mm, 50, 'Overall resize keeps the radius');
}

// ---- fds-parametric-5: limits, appearance, rotation, repeat／mirror, bulge, holes, sphere, lathe, tube sections ----
const loopsOf = (mesh) => [...mesh.faces_mm, ...(mesh.face_holes_mm ?? []).flat()];
function assertWatertight(mesh, label) {
  const edges = new Map();
  for (const face of loopsOf(mesh)) for (let i = 0; i < face.length; i++) { const key = [face[i], face[(i + 1) % face.length]].map(v => v.map(n => n.toFixed(4)).join(',')).sort().join('|'); edges.set(key, (edges.get(key) ?? 0) + 1); }
  const bad = [...edges.values()].filter(n => n !== 2).length;
  assert.equal(bad, 0, `${label} must be watertight (${bad} open edges)`);
}
function volume(mesh) {
  let v = 0;
  for (const { points, triangles } of p.partPolygons(mesh)) for (const [i, j, k] of triangles) {
    const [a, b, c] = [points[i], points[j], points[k]];
    v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return v / 6;
}
const span = (mesh) => [0, 1, 2].map(k => Math.max(...mesh.faces_mm.flat().map(q => q[k])) - Math.min(...mesh.faces_mm.flat().map(q => q[k])));
const planarFaces = (mesh) => mesh.faces_mm.every(face => {
  if (face.length < 4) return true;
  const n = p.faceNormal(face);
  const d = n.reduce((s, x, k) => s + x * face[0][k], 0);
  return face.every(q => Math.abs(n.reduce((s, x, k) => s + x * q[k], 0) - d) < 0.05);
});
const custom = (parts, size) => p.buildParametric({ kind: 'custom', width_mm: size[0], depth_mm: size[1], height_mm: size[2], parts: p.sanitizeCustomParts(parts) });

{ // 3. One limit, counted after expansion; the edge function uses the same numbers.
  const edge = fs.readFileSync(new URL('../supabase/functions/generate-furniture-model/index.ts', import.meta.url), 'utf8');
  assert.equal(Number(edge.match(/const MAX_PARTS = (\d+)/)[1]), p.MAX_PART_ENTRIES, 'AI entry limit matches the browser');
  assert.equal(Number(edge.match(/const MAX_SOLIDS = (\d+)/)[1]), p.MAX_CUSTOM_PARTS, 'Expanded solid limit matches the browser');
  const slat = { name: '條', shape: 'box', size_mm: [20, 400, 20], center_mm: [0, 0, 10] };
  assert.equal(p.sanitizeCustomParts([{ ...slat, repeat: { count: 20, step_mm: [30, 0, 0] } }]).length, 20);
  assert.throws(() => p.sanitizeCustomParts(Array.from({ length: 9 }, () => ({ ...slat, repeat: { count: 20, step_mm: [30, 0, 0] } }))), /超出上限/, '9 × 20 = 180 solids exceed the expanded limit');
  assert.throws(() => p.sanitizeCustomParts([{ ...slat, repeat: { count: 3, step_mm: [0, 0, 0] } }]), 'Copies on top of each other are rejected');
}

{ // 4 + 12. Colour, material and transparency reach every exporter.
  const parts = [
    { name: '玻璃面', shape: 'box', role: 'top', form: 'panel', size_mm: [800, 500, 12], center_mm: [0, 0, 446], material: 'glass', connects_to: [1] },
    { name: '木座', shape: 'box', role: 'body', form: 'panel', size_mm: [600, 400, 440], center_mm: [0, 0, 220], material: 'wood', color: '#8B5A2B', connects_to: [0] },
    { name: '網背', shape: 'box', role: 'back', form: 'panel', size_mm: [500, 10, 300], center_mm: [0, -150, 600], material: 'mesh', color: 'grey', opacity: 0.5 },
  ];
  const checked = p.sanitizeCustomParts(parts);
  assert.equal(checked[1].color, '#8b5a2b', 'Colour is normalised');
  assert.equal(checked[2].color, undefined, 'An unreadable colour is dropped, not fatal');
  const model = p.buildParametric({ kind: 'custom', width_mm: 800, depth_mm: 500, height_mm: 750, parts: checked });
  const [glass, wood, mesh] = model.components;
  assert.equal(glass.opacity, 0.35, 'Glass defaults to see-through');
  assert.equal(mesh.opacity, 0.5, 'Explicit opacity wins over the mesh default');
  assert.equal(wood.color, '#8b5a2b');
  assert.equal(p.buildParametric({ kind: 'custom', width_mm: 600, depth_mm: 400, height_mm: 750, parts: table }).components[0].color, undefined, 'Parts without appearance keep the default look');
  const buffer = await glb.buildFurnitureGlb(model).arrayBuffer();
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, new DataView(buffer).getUint32(12, true))));
  assert.equal(json.materials.length, 3);
  assert.equal(json.materials[json.meshes[0].primitives[0].material].alphaMode, 'BLEND');
  const loaded = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
  const glassMesh = loaded.scene.children.find(n => n.name === '玻璃面');
  assert.ok(glassMesh.material.transparent && Math.abs(glassMesh.material.opacity - 0.35) < 0.01, 'GLB glass loads see-through');
  const fbxText = await fbx.buildFurnitureFbx(model).text();
  assert.equal((fbxText.match(/^\tMaterial: \d+/gm) ?? []).length, 3, 'FBX writes one material per look');
  assert.equal((fbxText.match(/C: "OO",5\d{5},/g) ?? []).length, 3, 'Each part model links its material');
  assert.ok(fbxText.includes('"Opacity", "double", "Number", "",0.35'));
  const serialized = writerContext.writerInput({ parametric: model });
  assert.ok(serialized.includes('mat\t#cfe3ea\t0.35\tglass'), 'SKP input carries the glass material');
  assert.ok(serialized.includes('mat\t#8b5a2b\t1\twood'));
}

{ // 5. Turned parts: slanted legs as rotated boxes／cylinders, still resizable.
  const leg = (x) => ({ name: '斜腳', shape: 'cylinder', role: 'leg', form: 'slanted', axis: 'z', size_mm: [40, 40, 420], center_mm: [x, 0, 205], rotation_deg: [0, x < 0 ? -12 : 12, 0], connects_to: [2] });
  const parts = [leg(-300), leg(300), { name: '座', shape: 'box', role: 'seat', form: 'panel', size_mm: [760, 400, 60], center_mm: [0, 0, 440], connects_to: [0, 1] }];
  const model = custom(parts, [800, 400, 470]);
  const rotated = model.components[0];
  assertWatertight(rotated, 'Rotated cylinder');
  assert.ok(volume(rotated) > 0, 'Rotated part stays outward');
  const s0 = span(rotated);
  assert.ok(Math.abs(s0[2] - (420 * Math.cos(12 * Math.PI / 180) + 40 * Math.sin(12 * Math.PI / 180))) < 2, `Height of a 12° leg is its slanted reach, got ${s0[2]}`);
  const evidence = { leg_count: 2, part_counts: { leg: 2, top: 0, seat: 1, back: 0, arm: 0, frame: 0, body: 0, shelf: 0, other: 0 }, symmetric: true, uncertainties: [] };
  const errors = s.validateFurnitureStructure(model, evidence);
  assert.ok(!errors.some(n => n.includes('未表達')), `A rotated cylinder expresses a slanted leg: ${errors}`);
  assert.ok(!errors.some(n => n.includes('不對稱')), `Mirrored rotation stays symmetric: ${errors}`);
  const checked = p.sanitizeCustomParts(parts);
  const fit = p.fitCustomPartsWithConstraints(checked, 900, 400, 560);
  const size = p.customPartsSize(fit.parts);
  assert.ok(fit.conflicts.length === 0 && size.every((n, i) => Math.abs(n - [900, 400, 560][i]) <= 1), `Rotated legs stretch to the new height: ${size} ${fit.conflicts}`);
  assert.throws(() => p.sanitizeCustomParts([{ name: '管', shape: 'sweep', size_mm: [30, 30, 400], center_mm: [0, 0, 200], path_mm: [[0, 0, -200], [0, 0, 200]], section: 'round', section_mm: [30, 30], rotation_deg: [0, 10, 0] }]), 'Sweeps carry direction in their path, not rotation_deg');
}

{ // 6. Repeat and mirror expand before modelling; joints reach every copy.
  const parts = [
    { name: '桌面', shape: 'box', role: 'top', form: 'panel', size_mm: [600, 400, 30], center_mm: [0, 0, 735], connects_to: [1], part_id: 'top' },
    { name: '腳', shape: 'box', role: 'leg', form: 'straight', size_mm: [40, 40, 720], center_mm: [-260, -160, 360], connects_to: [0], repeat: { count: 2, step_mm: [0, 320, 0] }, mirror: 'x', part_id: 'leg' },
  ];
  const expanded = p.sanitizeCustomParts(parts);
  assert.equal(expanded.length, 5);
  assert.deepEqual([...expanded[0].connects_to], [1, 2, 3, 4], 'The top joins all four legs');
  assert.ok(expanded.slice(1).every(leg => leg.connects_to.length === 1 && leg.connects_to[0] === 0));
  assert.ok(expanded.every(part => !part.repeat && !part.mirror), 'No repeat／mirror survives expansion');
  assert.equal(new Set(expanded.map(part => part.part_id)).size, 5, 'Every copy gets its own id');
  assert.equal(JSON.stringify(expanded.slice(1).map(leg => leg.center_mm.slice(0, 2).join(',')).sort()), JSON.stringify(['-260,-160', '-260,160', '260,-160', '260,160']));
  const model = p.buildParametric({ kind: 'custom', width_mm: 600, depth_mm: 400, height_mm: 750, parts: expanded });
  assert.equal(s.validateFurnitureStructure(model, evidence).length, 0, 'Expanded legs satisfy the four-leg structure');
  assert.equal(JSON.stringify(p.sanitizeCustomParts(expanded)), JSON.stringify(expanded), 'Sanitising an expanded list again changes nothing');
  // Mirroring a turned, holed profile reflects every coordinate.
  const arm = { name: '扶手', shape: 'profile', axis: 'x', size_mm: [60, 500, 300], center_mm: [300, 0, 450], points_mm: [[-250, -150], [250, -150], [250, 150], [-250, 150]], holes_mm: [[[100, -50], [200, -50], [200, 50], [100, 50]]], rotation_deg: [0, 0, 10], mirror: 'x' };
  const [right, left] = p.buildParametric({ kind: 'custom', width_mm: 700, depth_mm: 600, height_mm: 600, parts: p.sanitizeCustomParts([arm]) }).components;
  const key = (pts) => pts.map(q => q.map(n => n.toFixed(2)).join(',')).sort().join('|');
  assert.equal(key(left.faces_mm.flat().map(([x, y, z]) => [-x, y, z])), key(right.faces_mm.flat()), 'Mirror copy is the exact reflection');
  assert.ok(volume(left) > 0 && volume(right) > 0);
}

{ // 7. Crowned tops stay closed and planar, and keep their size when fitted.
  const cushion = p.sanitizeCustomParts([{ name: '座墊', shape: 'box', role: 'seat', form: 'panel', size_mm: [600, 560, 140], center_mm: [0, 0, 70], radius_mm: 40, bulge_mm: 30 }]);
  const model = p.buildParametric({ kind: 'custom', width_mm: 600, depth_mm: 560, height_mm: 170, parts: cushion });
  const mesh = model.components[0];
  assertWatertight(mesh, 'Bulged cushion');
  assert.ok(planarFaces(mesh), 'Every bulged facet is flat');
  assert.ok(Math.abs(span(mesh)[2] - 170) < 0.5, `Crown adds bulge_mm to the height, got ${span(mesh)[2]}`);
  assert.ok(volume(mesh) > 0);
  const flatTop = p.buildParametric({ kind: 'custom', width_mm: 600, depth_mm: 560, height_mm: 140, parts: p.sanitizeCustomParts([{ name: '方墊', shape: 'box', size_mm: [600, 560, 140], center_mm: [0, 0, 70], bulge_mm: 25 }]) }).components[0];
  assertWatertight(flatTop, 'Bulged sharp box');
  const fit = p.fitCustomPartsWithConstraints(cushion, 700, 560, 200);
  assert.ok(Math.abs(p.customPartsSize(fit.parts)[2] - 200) <= 1, 'Fitting a crowned cushion reaches the overall height');
  assert.ok(writerContext.writerInput({ parametric: model }).split('\n').filter(l => l.startsWith('face')).length === mesh.faces_mm.length);
}

{ // 8. Through-holes: triangulation, structure contact and the SKP inner loops.
  const panel = { name: '側板', shape: 'profile', role: 'body', form: 'panel', axis: 'x', size_mm: [18, 500, 700], center_mm: [0, 0, 350], points_mm: [[-250, -350], [250, -350], [250, 350], [-250, 350]], holes_mm: [[[-150, 150], [150, 150], [150, 250], [-150, 250]], [[-60, -200], [60, -200], [60, -80], [-60, -80]]], connects_to: [] };
  const checked = p.sanitizeCustomParts([panel]);
  const model = p.buildParametric({ kind: 'custom', width_mm: 18, depth_mm: 500, height_mm: 700, parts: checked });
  const mesh = model.components[0];
  assertWatertight(mesh, 'Holed panel');
  assert.ok(volume(mesh) > 0);
  const cap = p.partPolygons(mesh)[0];
  const capArea = cap.triangles.reduce((sum, [i, j, k]) => {
    const u = cap.points[j].map((x, m) => x - cap.points[i][m]), w = cap.points[k].map((x, m) => x - cap.points[i][m]);
    return sum + Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }, 0);
  assert.ok(Math.abs(capArea - (500 * 700 - 300 * 100 - 120 * 120)) < 1, `Cap area excludes the holes, got ${capArea}`);
  const serialized = writerContext.writerInput({ parametric: model });
  assert.equal(serialized.split('\n').filter(l => l.startsWith('hole')).length, 4, 'Both caps carry both holes for SketchUp');
  const lines = serialized.trim().split('\n');
  assert.ok(lines[lines.findIndex(l => l.startsWith('hole')) - 1].startsWith('face'), 'A hole line follows the face it belongs to');
  const holedBuffer = await glb.buildFurnitureGlb(model).arrayBuffer();
  const holed = await new Promise((resolve, reject) => new GLTFLoader().parse(holedBuffer, '', resolve, reject));
  assert.equal(holed.scene.children.length, 1, 'GLB with holes loads');
  const smooth = p.buildParametric({ kind: 'custom', width_mm: 18, depth_mm: 500, height_mm: 700, parts: p.sanitizeCustomParts([{ ...panel, smooth: true, holes_mm: [[[-60, 150], [0, 210], [60, 150], [0, 90]]] }]) }).components[0];
  assertWatertight(smooth, 'Smooth holed panel');
  // A rod passing through the hole without touching it is not in contact with the panel.
  const rod = { name: '桿', shape: 'cylinder', role: 'frame', form: 'straight', axis: 'x', size_mm: [200, 40, 40], center_mm: [0, 0, 200], connects_to: [0] };
  const pair = p.buildParametric({ kind: 'custom', width_mm: 200, depth_mm: 500, height_mm: 700, parts: p.sanitizeCustomParts([{ ...panel, connects_to: [1] }, rod]) });
  const evidence8 = { leg_count: 0, part_counts: { leg: 0, top: 0, seat: 0, back: 0, arm: 0, frame: 1, body: 1, shelf: 0, other: 0 }, symmetric: false, uncertainties: [] };
  assert.ok(s.validateFurnitureStructure(pair, evidence8).some(n => n.includes('懸空')), 'A rod through an open hole is not joined to the panel');
  assert.throws(() => p.sanitizeCustomParts([{ ...panel, holes_mm: [[[200, 300], [300, 300], [300, 400], [200, 400]]] }]), /孔位/, 'A hole outside the outline is rejected');
  assert.throws(() => p.sanitizeCustomParts([{ ...panel, holes_mm: [panel.holes_mm[0], panel.holes_mm[0].map(([a, b]) => [a + 50, b])] }]), /孔位/, 'Overlapping holes are rejected');
}

{ // 9 + 10. Spheres, hemispheres and lathed parts on every axis.
  for (const axis of ['x', 'y', 'z']) {
    const ball = custom([{ name: '球', shape: 'sphere', axis, size_mm: [300, 200, 240], center_mm: [0, 0, 120] }], [300, 200, 240]).components[0];
    assertWatertight(ball, `Sphere on ${axis}`);
    assert.ok(volume(ball) > 0, `Sphere on ${axis} faces outward`);
    span(ball).forEach((n, k) => assert.ok(Math.abs(n - [300, 200, 240][k]) < 0.01, `Sphere fills its box on axis ${k}`));
    const dome = custom([{ name: '圓頂', shape: 'sphere', axis, hemisphere: 'up', size_mm: [300, 300, 300], center_mm: [0, 0, 150] }], [300, 300, 300]).components[0];
    assertWatertight(dome, `Hemisphere on ${axis}`);
    assert.ok(volume(dome) > 0);
    const turned = custom([{ name: '車腳', shape: 'lathe', role: 'leg', form: 'tapered', axis, size_mm: axis === 'z' ? [60, 60, 400] : axis === 'x' ? [400, 60, 60] : [60, 400, 60], center_mm: [0, 0, axis === 'z' ? 200 : 30], profile_mm: [[18, -200], [30, -120], [22, 0], [26, 150], [0, 200]] }], [60, 60, 400]).components[0];
    assertWatertight(turned, `Lathe on ${axis}`);
    assert.ok(volume(turned) > 0, `Lathe on ${axis} faces outward`);
    assert.ok(planarFaces(turned));
  }
  const legs = [-200, 200].map((x) => ({ name: '車腳', shape: 'lathe', role: 'leg', form: 'tapered', axis: 'z', size_mm: [50, 50, 420], center_mm: [x, 0, 210], profile_mm: [[15, -210], [25, 0], [20, 210]], connects_to: [2] }));
  const stool = custom([...legs, { name: '面', shape: 'lathe', role: 'seat', form: 'panel', axis: 'z', size_mm: [500, 500, 30], center_mm: [0, 0, 435], profile_mm: [[250, -15], [250, 15]], connects_to: [0, 1] }], [500, 500, 450]);
  const stoolErrors = s.validateFurnitureStructure(stool, { leg_count: 2, part_counts: { leg: 2, top: 0, seat: 1, back: 0, arm: 0, frame: 0, body: 0, shelf: 0, other: 0 }, symmetric: true, uncertainties: [] });
  assert.ok(!stoolErrors.some(n => n.includes('未表達')), `A lathe expresses a tapered leg: ${stoolErrors}`);
  const fitted = p.fitCustomPartsWithConstraints(p.sanitizeCustomParts([{ ...legs[0], connects_to: [] }]), 80, 50, 500);
  assert.ok(p.customPartsSize(fitted.parts).every((n, i) => Math.abs(n - [80, 50, 500][i]) <= 1), 'A lathe resizes like a box (oval when widened)');
  assert.throws(() => p.sanitizeCustomParts([{ ...legs[0], connects_to: [], profile_mm: [[15, -210], [0, 0], [20, 210]] }]), /旋轉輪廓/, 'A zero radius in the middle would split the solid');
  assert.throws(() => p.sanitizeCustomParts([{ ...legs[0], connects_to: [], profile_mm: [[15, 0], [25, 0]] }]), /旋轉輪廓/, 'Offsets must increase');
}

{ // 11. Flat oval, angle iron and U channel tubes.
  for (const section of ['oval', 'angle', 'channel']) {
    const tube = { name: section, shape: 'sweep', size_mm: [60, 30, 600], center_mm: [0, 0, 300], path_mm: [[0, 0, -300], [0, 0, 100], [100, 0, 300]], section, section_mm: [60, 30], section_thickness_mm: 4 };
    const mesh = custom([tube], [200, 60, 600]).components[0];
    assertWatertight(mesh, `${section} sweep`);
    assert.ok(volume(mesh) > 0, `${section} sweep faces outward`);
    const cap = mesh.faces_mm[0];
    assert.equal(cap.length, { oval: cap.length, angle: 6, channel: 8 }[section], `${section} cap outline`);
  }
  const tray = custom([{ name: '線槽', shape: 'sweep', size_mm: [1000, 200, 100], center_mm: [0, 0, 50], path_mm: [[-500, 0, 0], [500, 0, 0]], section: 'channel', section_mm: [100, 200], section_thickness_mm: 3 }], [1000, 200, 100]).components[0];
  const trayPoints = tray.faces_mm.flat();
  const top = Math.max(...trayPoints.map((q) => q[2]));
  assert.ok(Math.abs(top - Math.min(...trayPoints.map((q) => q[2])) - 100) < 0.01, 'The first section value is the height of a horizontal sweep');
  assert.ok(trayPoints.filter((q) => Math.abs(q[2] - top) < 0.01).every((q) => Math.abs(q[1]) >= 97 - 0.01), 'A horizontal channel opens upward');
  assert.throws(() => p.sanitizeCustomParts([{ name: '槽', shape: 'sweep', size_mm: [30, 30, 400], center_mm: [0, 0, 200], path_mm: [[0, 0, -200], [0, 0, 200]], section: 'channel', section_mm: [30, 30], section_thickness_mm: 12 }]), 'A channel wall too thick to leave an opening is rejected');
}

console.log('PASS: structural counts, uncertainty, symmetry, contact, grounding, exact template matching, watertight slanted/bent/tapered solids, scaling, GLB/FBX and unchanged SKP writer vertices');

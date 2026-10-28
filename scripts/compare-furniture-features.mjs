// Before/after comparison of the modelling features on four real catalogue products.
// "Before" for the sofa and the conference table is the part list the AI actually saved
// (furniture_models, engine fds-parametric-2/3); for the chair and the cabinet it is what the
// old engine could express (axis-aligned boxes and cylinders only). Renders shaded isometric
// PNGs with node-canvas: node scripts/compare-furniture-features.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { createRequire } from 'node:module';
import { createCanvas } from 'canvas';

const require = createRequire(import.meta.url);
function load(file, deps = {}) {
  const c = { exports: {}, require: (name) => deps[name] ?? require(name), Blob, TextEncoder, ArrayBuffer, DataView, Uint8Array, Float32Array, Uint16Array, Uint32Array };
  vm.createContext(c);
  vm.runInContext(ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, c);
  return c.exports;
}
const p = load('../src/lib/furnitureParametric.ts');
const s = load('../src/lib/furnitureStructure.ts', { './furnitureParametric': p, three: THREE });
const outDir = process.argv[2] ?? path.join(os.tmpdir(), 'fds-modelling-compare');
fs.mkdirSync(outDir, { recursive: true });

const ROLES = ['leg', 'top', 'seat', 'back', 'arm', 'frame', 'body', 'shelf', 'other'];
/** Evidence that matches the part list, so only geometry problems remain. */
function evidenceFor(specs, legs, extra = {}) {
  const part_counts = Object.fromEntries(ROLES.map((r) => [r, specs.filter((x) => (x.role ?? 'other') === r).length]));
  return { leg_count: legs, part_counts, symmetric: true, uncertainties: [], ...extra };
}

// ---- 1. 梳化：雅緻格調單人沙發 Classic Tufted Armchair (02znvwm6xe6j) ----
const sofaBefore = [
  { form: 'tapered', name: '前左腳', role: 'leg', shape: 'box', size_mm: [60, 60, 140], center_mm: [-440, 360, 70], connects_to: [4] },
  { form: 'tapered', name: '前右腳', role: 'leg', shape: 'box', size_mm: [60, 60, 140], center_mm: [440, 360, 70], connects_to: [4] },
  { form: 'tapered', name: '後左腳', role: 'leg', shape: 'box', size_mm: [60, 60, 140], center_mm: [-440, -360, 70], connects_to: [4] },
  { form: 'tapered', name: '後右腳', role: 'leg', shape: 'box', size_mm: [60, 60, 140], center_mm: [440, -360, 70], connects_to: [4] },
  { form: 'panel', name: '底座', role: 'frame', shape: 'box', size_mm: [1040, 920, 90], center_mm: [0, 0, 185], connects_to: [0, 1, 2, 3, 5, 6, 7, 8] },
  { form: 'straight', name: '左扶手', role: 'arm', shape: 'box', size_mm: [200, 900, 370], center_mm: [-420, 10, 415], connects_to: [4, 7, 8] },
  { form: 'straight', name: '右扶手', role: 'arm', shape: 'box', size_mm: [200, 900, 370], center_mm: [420, 10, 415], connects_to: [4, 7, 8] },
  { form: 'panel', name: '背框', role: 'frame', shape: 'box', size_mm: [860, 160, 500], center_mm: [0, -370, 480], connects_to: [4, 5, 6, 9] },
  { form: 'panel', name: '座墊', role: 'seat', shape: 'box', size_mm: [640, 600, 160], center_mm: [0, 150, 310], connects_to: [4, 5, 6, 9] },
  { form: 'panel', name: '靠墊', role: 'back', shape: 'box', size_mm: [620, 200, 460], center_mm: [0, -200, 560], connects_to: [7, 8] },
];
const leather = { material: 'leather', color: '#7a5640' };
const paintedLeg = { material: 'metal', color: '#2a2a2a' };
const sofaAfter = [
  // 金屬烤漆錐腳：一件車削輪廓，左右對稱展開
  { form: 'tapered', name: '前腳', role: 'leg', shape: 'lathe', axis: 'z', size_mm: [44, 44, 140], center_mm: [-440, 360, 70], profile_mm: [[12, -70], [22, 70]], mirror: 'x', connects_to: [2], ...paintedLeg },
  { form: 'tapered', name: '後腳', role: 'leg', shape: 'lathe', axis: 'z', size_mm: [44, 44, 140], center_mm: [-440, -360, 70], profile_mm: [[12, -70], [22, 70]], mirror: 'x', connects_to: [2], ...paintedLeg },
  { form: 'panel', name: '底座', role: 'frame', shape: 'box', size_mm: [1040, 920, 90], center_mm: [0, 0, 185], radius_mm: 20, connects_to: [0, 1, 3, 4, 5], ...leather },
  { form: 'straight', name: '扶手', role: 'arm', shape: 'box', size_mm: [200, 900, 370], center_mm: [-420, 10, 415], radius_mm: 60, bulge_mm: 25, mirror: 'x', connects_to: [2, 4, 5], ...leather },
  { form: 'panel', name: '背框', role: 'frame', shape: 'box', size_mm: [860, 160, 500], center_mm: [0, -370, 480], radius_mm: 50, connects_to: [2, 3, 6], ...leather },
  { form: 'panel', name: '座墊', role: 'seat', shape: 'box', size_mm: [640, 600, 130], center_mm: [0, 150, 295], radius_mm: 40, bulge_mm: 30, connects_to: [2, 3, 6], ...leather },
  { form: 'panel', name: '靠墊', role: 'back', shape: 'box', size_mm: [620, 180, 440], center_mm: [0, -200, 560], radius_mm: 50, bulge_mm: 35, rotation_deg: [-8, 0, 0], connects_to: [4, 5], ...leather },
];
const sofaSaved = { leg_count: 4, symmetric: true, uncertainties: [], part_counts: { arm: 2, leg: 4, top: 0, back: 1, body: 0, seat: 1, frame: 2, other: 0, shelf: 0 } };

// ---- 2. 辦公椅：現代藍色網背帶腰托員工椅 Modern Mesh Staff Chair (lzjxovys06, 590×610×1000) ----
const chairBefore = [
  { name: '十字腳 左右', role: 'leg', form: 'straight', shape: 'box', size_mm: [590, 50, 40], center_mm: [0, 0, 75], connects_to: [2, 3] },
  { name: '十字腳 前後', role: 'leg', form: 'straight', shape: 'box', size_mm: [50, 590, 40], center_mm: [0, 0, 75], connects_to: [2, 3] },
  { name: '氣桿', role: 'frame', form: 'straight', shape: 'cylinder', axis: 'z', size_mm: [60, 60, 330], center_mm: [0, 0, 260], connects_to: [0, 1, 4] },
  { name: '輪', role: 'other', form: 'straight', shape: 'cylinder', axis: 'y', size_mm: [55, 30, 55], center_mm: [0, 0, 27.5], repeat: undefined, connects_to: [0, 1] },
  { name: '座墊', role: 'seat', form: 'panel', shape: 'box', size_mm: [510, 500, 80], center_mm: [0, 40, 465], connects_to: [2, 5] },
  { name: '網背', role: 'back', form: 'panel', shape: 'box', size_mm: [470, 40, 480], center_mm: [0, -230, 745], connects_to: [4] },
];
const chairBeforeEvidence = evidenceFor(p.sanitizeCustomParts(chairBefore), 2);
const star = [0, 72, 144, 216, 288].map((deg, i) => {
  const a = (deg * Math.PI) / 180;
  return { name: `星腳 ${i + 1}`, role: 'leg', form: 'slanted', shape: 'box', size_mm: [300, 45, 30], center_mm: [Math.round(Math.sin(a) * 150), Math.round(Math.cos(a) * 150), 75], rotation_deg: [0, 0, -deg + 90], connects_to: [5], material: 'plastic', color: '#1f1f1f' };
});
const casters = [0, 72, 144, 216, 288].map((deg, i) => {
  const a = (deg * Math.PI) / 180;
  return { name: `輪 ${i + 1}`, role: 'other', form: 'straight', shape: 'sphere', axis: 'z', size_mm: [60, 60, 60], center_mm: [Math.round(Math.sin(a) * 285), Math.round(Math.cos(a) * 285), 33], connects_to: [i], material: 'plastic', color: '#111111' };
});
const chairAfter = [
  ...star,
  { name: '氣桿', role: 'frame', form: 'tapered', shape: 'lathe', axis: 'z', size_mm: [70, 70, 330], center_mm: [0, 0, 255], profile_mm: [[35, -165], [26, -100], [26, 60], [20, 70], [20, 165]], connects_to: [0, 1, 2, 3, 4, 11], material: 'metal', color: '#9aa0a6' },
  ...casters,
  { name: '座墊', role: 'seat', form: 'panel', shape: 'box', size_mm: [510, 500, 80], center_mm: [0, 40, 460], radius_mm: 30, bulge_mm: 20, connects_to: [5, 12, 13], material: 'fabric', color: '#2f4f7f' },
  { name: '網背框', role: 'frame', form: 'panel', shape: 'profile', axis: 'y', size_mm: [470, 30, 500], center_mm: [0, -215, 745], rotation_deg: [10, 0, 0], points_mm: [[-235, -250], [235, -250], [235, 250], [-235, 250]], holes_mm: [[[-205, -220], [205, -220], [205, 220], [-205, 220]]], connects_to: [11, 13], material: 'plastic', color: '#1f1f1f' },
  { name: '網背', role: 'back', form: 'panel', shape: 'box', size_mm: [420, 8, 450], center_mm: [0, -215, 745], rotation_deg: [10, 0, 0], connects_to: [12], material: 'mesh', color: '#28456e' },
  { name: '腰托', role: 'back', form: 'panel', shape: 'box', size_mm: [380, 40, 90], center_mm: [0, -175, 640], radius_mm: 15, bulge_mm: 10, connects_to: [12, 13], material: 'fabric', color: '#2f4f7f' },
];

// ---- 3. 辦公枱：現代淺木色帶線盒會議枱 (7ay39iwj03l, 3200×1390×775) ----
const deskLegs = (side) => ({ axis: 'y', form: 'bent', role: 'leg', shape: 'profile', size_mm: [480, 800, 727.5], center_mm: [side * 1150, 0, 363.7], points_mm: [[160, 363.8], [240, 363.8], [-160, -84.7], [-160, -363.7], [-240, -363.7], [-240, -74.7]].map(([a, b]) => [side * -a, b]) });
const deskBefore = [
  { form: 'panel', name: '桌面板', role: 'top', shape: 'box', size_mm: [3200, 1390, 45], center_mm: [0, 0, 750], connects_to: [1, 2, 3, 4] },
  { form: 'panel', name: '中央線槽盒蓋', role: 'other', shape: 'box', size_mm: [1600, 200, 15], center_mm: [0, 0, 767.5], connects_to: [0] },
  { form: 'straight', name: '中央底部縱向縱樑', role: 'frame', shape: 'box', size_mm: [1500, 100, 80], center_mm: [0, 0, 687.5], connects_to: [0, 3, 4] },
  { ...deskLegs(-1), name: '左側折角支撐腿', connects_to: [0, 2] },
  { ...deskLegs(1), name: '右側折角支撐腿', connects_to: [0, 2] },
];
const deskSaved = { leg_count: 2, symmetric: true, uncertainties: [], part_counts: { arm: 0, leg: 2, top: 1, back: 0, body: 0, seat: 0, frame: 1, other: 1, shelf: 0 } };
const wood = { material: 'wood', color: '#d9bf93' };
const deskAfter = [
  // 桌面開出線盒孔，盒蓋嵌入孔內與面齊平
  { form: 'panel', name: '桌面板', role: 'top', shape: 'profile', axis: 'z', size_mm: [3200, 1390, 45], center_mm: [0, 0, 750], points_mm: [[-1600, -695], [1600, -695], [1600, 695], [-1600, 695]], holes_mm: [[[-800, -100], [800, -100], [800, 100], [-800, 100]]], connects_to: [1, 2, 3, 4], ...wood },
  { form: 'panel', name: '中央線槽盒蓋', role: 'other', shape: 'box', size_mm: [1600, 200, 12], center_mm: [0, 0, 765.5], connects_to: [0], material: 'metal', color: '#c9ccd0' },
  { form: 'straight', name: '中央線槽', role: 'frame', shape: 'sweep', size_mm: [1500, 200, 100], center_mm: [0, 0, 677.5], path_mm: [[-750, 0, 0], [750, 0, 0]], section: 'channel', section_mm: [100, 200], section_thickness_mm: 2, connects_to: [0, 1, 3, 4], material: 'metal', color: '#3a3a3a' },
  { ...deskLegs(-1), name: '左側折角支撐腿', connects_to: [0, 2], material: 'metal', color: '#2b2b2b' },
  { ...deskLegs(1), name: '右側折角支撐腿', connects_to: [0, 2], material: 'metal', color: '#2b2b2b' },
];

// ---- 4. 儲物櫃：XYH-H932 文件櫃，鋁框玻璃門 (xgmkujzkxfb, 2800×400×2000) ----
const melamine = { material: 'wood', color: '#e7e1d6' };
const cabinetBefore = [
  { name: '左側板', role: 'body', form: 'panel', shape: 'box', size_mm: [25, 400, 2000], center_mm: [-1387.5, 0, 1000], connects_to: [2, 3, 4] },
  { name: '右側板', role: 'body', form: 'panel', shape: 'box', size_mm: [25, 400, 2000], center_mm: [1387.5, 0, 1000], connects_to: [2, 3, 4] },
  { name: '頂板', role: 'top', form: 'panel', shape: 'box', size_mm: [2750, 400, 25], center_mm: [0, 0, 1987.5], connects_to: [0, 1, 4] },
  { name: '底板', role: 'shelf', form: 'panel', shape: 'box', size_mm: [2750, 400, 25], center_mm: [0, 0, 62.5], connects_to: [0, 1, 4] },
  { name: '背板', role: 'body', form: 'panel', shape: 'box', size_mm: [2750, 18, 1900], center_mm: [0, -191, 1025], connects_to: [0, 1, 2, 3] },
  ...[0, 1, 2, 3].map((n) => ({ name: `門 ${n + 1}`, role: 'body', form: 'panel', shape: 'box', size_mm: [680, 20, 1950], center_mm: [-1035 + n * 690, 210, 1012.5], connects_to: [2, 3] })),
];
const cabinetAfter = [
  { name: '側板', role: 'body', form: 'panel', shape: 'box', size_mm: [25, 400, 2000], center_mm: [-1387.5, 0, 1000], mirror: 'x', connects_to: [1, 2, 3], ...melamine },
  { name: '頂板', role: 'top', form: 'panel', shape: 'box', size_mm: [2750, 400, 25], center_mm: [0, 0, 1987.5], connects_to: [0, 3], ...melamine },
  { name: '底板', role: 'shelf', form: 'panel', shape: 'box', size_mm: [2750, 400, 25], center_mm: [0, 0, 62.5], connects_to: [0, 3], ...melamine },
  { name: '背板', role: 'body', form: 'panel', shape: 'box', size_mm: [2750, 18, 1900], center_mm: [0, -191, 1025], connects_to: [0, 1, 2], ...melamine },
  { name: '層板', role: 'shelf', form: 'panel', shape: 'box', size_mm: [2750, 370, 18], center_mm: [0, 0, 500], repeat: { count: 3, step_mm: [0, 0, 480] }, connects_to: [0, 3], ...melamine },
  // 鋁框＝帶孔輪廓（內環是玻璃位置），玻璃＝半透明面板；兩者各重複 4 門
  { name: '鋁門框', role: 'body', form: 'panel', shape: 'profile', axis: 'y', size_mm: [680, 22, 1950], center_mm: [-1035, 211, 1012.5], points_mm: [[-340, -975], [340, -975], [340, 975], [-340, 975]], holes_mm: [[[-310, -945], [310, -945], [310, 945], [-310, 945]]], repeat: { count: 4, step_mm: [690, 0, 0] }, connects_to: [1, 2], material: 'metal', color: '#b8bcc2' },
  { name: '玻璃', role: 'body', form: 'panel', shape: 'box', size_mm: [624, 6, 1894], center_mm: [-1035, 211, 1012.5], repeat: { count: 4, step_mm: [690, 0, 0] }, connects_to: [5], material: 'glass' },
  { name: '拉手', role: 'other', form: 'straight', shape: 'sweep', size_mm: [14, 14, 300], center_mm: [-725, 229, 1020], path_mm: [[0, 0, -150], [0, 0, 150]], section: 'oval', section_mm: [14, 10], repeat: { count: 4, step_mm: [690, 0, 0] }, connects_to: [5], material: 'metal', color: '#8d9399' },
];

const products = [
  { key: 'sofa', title: '梳化｜雅緻格調單人沙發 Classic Tufted Armchair', size: [1040, 920, 790], before: sofaBefore, after: sofaAfter, evidence: { before: sofaSaved, after: sofaSaved } },
  { key: 'chair', title: '辦公椅｜現代藍色網背帶腰托員工椅 Modern Mesh Staff Chair', size: [590, 610, 1000], before: chairBefore, after: chairAfter, evidence: { before: chairBeforeEvidence } },
  { key: 'desk', title: '辦公枱｜現代淺木色帶線盒會議枱 Conference Table', size: [3200, 1390, 775], before: deskBefore, after: deskAfter, evidence: { before: deskSaved, after: deskSaved } },
  { key: 'cabinet', title: '儲物櫃｜XYH-H932 鋁框玻璃門文件櫃', size: [2800, 400, 2000], before: cabinetBefore, after: cabinetAfter, evidence: {} },
];

function render(model, ctx, ox, oy, w, h) {
  const az = (-35 * Math.PI) / 180, el = (25 * Math.PI) / 180;
  const view = [Math.sin(-az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  const right = [Math.cos(az), Math.sin(az), 0];
  const up = [-view[0] * view[2], -view[1] * view[2], Math.cos(el) ** 2].map((n) => n / Math.cos(el));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const light = (() => { const l = [0.4, 0.8, 1]; const n = Math.hypot(...l); return l.map((x) => x / n); })();
  const tris = [];
  for (const part of model.components) {
    const look = p.partAppearance(part);
    const rgb = [1, 3, 5].map((i) => parseInt(look.color.slice(i, i + 2), 16));
    for (const poly of p.partPolygons(part)) {
      if (dot(poly.normal, view) <= 0 && look.opacity >= 1) continue;
      const shade = 0.45 + 0.55 * Math.abs(dot(poly.normal, light));
      const color = rgb.map((c) => Math.round(c * shade));
      for (const t of poly.triangles) tris.push({ pts: t.map((i) => poly.points[i]), color, alpha: look.opacity });
    }
  }
  const all = tris.flatMap((t) => t.pts);
  const xs = all.map((q) => dot(q, right)), ys = all.map((q) => dot(q, up));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((w - 40) / (maxX - minX), (h - 60) / (maxY - minY));
  const padX = 20 + (w - 40 - (maxX - minX) * scale) / 2;
  const toScreen = (q) => [padX + (dot(q, right) - minX) * scale, h - 20 - (dot(q, up) - minY) * scale, dot(q, view)];
  // Depth buffer: a lid flush inside a hole or a leg under a long top cannot be ordered per triangle.
  const image = ctx.getImageData(ox, oy, w, h);
  const depth = new Float32Array(w * h).fill(-Infinity);
  const raster = (t, write) => {
    const [a, b, c] = t.pts.map(toScreen);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const u = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
      const v = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
      const s3 = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || s3 < -1e-6) continue;
      const z = u * a[2] + v * b[2] + s3 * c[2];
      const k = y * w + x;
      if (z <= depth[k] + 0.5) continue;
      if (write) depth[k] = z;
      for (let ch = 0; ch < 3; ch++) image.data[k * 4 + ch] = Math.round(image.data[k * 4 + ch] * (1 - t.alpha) + t.color[ch] * t.alpha);
    }
  };
  tris.filter((t) => t.alpha >= 1).forEach((t) => raster(t, true));
  const meanDepth = (t) => t.pts.reduce((sum, q) => sum + dot(q, view), 0) / 3;
  tris.filter((t) => t.alpha < 1).sort((a, b) => meanDepth(a) - meanDepth(b)).forEach((t) => raster(t, false));
  ctx.putImageData(image, ox, oy);
}

const report = [];
for (const product of products) {
  const W = 1400, H = 640;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 22px "Microsoft JhengHei"';
  ctx.fillText(product.title, 20, 34);
  const row = { product: product.title };
  for (const [i, side] of ['before', 'after'].entries()) {
    const raw = product[side];
    const specs = p.sanitizeCustomParts(raw);
    const legs = specs.filter((x) => x.role === 'leg').length;
    const [width_mm, depth_mm, height_mm] = p.customPartsSize(specs);
    const model = p.buildParametric({ kind: 'custom', width_mm, depth_mm, height_mm, parts: specs });
    const evidence = product.evidence[side] ?? evidenceFor(specs, legs);
    const errors = s.validateFurnitureStructure(model, evidence);
    const triangles = model.components.reduce((sum, part) => sum + p.partPolygons(part).reduce((n, poly) => n + poly.triangles.length, 0), 0);
    const holes = model.components.reduce((sum, part) => sum + (part.face_holes_mm ?? []).reduce((n, hs) => n + hs.length, 0), 0) / 2;
    const materials = [...new Set(model.components.map((part) => p.partAppearance(part).material ?? '未設定'))];
    row[side] = { entries: raw.length, solids: model.components.length, size_mm: [width_mm, depth_mm, height_mm].map(Math.round), triangles, holes, materials, errors, engine: model.engine_version };
    render(model, ctx, i * (W / 2), 50, W / 2, H - 90);
    ctx.fillStyle = '#333';
    ctx.font = '18px "Microsoft JhengHei"';
    ctx.fillText(`${side === 'before' ? '舊（只能用方塊／圓柱）' : '新（' + model.engine_version + '）'}  ${raw.length} 項 → ${model.components.length} 件`, i * (W / 2) + 20, H - 16);
  }
  const file = path.join(outDir, `${product.key}.png`);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  row.image = file;
  report.push(row);
}
console.log(JSON.stringify(report, null, 2));

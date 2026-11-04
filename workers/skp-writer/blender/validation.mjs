import { inspectFbx, inspectGlb, inspectPng } from '../codex/artifacts.mjs';

export function orientationGaps(report, references, entries) {
  const gaps = [];
  if (!Array.isArray(report?.reference_analysis) || report.reference_analysis.length !== references.length) gaps.push('參考圖片分析數量不符');
  if (!report?.unit_plan?.instances?.length) gaps.push('缺少單元組合報告');
  if (report?.orientation_review?.passed !== true) gaps.push('方向檢查未通過');
  if (!Array.isArray(report?.orientation_review?.unresolved) || report.orientation_review.unresolved.length) gaps.push('方向檢查仍有未解決問題');
  const lastRun = entries.findLastIndex((e) => e.tool === 'run_blender');
  if (lastRun < 0 || !entries[lastRun].ok) gaps.push('最後一次 Blender 執行未成功');
  const seen = new Set(entries.slice(lastRun + 1).filter((e) => e.ok && e.tool === 'screenshot').map((e) => e.view));
  for (const view of ['iso', 'front', 'side', 'top']) if (!seen.has(view)) gaps.push(`缺少最新 Blender ${view} 視角檢查`);
  return gaps;
}

export function validateBlender({ snapshot, info, report, glbBytes, fbxBytes, previewBytes }) {
  const glb = inspectGlb(glbBytes);
  inspectFbx(fbxBytes);
  const png = inspectPng(previewBytes);
  const checks = [];
  const add = (name, ok, detail, severity = 'error') => checks.push({ name, ok: !!ok, detail, severity });
  const within = (a, b, abs = 5, rel = 0.01) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= Math.max(abs, Math.abs(b)*rel);
  add('glb_self_contained', !glb.external.length, `${glb.external.length} external resources`);
  add('preview_image', png.width >= 800 && png.height >= 600, `${png.width}×${png.height}`);
  const box = info.bounds_mm;
  const measured = { width: box.size[0], depth: box.size[1], height: box.size[2] };
  const dimensions = {};
  for (const axis of ['width', 'depth', 'height']) {
    const expected = Number(snapshot.catalog_dimensions_mm?.[axis]);
    const actual = measured[axis];
    const ok = actual > 0 && (!expected || within(actual, expected));
    dimensions[axis] = { source: expected > 0 ? 'catalog' : 'estimated', actual_mm: actual, expected_mm: expected > 0 ? expected : null, ok };
    add(`dimension_${axis}`, ok, `${actual.toFixed(2)} mm, catalog ${expected || 'unknown'}`);
  }
  const g = glb.bounds.size.map((n) => n * 1000);
  add('glb_matches_blender', [0,1,2].every((i) => within(g[i], box.size[[0,2,1][i]], 2, 0.005)), `GLB ${g.join(' × ')} mm (X width, Y height, Z depth)`);
  add('floor_at_zero', Math.abs(box.min[2]) <= 1, `min z ${box.min[2]} mm`);
  add('glb_floor', within(glb.bounds.min[1]*1000, box.min[2], 2, 0.005), `GLB floor ${glb.bounds.min[1]*1000} mm`);
  add('centered', [0,1].every((i) => Math.abs((box.min[i]+box.max[i])/2) <= 5), 'XY center ±5 mm', 'warning');
  const parts = info.parts ?? [];
  add('editable_parts', parts.length > 0 && parts.every((p) => p.faces > 0), `${parts.length} named mesh parts`);
  const names = new Set(parts.map((p) => p.name));
  const planned = report.parts ?? [];
  add('reported_parts', planned.length > 0 && planned.every((p) => names.has(p.name)), 'reported mesh names must exist');
  for (const [i, rule] of (report.semantic_checks ?? []).entries()) {
    const match = (s) => typeof s === 'string' && s.length ? parts.filter((p) => p.name.includes(s)) : [];
    if (rule.check === 'count') add(`semantic_${i}`, match(rule.name_contains).length === rule.expected, `count ${rule.name_contains}: expected ${rule.expected}`);
    else if (['front_of', 'above'].includes(rule.check)) {
      const a = match(rule.a), b = match(rule.b), axis = rule.check === 'above' ? 2 : 1;
      const avg = (ps) => ps.reduce((n,p) => n+(p.bounds_mm.min[axis]+p.bounds_mm.max[axis])/2,0)/ps.length;
      add(`semantic_${i}`, a.length && b.length && (axis === 2 ? avg(a)>avg(b) : avg(a)<avg(b)), `${rule.a} ${rule.check} ${rule.b}`);
    } else add(`semantic_${i}`, false, `unknown check ${rule.check ?? '(missing check)'}`);
  }
  add('materials', info.materials > 0, `${info.materials} material slots`, 'warning');
  if (info.textured_materials > 0) add('glb_textures', glb.images > 0, `${glb.images} embedded images`);
  return { ok: checks.every((c) => c.ok || c.severity !== 'error'), checks, dimensions, model_bounds_mm: box, tools: { engine: 'blender', blender: info.blender_version }, estimated_fields: report.estimated_fields ?? [], conflicts: report.conflicts ?? [] };
}

import { Box3, Ray, Triangle, Vector3 } from 'three';
import { buildParametric, fitCustomParts, sanitizeCustomParts, triangulateFace, type CustomPartSpec, type FurnitureKind, type ModelPart, type ModelStyle, type ParametricModel } from './furnitureParametric';

export interface StructureEvidence {
  leg_count: number;
  product_count?: number;
  part_counts: Record<string, number>;
  symmetric: boolean;
  uncertainties: string[];
  /** How a person handled each AI uncertainty; matched by its text. */
  resolved?: UncertaintyResolution[];
}

/**
 * `estimate`: keep the AI reading as an estimate; the model can only be an estimate draft.
 * `checked`: a person compared the photos (or corrected the parts) and wrote what they checked.
 */
export interface UncertaintyResolution {
  text: string;
  decision: 'estimate' | 'checked';
  note?: string;
  by?: string;
  at: string;
}

export const STRUCTURE_PENDING_PREFIX = '結構待確認：';

export function unresolvedUncertainties(evidence: StructureEvidence | undefined): string[] {
  if (!evidence) return [];
  const done = new Set((evidence.resolved ?? []).map((r) => r.text));
  return evidence.uncertainties.filter((text) => !done.has(text));
}

/** Uncertainties kept as estimates; they stop the version from passing formal acceptance. */
export function estimatedUncertainties(evidence: StructureEvidence | undefined): string[] {
  if (!evidence) return [];
  return (evidence.resolved ?? [])
    .filter((r) => r.decision === 'estimate' && evidence.uncertainties.includes(r.text))
    .map((r) => r.text);
}

export function resolveUncertainty(
  evidence: StructureEvidence,
  text: string,
  decision: UncertaintyResolution['decision'],
  note: string | undefined,
  by: string | undefined,
): StructureEvidence {
  const rest = (evidence.resolved ?? []).filter((r) => r.text !== text);
  const trimmed = note?.trim();
  return { ...evidence, resolved: [...rest, { text, decision, ...(trimmed ? { note: trimmed } : {}), ...(by ? { by } : {}), at: new Date().toISOString() }] };
}

export function reopenUncertainty(evidence: StructureEvidence, text: string): StructureEvidence {
  return { ...evidence, resolved: (evidence.resolved ?? []).filter((r) => r.text !== text) };
}

/** A new AI reading keeps people's decisions for uncertainties it repeats word for word. */
export function carryResolutions(previous: StructureEvidence | undefined, next: StructureEvidence): StructureEvidence {
  const kept = (previous?.resolved ?? []).filter((r) => next.uncertainties.includes(r.text));
  return kept.length ? { ...next, resolved: kept } : next;
}

function bounds(part: ModelPart): Box3 {
  return new Box3().setFromPoints(part.faces_mm.flat().map(p => new Vector3(...p)));
}

/** Every vertex must match, rather than accepting equal bounding boxes for different shapes. */
function matchingParts(a: ModelPart[], b: ModelPart[]): boolean {
  if (a.length !== b.length) return false;
  const vertices = (p: ModelPart) => [...new Map(p.faces_mm.flat().map(v => [v.map(n => Math.round(n * 10)).join(','), v])).values()];
  const remaining = [...b];
  return a.every(part => {
    const va = vertices(part);
    const index = remaining.findIndex(other => {
      const vb = vertices(other);
      const faces = (p: ModelPart) => p.faces_mm.map(face => face.map(v => v.map(n => Math.round(n * 10)).join(',')).sort().join(';')).sort().join('|');
      return faces(part) === faces(other) && va.length === vb.length && va.every(p => vb.some(q => Math.hypot(...p.map((n, k) => n - q[k])) <= 1));
    });
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}

/** Conservative contact test: surface proximity or a mesh edge crossing a surface. */
function touches(a: ModelPart, b: ModelPart): boolean {
  if (!bounds(a).expandByScalar(3).intersectsBox(bounds(b))) return false;
  const tris = (p: ModelPart) => p.faces_mm.flatMap(face => {
    return triangulateFace(face).map(([a,b,c]) => new Triangle(new Vector3(...face[a]), new Vector3(...face[b]), new Vector3(...face[c])));
  });
  const near = (p: ModelPart, other: Triangle[]) => p.faces_mm.some(face => face.some((v, i) => {
    const start = new Vector3(...v), end = new Vector3(...face[(i + 1) % face.length]);
    const direction = end.clone().sub(start), length = direction.length();
    const ray = new Ray(start, direction.normalize());
    return other.some(tri => {
      if (tri.closestPointToPoint(start, new Vector3()).distanceTo(start) <= 3) return true;
      const hit = ray.intersectTriangle(tri.a, tri.b, tri.c, false, new Vector3());
      return hit !== null && hit.distanceTo(start) <= length + 0.001;
    });
  }));
  return near(a, tris(b)) || near(b, tris(a));
}

export function selectFurnitureGeometry(input: {
  kind: FurnitureKind; width_mm: number; depth_mm: number; height_mm: number;
  style?: Partial<ModelStyle>; parts: unknown;
}): { kind: FurnitureKind; parts: CustomPartSpec[]; templateMatched: boolean } {
  const parts = sanitizeCustomParts(input.parts);
  const custom = buildParametric({ ...input, kind: 'custom', parts: fitCustomParts(parts, input.width_mm, input.depth_mm, input.height_mm) });
  if (input.kind !== 'custom') {
    const template = buildParametric(input);
    if (matchingParts(template.components, custom.components)) return { kind: input.kind, parts, templateMatched: true };
  }
  return { kind: 'custom', parts, templateMatched: false };
}

/** True when a recognition payload carries the structure object generation stores and checks. */
export function hasStructureEvidence(value: unknown): value is StructureEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as StructureEvidence;
  return Number.isInteger(evidence.leg_count)
    && evidence.leg_count >= 0
    && evidence.leg_count <= 20
    && typeof evidence.symmetric === 'boolean'
    && Array.isArray(evidence.uncertainties)
    && evidence.uncertainties.every((item) => typeof item === 'string');
}

/** Block structural contradictions; AI evidence remains visible and is never treated as measurement. */
export function validateFurnitureStructure(model: ParametricModel, evidence: StructureEvidence | undefined, referenceParts?: CustomPartSpec[]): string[] {
  const errors: string[] = [];
  if (!hasStructureEvidence(evidence)) return ['缺少完整的結構辨認資料，請重新辨認部件'];
  errors.push(...unresolvedUncertainties(evidence).map(n => `${STRUCTURE_PENDING_PREFIX}${n}`));
  const specs = model.custom_parts ?? referenceParts ?? model.structure_parts ?? [];
  if (specs.length !== model.components.length || specs.some(p => !p.role || !p.form || !Array.isArray(p.connects_to))) return [...errors, '部件用途、形狀或接合關係不完整，請重新辨認部件'];
  if (evidence.product_count && evidence.product_count > 1 &&
    (specs.some(p => !Number.isInteger(p.product_index) || p.product_index! < 0 || p.product_index! >= evidence.product_count!) || new Set(specs.map(p => p.product_index)).size !== evidence.product_count)) errors.push('模型中的產品件數與確認的整組數量不符');
  const roles = ['leg','top','seat','back','arm','frame','body','shelf','other'];
  if (!evidence.part_counts || roles.some(role => !Number.isInteger(evidence.part_counts[role]) || evidence.part_counts[role] < 0 || evidence.part_counts[role] > 40)) errors.push('缺少完整主要部件數量，請重新辨認部件');
  else for (const role of roles) {
    if (specs.filter(p => p.role === role).length !== evidence.part_counts[role]) errors.push(`主要部件數量不符：${({leg:'腳',top:'桌面',seat:'座面',back:'靠背',arm:'扶手',frame:'框架',body:'主體',shelf:'層板',other:'其他'})[role]}`);
  }
  let geometry = model.components;
  if (model.kind !== 'custom') {
    const custom = buildParametric({ ...model, kind: 'custom', parts: fitCustomParts(specs, model.width_mm, model.depth_mm, model.height_mm) });
    if (!matchingParts(geometry, custom.components)) errors.push('目前模板與已辨認的部件不吻合，請改用自訂部件');
    geometry = custom.components;
  }
  const legs = specs.map((p, i) => p.role === 'leg' ? i : -1).filter(i => i >= 0);
  if (legs.length !== evidence.leg_count) errors.push(`腳數不符：圖片結構為 ${evidence.leg_count} 隻，模型有 ${legs.length} 隻`);
  const boxes = geometry.map(bounds);
  const reached = new Set<number>();
  boxes.forEach((b, i) => { if (b.min.z <= 3 && b.min.z >= -3) reached.add(i); });
  const edges: [number, number][] = [];
  specs.forEach((spec, i) => {
    if (spec.form === 'bent' && spec.shape !== 'profile' && !(spec.shape === 'sweep' && spec.path_mm!.length > 2)) errors.push(`「${spec.name}」彎曲形狀未表達`);
    if ((spec.form === 'slanted' || spec.form === 'tapered') && spec.shape !== 'profile' && spec.shape !== 'sweep') errors.push(`「${spec.name}」斜向或錐形結構未表達`);
    for (const j of spec.connects_to ?? []) {
      if (j >= geometry.length || !touches(geometry[i], geometry[j])) errors.push(`「${spec.name}」與「${specs[j]?.name ?? '未知部件'}」未接合`);
      else edges.push([i, j]);
    }
  });
  for (let pass = 0; pass < specs.length; pass++) for (const [a, b] of edges) {
    if (reached.has(a)) reached.add(b);
    if (reached.has(b)) reached.add(a);
  }
  if (reached.size !== geometry.length) errors.push('存在懸空或沒有接到落地結構的部件，請修正接合關係');
  if (evidence.symmetric) {
    for (const i of legs) {
      const p = geometry[i], box = boxes[i];
      if (!legs.some(j => Math.abs(geometry[j].position_mm[0] + p.position_mm[0]) <= 5 && Math.abs(geometry[j].position_mm[1] - p.position_mm[1]) <= 5 && Math.abs(boxes[j].min.z - box.min.z) <= 3 && Math.abs(boxes[j].max.z - box.max.z) <= 3 &&
        p.faces_mm.flat().every(point => geometry[j].faces_mm.flat().some(other => Math.hypot(point[0]+other[0],point[1]-other[1],point[2]-other[2]) <= 5)))) {
        errors.push('左右腳位置或高度不對稱，與圖片結構不符'); break;
      }
    }
  }
  const extent = new Box3(); boxes.forEach(b => extent.union(b));
  const actual = extent.getSize(new Vector3());
  if ([actual.x, actual.y, actual.z].some((n, i) => Math.abs(n - [model.width_mm, model.depth_mm, model.height_mm][i]) > 5)) errors.push('部件總尺寸與確認尺寸不符');
  return [...new Set(errors)];
}

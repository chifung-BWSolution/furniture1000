export type FurnitureKind = 'desk' | 'conference' | 'shelf' | 'cabinet';
export type SizeAxis = 'width' | 'depth' | 'height';
export type Vec3 = [number, number, number];

/**
 * A simple (possibly concave) outline extruded along one axis, relative to the part center.
 * axis z: points are (x, y); axis y: (x, z); axis x: (y, z). Length = size along the axis.
 */
export interface PartOutline {
  axis: 'x' | 'y' | 'z';
  points_mm: [number, number][];
}

export interface ModelPart {
  id: string;
  name: string;
  /** Bounding width, depth, height in millimetres. */
  size_mm: Vec3;
  /** Center of the bounding box. X/Y are centered on the floor plan; Z is up from the floor. */
  position_mm: Vec3;
  /** Missing = plain box. */
  outline?: PartOutline;
  /** Polygons in model space (mm, Z up), counter-clockwise seen from outside. */
  faces_mm: Vec3[][];
}

export type TopShape = 'rect' | 'boat';
export type LegStyle = 'four' | 'panel';

/** Only desks and conference tables take a style. */
export interface TableStyle {
  top: TopShape;
  legs: LegStyle;
  cable_tray: boolean;
}

export const DEFAULT_TABLE_STYLE: TableStyle = { top: 'rect', legs: 'four', cable_tray: false };

export interface ParametricModel {
  kind: FurnitureKind;
  supported: true;
  label: string;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  estimated_axes: SizeAxis[];
  style?: TableStyle;
  components: ModelPart[];
}

export const FURNITURE_KINDS: { id: FurnitureKind; label: string }[] = [
  { id: 'desk', label: '辦公桌' },
  { id: 'conference', label: '會議桌' },
  { id: 'shelf', label: '書架' },
  { id: 'cabinet', label: '儲物櫃' },
];

const DEFAULTS: Record<FurnitureKind, [number, number, number]> = {
  desk: [1400, 700, 750],
  conference: [2400, 1200, 750],
  shelf: [900, 350, 1800],
  cabinet: [800, 400, 900],
};

const LABEL: Record<FurnitureKind, string> = {
  desk: '辦公桌',
  conference: '會議桌',
  shelf: '書架',
  cabinet: '儲物櫃',
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function axis(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number,
  forceEstimated = false,
): { mm: number; estimated: boolean } {
  if (value == null || !Number.isFinite(value) || value <= 0) return { mm: fallback, estimated: true };
  return { mm: clamp(value, min, max), estimated: forceEstimated };
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
/** Which model axes the outline's two coordinates map to. */
const PLANE: Record<PartOutline['axis'], [number, number]> = { z: [0, 1], y: [0, 2], x: [1, 2] };

function newellNormal(points: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return n;
}

export function faceNormal(points: Vec3[]): Vec3 {
  const n = newellNormal(points);
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/**
 * Ear-clipping triangulation of one planar face (convex or concave).
 * Returns index triples that keep the face's winding.
 */
export function triangulateFace(face: Vec3[]): [number, number, number][] {
  const n = newellNormal(face);
  const drop = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const [a, b] = [0, 1, 2].filter((axis) => axis !== drop);
  // Flip the 2D frame when needed so the face always reads counter-clockwise.
  const flip = n[drop] * (drop === 1 ? -1 : 1) < 0 ? -1 : 1;
  const pts = face.map((p) => [p[a], p[b] * flip] as [number, number]);
  const cross = (o: [number, number], p: [number, number], q: [number, number]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const inside = (p: [number, number], x: [number, number], y: [number, number], z: [number, number]) =>
    cross(x, y, p) >= 0 && cross(y, z, p) >= 0 && cross(z, x, p) >= 0;
  const remaining = face.map((_, i) => i);
  const out: [number, number, number][] = [];
  let guard = remaining.length * remaining.length;
  while (remaining.length > 3 && guard-- > 0) {
    for (let k = 0; k < remaining.length; k += 1) {
      const i = remaining[(k + remaining.length - 1) % remaining.length];
      const j = remaining[k];
      const l = remaining[(k + 1) % remaining.length];
      if (cross(pts[i], pts[j], pts[l]) <= 0) continue;
      const blocked = remaining.some((m) => m !== i && m !== j && m !== l && inside(pts[m], pts[i], pts[j], pts[l]));
      if (blocked) continue;
      out.push([i, j, l]);
      remaining.splice(k, 1);
      break;
    }
  }
  if (remaining.length === 3) out.push([remaining[0], remaining[1], remaining[2]]);
  return out;
}

/** Caps and side walls of a prism, each wound counter-clockwise seen from outside. */
export function partFaces(p: Pick<ModelPart, 'size_mm' | 'position_mm' | 'outline'>): Vec3[][] {
  const [w, d, h] = p.size_mm;
  const outline: PartOutline = p.outline ?? {
    axis: 'z',
    points_mm: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]],
  };
  const along = AXIS_INDEX[outline.axis];
  const [u, v] = PLANE[outline.axis];
  const half = p.size_mm[along] / 2;
  const at = (pt: [number, number], offset: number): Vec3 => {
    const out: Vec3 = [...p.position_mm];
    out[u] += pt[0];
    out[v] += pt[1];
    out[along] += offset;
    return out;
  };
  let ring = outline.points_mm;
  if (newellNormal(ring.map((pt) => at(pt, 0)))[along] < 0) ring = [...ring].reverse();
  const top = ring.map((pt) => at(pt, half));
  const bottom = ring.map((pt) => at(pt, -half));
  const faces: Vec3[][] = [top, [...bottom].reverse()];
  for (let i = 0; i < ring.length; i += 1) {
    const j = (i + 1) % ring.length;
    faces.push([bottom[i], bottom[j], top[j], top[i]]);
  }
  return faces;
}

/** 0.1 mm keeps half-millimetre centres exact, so parts still meet the floor and each other. */
const round = (n: number) => Math.round(n * 10) / 10;

function part(
  id: string,
  name: string,
  size: Vec3,
  position: Vec3,
  outline?: PartOutline,
): ModelPart {
  const base = {
    id,
    name,
    size_mm: size.map(round) as Vec3,
    position_mm: position.map(round) as Vec3,
    ...(outline ? { outline: { axis: outline.axis, points_mm: outline.points_mm.map(([a, b]) => [round(a), round(b)] as [number, number]) } } : {}),
  };
  return { ...base, faces_mm: partFaces(base) };
}

function legs(w: number, d: number, h: number, topT: number, leg: number, inset: number): ModelPart[] {
  const legH = h - topT;
  const x = w / 2 - inset - leg / 2;
  const y = d / 2 - inset - leg / 2;
  return [
    [-x, -y],
    [x, -y],
    [-x, y],
    [x, y],
  ].map(([px, py], index) => part(`leg-${index + 1}`, `桌腳 ${index + 1}`, [leg, leg, legH], [px, py, legH / 2]));
}

/** Boat top: full depth at the middle, narrower at both ends. */
const BOAT_END_RATIO = 0.72;

/**
 * Folded panel leg, seen from the front: it rises straight from the floor, bends at about
 * 58% of its height, and the upper part leans in toward the middle to meet the top.
 */
function panelLegs(w: number, d: number, h: number, topT: number, endDepth: number): ModelPart[] {
  const legH = h - topT;
  const thick = 80;
  const bendZ = legH * 0.58;
  const lean = Math.min(legH * 0.4, w * 0.12);
  const span = Math.min(d, endDepth) * 0.78;
  const footInset = Math.max(150, w * 0.1);
  const boxW = thick + lean;
  return [-1, 1].map((side, index) => {
    // Local x runs from the foot's outer face (0) toward the table centre; z from the floor.
    const profile: [number, number][] = [
      [0, 0], [thick, 0], [thick, bendZ], [thick + lean, legH], [lean, legH], [0, bendZ],
    ];
    const outerX = side * (w / 2 - footInset);
    const centerX = outerX - side * (boxW / 2);
    const points = profile.map(([x, z]) => [
      outerX - side * x - centerX,
      z - legH / 2,
    ] as [number, number]);
    return part(
      `leg-${index + 1}`,
      `折板腳 ${index === 0 ? '左' : '右'}`,
      [boxW, span, legH],
      [centerX, 0, legH / 2],
      { axis: 'y', points_mm: points },
    );
  });
}

function tableComponents(kind: 'desk' | 'conference', w: number, d: number, h: number, style: TableStyle): ModelPart[] {
  const boat = style.top === 'boat';
  const topT = boat ? 40 : 25;
  const endDepth = boat ? d * BOAT_END_RATIO : d;
  const top = boat
    ? part('top', '桌面', [w, d, topT], [0, 0, h - topT / 2], {
        axis: 'z',
        points_mm: [
          [-w / 2, -endDepth / 2], [0, -d / 2], [w / 2, -endDepth / 2],
          [w / 2, endDepth / 2], [0, d / 2], [-w / 2, endDepth / 2],
        ],
      })
    : part('top', '桌面', [w, d, topT], [0, 0, h - topT / 2]);
  const out = [top];
  if (style.legs === 'panel') {
    out.push(...panelLegs(w, d, h, topT, endDepth));
  } else {
    const leg = kind === 'conference' ? 60 : 40;
    const inset = kind === 'conference' ? 80 : 50;
    out.push(...legs(w, endDepth, h, topT, leg, inset));
    if (kind === 'conference') out.push(part('beam', '橫樑', [w - inset * 2, 40, 40], [0, 0, 140]));
  }
  if (style.cable_tray) {
    const length = w * 0.5;
    out.push(
      part('tray', '走線槽', [length, 160, 90], [0, 0, h - topT - 45]),
      part('tray-cover', '走線蓋板', [length, 160, 4], [0, 0, h + 2]),
    );
  }
  return out;
}

function components(kind: FurnitureKind, w: number, d: number, h: number, style: TableStyle): ModelPart[] {
  if (kind === 'desk' || kind === 'conference') return tableComponents(kind, w, d, h, style);
  if (kind === 'shelf') {
    const t = 18;
    const count = Math.min(6, Math.max(3, Math.round(h / 360)));
    const innerW = w - t * 2;
    const out = [
      part('side-l', '側板 左', [t, d, h], [-(w / 2 - t / 2), 0, h / 2]),
      part('side-r', '側板 右', [t, d, h], [w / 2 - t / 2, 0, h / 2]),
      part('back', '背板', [innerW, 6, h], [0, -(d / 2 - 3), h / 2]),
    ];
    for (let i = 0; i < count; i += 1) {
      const z = t / 2 + (i * (h - t)) / (count - 1);
      out.push(part(`shelf-${i + 1}`, `層板 ${i + 1}`, [innerW, d - 8, t], [0, 2, z]));
    }
    return out;
  }
  const t = 18;
  const innerW = w - t * 2;
  const innerH = h - t * 2;
  return [
    part('side-l', '側板 左', [t, d, h], [-(w / 2 - t / 2), 0, h / 2]),
    part('side-r', '側板 右', [t, d, h], [w / 2 - t / 2, 0, h / 2]),
    part('top', '頂板', [innerW, d, t], [0, 0, h - t / 2]),
    part('bottom', '底板', [innerW, d, t], [0, 0, t / 2]),
    part('back', '背板', [innerW, 6, innerH], [0, -(d / 2 - 3), h / 2]),
    part('door', '門板', [innerW, t, innerH], [0, d / 2 + t / 2, h / 2]),
  ];
}

export function buildParametric(input: {
  kind: FurnitureKind;
  width_mm?: number | null;
  depth_mm?: number | null;
  height_mm?: number | null;
  /**
   * Axes whose number is an estimate (AI guess), not a measured value.
   * The number is still used for the model, but it stays flagged as estimated.
   */
  estimated_axes?: SizeAxis[];
  style?: Partial<TableStyle>;
}): ParametricModel {
  const isTable = input.kind === 'desk' || input.kind === 'conference';
  const style: TableStyle = { ...DEFAULT_TABLE_STYLE, ...(isTable ? input.style : {}) };
  const [dw, dd, dh] = DEFAULTS[input.kind];
  const estimated = new Set<SizeAxis>(input.estimated_axes ?? []);
  const width = axis(input.width_mm, dw, 400, 6000, estimated.has('width'));
  const depth = axis(input.depth_mm, dd, 250, 2400, estimated.has('depth'));
  const height = axis(input.height_mm, dh, 400, 2800, estimated.has('height'));
  const estimated_axes: SizeAxis[] = [];
  if (width.estimated) estimated_axes.push('width');
  if (depth.estimated) estimated_axes.push('depth');
  if (height.estimated) estimated_axes.push('height');
  return {
    kind: input.kind,
    supported: true,
    label: LABEL[input.kind],
    width_mm: width.mm,
    depth_mm: depth.mm,
    height_mm: height.mm,
    estimated_axes,
    ...(isTable ? { style } : {}),
    components: components(input.kind, width.mm, depth.mm, height.mm, style),
  };
}

/**
 * Map a product title / category onto a template this generator can build.
 * Chairs and sofas stay unsupported.
 */
export function inferFurnitureKind(text: string): FurnitureKind | null {
  const value = text.toLowerCase();
  if (/沙發|梳化|椅|chair|sofa/.test(value) && !/桌|枱|櫃|柜|架/.test(value)) return null;
  if (/會議|conference/.test(value)) return 'conference';
  if (/書架|層架|置物架|bookcase|shelf/.test(value)) return 'shelf';
  if (/櫃|柜|cabinet/.test(value)) return 'cabinet';
  if (/桌|枱|desk|table/.test(value)) return 'desk';
  return null;
}

/** Pull boat top, panel legs, and a cable tray out of the product name. */
export function inferTableStyle(text: string): Partial<TableStyle> {
  return {
    top: /船形|船型|boat/.test(text) ? 'boat' : 'rect',
    legs: /板腳|板脚/.test(text) ? 'panel' : 'four',
    cable_tray: /線盒|线盒|走線|走线/.test(text),
  };
}

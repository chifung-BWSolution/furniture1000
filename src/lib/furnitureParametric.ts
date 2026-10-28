/** Templates follow the FDS product categories (level1／level2) so every catalogue type maps to one. */
export type FurnitureKind =
  | 'desk'
  | 'conference'
  | 'dining'
  | 'coffee'
  | 'bar_counter'
  | 'reception'
  | 'lectern'
  | 'cabinet'
  | 'pedestal'
  | 'shelf'
  | 'office_chair'
  | 'side_chair'
  | 'stool'
  | 'beam_seating'
  | 'sofa'
  | 'booth'
  | 'phone_booth'
  /** No template fits: built from the AI's part list (CustomPartSpec). */
  | 'custom';
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

/** L = desk with a return on one side (L 形／F 型屏風位). */
export type TopShape = 'rect' | 'boat' | 'round' | 'L';
export type LegStyle = 'four' | 'panel' | 'pedestal';
/** star = five-star swivel base; sled = 弓字架 tube runners. */
export type ChairBase = 'star' | 'four' | 'sled';

/** Structure choices. Each kind only reads the fields listed in STYLE_FIELDS. */
export interface ModelStyle {
  top: TopShape;
  legs: LegStyle;
  /** Return side as seen by a seated user facing the desk. */
  return_side?: 'left' | 'right';
  cable_tray: boolean;
  /** Privacy screen along the back edge of a desk. */
  screen: boolean;
  doors: number;
  drawers: number;
  shelves: number;
  seats: number;
  arms: boolean;
  chair_base: ChairBase;
  /** Shelf: open metal rack (corner posts, side braces) instead of a panelled bookcase. */
  frame: boolean;
}
/** @deprecated kept for older call sites; same as ModelStyle. */
export type TableStyle = ModelStyle;

export type StyleField = keyof ModelStyle;

export const STYLE_FIELDS: Record<FurnitureKind, StyleField[]> = {
  /** seats = workstations in one product; drawers = drawers of the pedestal under each one. */
  desk: ['top', 'return_side', 'legs', 'cable_tray', 'screen', 'seats', 'drawers'],
  conference: ['top', 'legs', 'cable_tray'],
  dining: ['top', 'legs'],
  coffee: ['top', 'legs'],
  bar_counter: [],
  reception: [],
  lectern: [],
  cabinet: ['doors', 'drawers', 'shelves'],
  pedestal: ['drawers'],
  shelf: ['shelves', 'frame'],
  office_chair: ['chair_base', 'arms'],
  side_chair: ['chair_base', 'arms'],
  stool: ['legs'],
  beam_seating: ['seats', 'arms'],
  sofa: ['seats', 'arms'],
  booth: ['seats'],
  phone_booth: [],
  custom: [],
};

export const STYLE_LIMITS: Record<'doors' | 'drawers' | 'shelves' | 'seats', [number, number]> = {
  doors: [0, 4],
  drawers: [0, 6],
  shelves: [0, 8],
  seats: [1, 8],
};

export const DEFAULT_MODEL_STYLE: ModelStyle = {
  top: 'rect',
  return_side: 'right',
  legs: 'four',
  cable_tray: false,
  screen: false,
  doors: 2,
  drawers: 0,
  shelves: 3,
  seats: 3,
  arms: false,
  chair_base: 'four',
  frame: false,
};
/** @deprecated same as DEFAULT_MODEL_STYLE. */
export const DEFAULT_TABLE_STYLE = DEFAULT_MODEL_STYLE;

export interface ParametricModel {
  structure_evidence?: { leg_count: number; part_counts: Record<string, number>; symmetric: boolean; uncertainties: string[]; product_count?: number };
  structure_parts?: CustomPartSpec[];
  kind: FurnitureKind;
  supported: true;
  label: string;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  estimated_axes: SizeAxis[];
  style?: ModelStyle;
  /** custom only: the part list as checked, before it was fitted to the overall size. */
  custom_parts?: CustomPartSpec[];
  components: ModelPart[];
  engine_version?: string;
  /** Dimension sources and confirmations (see modelEvidence.ts); the server derives quality from it. */
  evidence?: import('./modelEvidence').ModelEvidence;
}

/**
 * One solid from the AI's part list. Millimetres; origin on the floor under the product centre,
 * x = width, y = depth (+y = front), z = up.
 */
export interface CustomPartSpec {
  name: string;
  shape: 'box' | 'cylinder' | 'profile' | 'sweep' | 'loft';
  /** Bounding lengths along x, y, z. */
  size_mm: Vec3;
  center_mm: Vec3;
  /** cylinder: the direction of its length (default z). profile／loft: the extrusion direction. */
  axis?: 'x' | 'y' | 'z';
  /** profile only: outline across the axis, relative to the centre (z → (x,y), y → (x,z), x → (y,z)). */
  points_mm?: [number, number][];
  /**
   * loft only: outlines across the axis at increasing offsets `at` from the centre, joined in order.
   * Every section has the same number of points, starting at the same corner and running the same way.
   */
  sections_mm?: LoftSection[];
  /** profile／loft: the points are control points of a smooth closed curve, not polygon corners. */
  smooth?: boolean;
  /** Sweep centreline, relative to center_mm; two points = straight/slanted support. */
  path_mm?: Vec3[];
  section?: 'round' | 'rect';
  section_mm?: [number, number];
  end_section_mm?: [number, number];
  /** Axis scaling preserves oriented sections when the overall size is edited. */
  geometry_scale?: Vec3;
  role?: 'leg' | 'top' | 'seat' | 'back' | 'arm' | 'frame' | 'body' | 'shelf' | 'other';
  product_index?: number;
  form?: 'straight' | 'slanted' | 'bent' | 'tapered' | 'panel';
  /** Indices in the part list, zero based. */
  connects_to?: number[];
  /** Stable across edits, so selection, versions and AI suggestions refer to the same part. */
  part_id?: string;
  /** Axes whose size never changes when the overall size or a key dimension changes. */
  locked_axes?: PartAxis[];
}

export type PartAxis = 'x' | 'y' | 'z';

export interface LoftSection {
  at: number;
  points_mm: [number, number][];
}

/** Bump when the same parameters would produce different geometry. */
export const PARAMETRIC_ENGINE_VERSION = 'fds-parametric-3';

export const MAX_CUSTOM_PARTS = 40;

export const FURNITURE_GROUPS: { label: string; kinds: FurnitureKind[] }[] = [
  { label: '枱／桌', kinds: ['desk', 'conference', 'dining', 'coffee', 'bar_counter', 'reception', 'lectern'] },
  { label: '儲物', kinds: ['cabinet', 'pedestal', 'shelf'] },
  { label: '座椅', kinds: ['office_chair', 'side_chair', 'stool', 'beam_seating', 'sofa', 'booth'] },
  { label: '其他', kinds: ['phone_booth', 'custom'] },
];

const LABEL: Record<FurnitureKind, string> = {
  desk: '辦公枱',
  conference: '會議枱',
  dining: '餐桌／洽談桌',
  coffee: '茶几',
  bar_counter: '吧台',
  reception: '前台',
  lectern: '講台',
  cabinet: '儲物櫃／文件櫃',
  pedestal: '活動櫃',
  shelf: '層架／書架',
  office_chair: '辦公椅',
  side_chair: '會議椅／餐椅',
  stool: '吧椅',
  beam_seating: '排椅／禮堂椅',
  sofa: '梳化',
  booth: '卡座',
  phone_booth: '靜音倉',
  custom: '其他（AI 部件）',
};

export const FURNITURE_KINDS: { id: FurnitureKind; label: string }[] = FURNITURE_GROUPS.flatMap((group) =>
  group.kinds.map((id) => ({ id, label: LABEL[id] })),
);

const DEFAULTS: Record<FurnitureKind, Vec3> = {
  desk: [1400, 700, 750],
  conference: [2400, 1200, 750],
  dining: [1600, 900, 750],
  coffee: [1200, 600, 420],
  bar_counter: [1800, 600, 1050],
  reception: [2000, 800, 1100],
  lectern: [700, 550, 1150],
  cabinet: [800, 400, 900],
  pedestal: [400, 500, 600],
  shelf: [900, 350, 1800],
  office_chair: [650, 650, 1150],
  side_chair: [500, 520, 850],
  stool: [400, 400, 750],
  beam_seating: [1800, 650, 800],
  sofa: [2000, 850, 800],
  booth: [1500, 650, 1100],
  phone_booth: [1000, 1000, 2200],
  custom: [1000, 600, 1000],
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

/** Box given by its floor-plan centre and bottom/top heights. */
function slab(id: string, name: string, w: number, d: number, x: number, y: number, z0: number, z1: number): ModelPart {
  return part(id, name, [w, d, z1 - z0], [x, y, (z0 + z1) / 2]);
}

function ellipse(rx: number, ry: number, sides = 24): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [Math.cos(a) * rx, Math.sin(a) * ry] as [number, number];
  });
}

/** Vertical cylinder (polygon prism) standing between z0 and z1. */
function column(id: string, name: string, rx: number, ry: number, x: number, y: number, z0: number, z1: number, sides = 16): ModelPart {
  return part(id, name, [rx * 2, ry * 2, z1 - z0], [x, y, (z0 + z1) / 2], { axis: 'z', points_mm: ellipse(rx, ry, sides) });
}

/**
 * Prism from an absolute outline in one plane, extruded `length` along `along` centred at `at`.
 * For axis x the points are (y, z); for axis y they are (x, z).
 */
function profile(id: string, name: string, along: 'x' | 'y', at: number, length: number, points: [number, number][]): ModelPart {
  const us = points.map((p) => p[0]);
  const vs = points.map((p) => p[1]);
  const cu = (Math.min(...us) + Math.max(...us)) / 2;
  const cv = (Math.min(...vs) + Math.max(...vs)) / 2;
  const su = Math.max(...us) - Math.min(...us);
  const sv = Math.max(...vs) - Math.min(...vs);
  const local = points.map(([u, v]) => [u - cu, v - cv] as [number, number]);
  return along === 'x'
    ? part(id, name, [length, su, sv], [at, cu, cv], { axis: 'x', points_mm: local })
    : part(id, name, [su, length, sv], [cu, at, cv], { axis: 'y', points_mm: local });
}

/** Flat bar in plan view from the centre outward at `angle`, used for star bases. */
function spoke(id: string, name: string, length: number, width: number, angle: number, z0: number, z1: number): ModelPart {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pts: [number, number][] = [
    [0, -width / 2],
    [length, -width / 2],
    [length, width / 2],
    [0, width / 2],
  ].map(([u, v]) => [u * c - v * s, u * s + v * c] as [number, number]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return part(
    id,
    name,
    [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), z1 - z0],
    [cx, cy, (z0 + z1) / 2],
    { axis: 'z', points_mm: pts.map(([x, y]) => [x - cx, y - cy] as [number, number]) },
  );
}

function fourLegs(prefix: string, label: string, xHalf: number, yHalf: number, leg: number, z0: number, z1: number): ModelPart[] {
  return [
    [-xHalf, -yHalf],
    [xHalf, -yHalf],
    [-xHalf, yHalf],
    [xHalf, yHalf],
  ].map(([x, y], i) => slab(`${prefix}-${i + 1}`, `${label} ${i + 1}`, leg, leg, x, y, z0, z1));
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
    const shape: [number, number][] = [
      [0, 0], [thick, 0], [thick, bendZ], [thick + lean, legH], [lean, legH], [0, bendZ],
    ];
    const outerX = side * (w / 2 - footInset);
    const centerX = outerX - side * (boxW / 2);
    const points = shape.map(([x, z]) => [
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

/** Centre column on a round foot; long tops get two. */
function pedestalLegs(w: number, d: number, h: number, topT: number): ModelPart[] {
  const legH = h - topT;
  const footT = 20;
  const two = w > d * 1.6;
  const reach = Math.min(two ? w * 0.22 : w * 0.32, d * 0.36);
  const post = clamp(Math.min(w, d) * 0.05, 35, 80);
  const xs = two ? [-w * 0.28, w * 0.28] : [0];
  return xs.flatMap((x, i) => [
    column(`foot-${i + 1}`, `底座 ${i + 1}`, reach, reach, x, 0, 0, footT, 20),
    column(`post-${i + 1}`, `中柱 ${i + 1}`, post, post, x, 0, footT, legH, 12),
  ]);
}

function tableComponents(kind: FurnitureKind, w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const shape = style.top;
  const topT = shape === 'boat' ? 40 : kind === 'coffee' ? 30 : 25;
  const endDepth = shape === 'boat' ? d * BOAT_END_RATIO : shape === 'round' ? d * 0.6 : d;
  let top: ModelPart;
  if (shape === 'boat') {
    top = part('top', '桌面', [w, d, topT], [0, 0, h - topT / 2], {
      axis: 'z',
      points_mm: [
        [-w / 2, -endDepth / 2], [0, -d / 2], [w / 2, -endDepth / 2],
        [w / 2, endDepth / 2], [0, d / 2], [-w / 2, endDepth / 2],
      ],
    });
  } else if (shape === 'round') {
    top = column('top', '桌面', w / 2, d / 2, 0, 0, h - topT, h, 32);
  } else {
    top = part('top', '桌面', [w, d, topT], [0, 0, h - topT / 2]);
  }
  const out = [top];
  if (style.legs === 'panel') {
    out.push(...panelLegs(w, d, h, topT, endDepth));
  } else if (style.legs === 'pedestal') {
    out.push(...pedestalLegs(w, d, h, topT));
  } else {
    const leg = kind === 'conference' ? 60 : 40;
    const inset = kind === 'conference' ? 80 : 50;
    const roundTop = shape === 'round';
    const xHalf = roundTop ? w * 0.3 : w / 2 - inset - leg / 2;
    const yHalf = roundTop ? d * 0.3 : endDepth / 2 - inset - leg / 2;
    out.push(...fourLegs('leg', '桌腳', xHalf, yHalf, leg, 0, h - topT));
    if (kind === 'conference') out.push(part('beam', '橫樑', [xHalf * 2, 40, 40], [0, 0, 140]));
  }
  if (style.cable_tray && (kind === 'desk' || kind === 'conference')) {
    const length = w * 0.5;
    out.push(
      part('tray', '走線槽', [length, 160, 90], [0, 0, h - topT - 45]),
      part('tray-cover', '走線蓋板', [length, 160, 4], [0, 0, h + 2]),
    );
  }
  if (style.screen && kind === 'desk') {
    out.push(slab('screen', '屏風', w, 25, 0, -(d / 2 - 12.5), h, h + 400));
  }
  return out;
}

/** Desks that are workstations rather than a plain table: several seats, an L return, a pedestal, or a screen above desk height. */
function isWorkstation(style: ModelStyle, h: number): boolean {
  return style.seats > 1 || style.top === 'L' || style.drawers > 0 || (style.screen && h >= 900);
}

const DESK_HEIGHT = 750;

/**
 * Workstation cluster (屏風位). The overall size is the whole cluster: seats are laid out in one
 * row, or two rows back to back when the depth holds two desks. Each desk faces away from the
 * shared screen; L returns sit on the outer side. When the height is well above a desk, the top
 * stays at 750 and the screen rises to the full height.
 */
function workstationComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const isL = style.top === 'L';
  const seats = style.seats;
  const rows = seats >= 2 && d / 2 >= (isL ? 900 : 500) ? 2 : 1;
  const cols = Math.ceil(seats / rows);
  const uw = w / cols;
  const ud = d / rows;
  const deskH = h >= 900 ? DESK_HEIGHT : h;
  const topT = 25;
  const panelT = 25;
  const screenT = 30;
  const screenTop = h > deskH + 150 ? h : deskH + 400;
  const back = -ud / 2 + (style.screen ? screenT / 2 : 0);
  const mainD = isL ? clamp(ud * 0.5, 450, 700) : ud / 2 - back;
  const returnW = clamp(uw * 0.4, 400, 650);
  const fillet = Math.max(0, Math.min(250, (uw - returnW) * 0.3, (ud / 2 - back - mainD) * 0.5));

  const out: ModelPart[] = [];
  let n = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols && n < seats; c += 1) {
      n += 1;
      const tag = seats > 1 ? `ws${n}-` : '';
      const label = seats > 1 ? `工作位 ${n} ` : '';
      const cx = -w / 2 + uw * (c + 0.5);
      const cy = rows === 1 ? 0 : r === 0 ? d / 4 : -d / 4;
      // Local u runs toward the return, v toward the person; f and s mirror it into the cluster.
      const f = r === 0 ? 1 : -1;
      // Rotate the back row 180 degrees instead of reflecting its L-shaped desks.
      const hand = style.return_side === 'left' ? 1 : -1;
      const s = (cols === 1 ? 1 : c < cols / 2 ? -1 : 1) * f * hand;
      const at = (u: number, v: number): [number, number] => [cx + s * u, cy + f * v];
      const box = (id: string, name: string, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number) => {
        const [x0, y0] = at(u0, v0);
        const [x1, y1] = at(u1, v1);
        return slab(`${tag}${id}`, `${label}${name}`, Math.abs(x1 - x0), Math.abs(y1 - y0), (x0 + x1) / 2, (y0 + y1) / 2, z0, z1);
      };

      const u0 = -uw / 2;
      const u1 = uw / 2;
      const front = ud / 2;
      if (isL) {
        const fx = u1 - returnW - fillet;
        const fy = back + mainD + fillet;
        const arc = Array.from({ length: 7 }, (_, i) => {
          const a = -(i / 6) * (Math.PI / 2);
          return [fx + fillet * Math.cos(a), fy + fillet * Math.sin(a)] as [number, number];
        });
        let pts: [number, number][] = [[u0, back], [u1, back], [u1, front], [u1 - returnW, front], ...arc, [u0, back + mainD]]
          .map(([u, v]) => at(u, v));
        if (s * f < 0) pts = pts.reverse();
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const my = (Math.min(...ys) + Math.max(...ys)) / 2;
        out.push(
          part(`${tag}top`, `${label}L 形桌面`, [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), topT], [mx, my, deskH - topT / 2], {
            axis: 'z',
            points_mm: pts.map(([x, y]) => [x - mx, y - my] as [number, number]),
          }),
        );
      } else {
        out.push(box('top', '桌面', u0, u1, back, front, deskH - topT, deskH));
      }

      const legTop = deskH - topT;
      const reach = isL ? back + mainD : front;
      if (style.legs === 'four') {
        const leg = 40;
        const spots: [number, number][] = isL
          ? [[u0 + 30, back + 30], [u0 + 30, reach - 30], [u1 - 30, back + 30], [u1 - 30, front - 30], [u1 - returnW + 30, front - 30]]
          : [[u0 + 30, back + 30], [u0 + 30, front - 30], [u1 - 30, back + 30], [u1 - 30, front - 30]];
        spots.forEach(([u, v], i) => out.push(box(`leg-${i + 1}`, `桌腳 ${i + 1}`, u - leg / 2, u + leg / 2, v - leg / 2, v + leg / 2, 0, legTop)));
      } else {
        out.push(
          box('end-1', '端板', u0, u0 + panelT, back, reach, 0, legTop),
          box('end-2', isL ? '側台端板' : '端板', u1 - panelT, u1, back, front, 0, legTop),
        );
      }
      out.push(box('modesty', '前擋板', u0 + panelT, u1 - panelT, back + 20, back + 38, 350, legTop));

      if (style.drawers > 0) {
        const pw = 400;
        const pd = Math.min(500, front - back - 120);
        const ph = Math.min(600, legTop - 30);
        const pu1 = u1 - panelT - 10;
        const pu0 = pu1 - pw;
        const pv1 = front - 40;
        const pv0 = pv1 - pd;
        out.push(box('pedestal', '活動櫃', pu0, pu1, pv0, pv1 - 18, 20, 20 + ph));
        const gap = 4;
        const each = (ph - gap * (style.drawers + 1)) / style.drawers;
        for (let i = 0; i < style.drawers; i += 1) {
          const z0 = 20 + gap + i * (each + gap);
          out.push(box(`drawer-${i + 1}`, `抽屜 ${i + 1}`, pu0 + 3, pu1 - 3, pv1 - 18, pv1, z0, z0 + each));
        }
      }
    }
  }

  if (style.screen) {
    const screenBottom = deskH - topT;
    const sy = rows === 2 ? 0 : -d / 2 + screenT / 2;
    out.push(slab('screen', '屏風', w, screenT, 0, sy, screenBottom, screenTop));
    for (let c = 1; c < cols; c += 1) {
      const x = -w / 2 + uw * c;
      const length = rows === 2 ? 2 * (mainD + screenT / 2) : mainD + screenT;
      const y = rows === 2 ? 0 : -d / 2 + length / 2;
      // The desks meet under it, so it stands on the tops rather than through them.
      out.push(slab(`divider-${c}`, `中間屏風 ${c}`, screenT, length, x, y, deskH, screenTop));
    }
  }
  return out;
}

function counterComponents(w: number, d: number, h: number): ModelPart[] {
  const topT = 30;
  const bodyD = d * 0.6;
  return [
    slab('top', '吧台面', w, d, 0, 0, h - topT, h),
    slab('body', '吧台身', w - 40, bodyD, 0, -(d / 2 - bodyD / 2), 0, h - topT),
    slab('foot-rail', '腳踏', w - 80, 30, 0, -(d / 2 - bodyD) + 120, 180, 210),
  ];
}

/** Front (+y) faces the visitor: tall front panel, transaction ledge, work top behind. */
function receptionComponents(w: number, d: number, h: number): ModelPart[] {
  const deskH = Math.min(750, h - 200);
  const t = 40;
  return [
    slab('front', '前檔板', w, t, 0, d / 2 - t / 2, 0, h - 25),
    slab('ledge', '接待台面', w, 300, 0, d / 2 - 150, h - 25, h),
    slab('worktop', '工作台面', w - t * 2, d - t, 0, -t / 2, deskH - 25, deskH),
    slab('side-l', '側板 左', t, d - t, -(w / 2 - t / 2), -t / 2, 0, deskH - 25),
    slab('side-r', '側板 右', t, d - t, w / 2 - t / 2, -t / 2, 0, deskH - 25),
  ];
}

/** The speaker stands at the back (-y); the reading top slopes down toward them. */
function lecternComponents(w: number, d: number, h: number): ModelPart[] {
  const lip = 30;
  return [
    profile('body', '講台身', 'x', 0, w, [
      [-d / 2, 0], [d / 2, 0], [d / 2, h], [-d / 2, h * 0.88],
    ]),
    slab('lip', '擋書條', w, 20, 0, -(d / 2 - 10), h * 0.88, h * 0.88 + lip),
  ];
}

function carcass(w: number, d: number, h: number, z0: number, t: number): ModelPart[] {
  const innerW = w - t * 2;
  return [
    slab('side-l', '側板 左', t, d, -(w / 2 - t / 2), 0, z0, h),
    slab('side-r', '側板 右', t, d, w / 2 - t / 2, 0, z0, h),
    slab('top', '頂板', innerW, d, 0, 0, h - t, h),
    slab('bottom', '底板', innerW, d, 0, 0, z0, z0 + t),
    slab('back', '背板', innerW, 6, 0, -(d / 2 - 3), z0 + t, h - t),
  ];
}

/** Drawers at the bottom, doors above; with neither, the shelves stay open. */
function cabinetComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const t = 18;
  const gap = 3;
  const innerW = w - t * 2;
  const innerBottom = t;
  const innerTop = h - t;
  const innerH = innerTop - innerBottom;
  const drawers = clamp(Math.round(style.drawers), 0, 6);
  const doors = clamp(Math.round(style.doors), 0, 4);
  const drawerH = doors > 0 ? Math.min(innerH / (drawers + 1), drawers > 0 ? 260 : 0) : drawers > 0 ? innerH / drawers : 0;
  const drawerTop = innerBottom + drawerH * drawers;
  const out = carcass(w, d, h, 0, t);
  const frontY = d / 2 + t / 2;
  for (let i = 0; i < drawers; i += 1) {
    const z0 = innerBottom + drawerH * i;
    out.push(
      slab(`drawer-${i + 1}`, `抽屜 ${i + 1}`, innerW, t, 0, frontY, z0 + gap / 2, z0 + drawerH - gap / 2),
      slab(`drawer-${i + 1}-handle`, `抽屜拉手 ${i + 1}`, Math.min(160, innerW * 0.4), 20, 0, frontY + t / 2 + 10, z0 + drawerH / 2 - 10, z0 + drawerH / 2 + 10),
    );
  }
  const shelfSpace = innerTop - drawerTop;
  const shelves = shelfSpace > 150 ? clamp(Math.round(style.shelves), 0, 8) : 0;
  for (let i = 1; i <= shelves; i += 1) {
    const z = drawerTop + (shelfSpace * i) / (shelves + 1);
    out.push(slab(`shelf-${i}`, `層板 ${i}`, innerW, d - 12, 0, 3, z - t / 2, z + t / 2));
  }
  if (doors > 0 && shelfSpace > 50) {
    const doorW = innerW / doors;
    for (let i = 0; i < doors; i += 1) {
      const x = -innerW / 2 + doorW * (i + 0.5);
      out.push(slab(`door-${i + 1}`, `門板 ${i + 1}`, doorW - gap, t, x, frontY, drawerTop + gap / 2, innerTop));
      const handleX = doors === 1 ? x + doorW / 2 - 40 : i % 2 === 0 ? x + doorW / 2 - 40 : x - doorW / 2 + 40;
      const mid = drawerTop + shelfSpace / 2;
      out.push(slab(`door-${i + 1}-handle`, `門拉手 ${i + 1}`, 20, 20, handleX, frontY + t / 2 + 10, mid - 60, mid + 60));
    }
  }
  return out;
}

function pedestalComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const caster = 50;
  const t = 18;
  const drawers = clamp(Math.round(style.drawers) || 3, 1, 6);
  const out = carcass(w, d, h, caster, t);
  const innerW = w - t * 2;
  const z0 = caster + t;
  const drawerH = (h - t - z0) / drawers;
  const frontY = d / 2 + t / 2;
  for (let i = 0; i < drawers; i += 1) {
    const zb = z0 + drawerH * i;
    out.push(
      slab(`drawer-${i + 1}`, `抽屜 ${i + 1}`, innerW, t, 0, frontY, zb + 1.5, zb + drawerH - 1.5),
      slab(`drawer-${i + 1}-handle`, `抽屜拉手 ${i + 1}`, Math.min(120, innerW * 0.4), 20, 0, frontY + t / 2 + 10, zb + drawerH * 0.75 - 10, zb + drawerH * 0.75 + 10),
    );
  }
  const cx = w / 2 - 40;
  const cy = d / 2 - 40;
  [[-cx, -cy], [cx, -cy], [-cx, cy], [cx, cy]].forEach(([x, y], i) => {
    out.push(column(`caster-${i + 1}`, `腳輪 ${i + 1}`, 25, 25, x, y, 0, caster, 12));
  });
  return out;
}

/** Boltless steel rack: corner posts, decks between them, one diagonal brace per bay on each side. */
function frameShelfComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const post = 40;
  const t = 35;
  const brace = 30;
  const count = clamp(Math.round(style.shelves), 0, 8) + 2;
  const xh = w / 2 - post / 2;
  const yh = d / 2 - post / 2;
  const out = [
    slab('post-1', '立柱 左前', post, post, -xh, yh, 0, h),
    slab('post-2', '立柱 右前', post, post, xh, yh, 0, h),
    slab('post-3', '立柱 左後', post, post, -xh, -yh, 0, h),
    slab('post-4', '立柱 右後', post, post, xh, -yh, 0, h),
  ];
  const bottom = Math.min(120, h * 0.08);
  const levels = Array.from({ length: count }, (_, i) => bottom + (i * (h - t - bottom)) / (count - 1));
  levels.forEach((z, i) => out.push(slab(`shelf-${i + 1}`, `層板 ${i + 1}`, w - post * 2, d, 0, 0, z, z + t)));
  const y0 = -(d / 2 - post);
  const y1 = d / 2 - post;
  for (let i = 0; i + 1 < levels.length; i += 1) {
    const zA = levels[i] + t;
    const zB = levels[i + 1];
    if (zB - zA < brace * 3) continue;
    const [ya, yb] = i % 2 === 0 ? [y0, y1] : [y1, y0];
    for (const side of [-1, 1]) {
      out.push(
        profile(`brace-${side < 0 ? 'l' : 'r'}-${i + 1}`, `斜撐 ${side < 0 ? '左' : '右'} ${i + 1}`, 'x', side * xh, 8, [
          [ya, zA], [yb, zB - brace], [yb, zB], [ya, zA + brace],
        ]),
      );
    }
  }
  return out;
}

function shelfComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  if (style.frame) return frameShelfComponents(w, d, h, style);
  const t = 18;
  const count = clamp(Math.round(style.shelves), 0, 8) + 2;
  const innerW = w - t * 2;
  const out = [
    slab('side-l', '側板 左', t, d, -(w / 2 - t / 2), 0, 0, h),
    slab('side-r', '側板 右', t, d, w / 2 - t / 2, 0, 0, h),
    slab('back', '背板', innerW, 6, 0, -(d / 2 - 3), 0, h),
  ];
  for (let i = 0; i < count; i += 1) {
    const z = t / 2 + (i * (h - t)) / (count - 1);
    out.push(part(`shelf-${i + 1}`, `層板 ${i + 1}`, [innerW, d - 8, t], [0, 2, z]));
  }
  return out;
}

/** Five-star base on casters, gas column, seat, reclined back. Back is at -y. */
function officeChairComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const seatZ = clamp(h * 0.4, 420, 520);
  const seatT = 80;
  const reach = Math.min(w, d) / 2 - 30;
  const out: ModelPart[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + Math.PI / 2;
    out.push(spoke(`base-${i + 1}`, `五星腳 ${i + 1}`, reach, 50, angle, 50, 90));
    out.push(column(`caster-${i + 1}`, `腳輪 ${i + 1}`, 25, 25, Math.cos(angle) * (reach - 20), Math.sin(angle) * (reach - 20), 0, 50, 10));
  }
  out.push(column('column', '氣壓棒', 30, 30, 0, 0, 90, seatZ - seatT, 12));
  const seatW = w * 0.78;
  const seatD = d * 0.72;
  out.push(slab('seat', '座墊', seatW, seatD, 0, d * 0.06, seatZ - seatT, seatZ));
  const backT = 60;
  const yBottom = -d * 0.3;
  const yTop = -d / 2 + backT;
  const backZ0 = seatZ + 40;
  out.push(
    profile('back', '靠背', 'x', 0, w * 0.72, [
      [yBottom - backT, backZ0], [yBottom, backZ0], [yTop, h], [yTop - backT, h],
    ]),
    slab('back-link', '靠背連接件', 60, backT + 60, 0, yBottom - backT / 2 + 30, seatZ - seatT, backZ0),
  );
  if (style.arms) {
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - 35);
      out.push(
        slab(`arm-post-${side < 0 ? 'l' : 'r'}`, `扶手柱 ${side < 0 ? '左' : '右'}`, 40, 40, x, 0, seatZ - seatT / 2, seatZ + 200),
        slab(`arm-pad-${side < 0 ? 'l' : 'r'}`, `扶手 ${side < 0 ? '左' : '右'}`, 70, d * 0.4, x, 0, seatZ + 200, seatZ + 230),
      );
    }
  }
  return out;
}

/** Four-leg chair: training, meeting, dining, and visitor chairs. Back is at -y. */
function sideChairComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const seatZ = clamp(h * 0.54, 420, 480);
  const seatT = 40;
  const leg = 30;
  const xh = w / 2 - 20 - leg / 2;
  const yh = d / 2 - 20 - leg / 2;
  const backH = (h - seatZ) * 0.55;
  const out = [
    slab('leg-1', '前腳 左', leg, leg, -xh, yh, 0, seatZ - seatT),
    slab('leg-2', '前腳 右', leg, leg, xh, yh, 0, seatZ - seatT),
    slab('leg-3', '後腳 左', leg, leg, -xh, -yh, 0, h),
    slab('leg-4', '後腳 右', leg, leg, xh, -yh, 0, h),
    slab('seat', '座板', w - 20, d - 20, 0, 0, seatZ - seatT, seatZ),
    slab('back', '靠背', xh * 2 - leg, 25, 0, -yh, h - backH, h - 20),
  ];
  if (style.arms) {
    for (const side of [-1, 1]) {
      const x = side * xh;
      out.push(
        slab(`arm-post-${side < 0 ? 'l' : 'r'}`, `扶手柱 ${side < 0 ? '左' : '右'}`, leg, leg, x, yh, seatZ, seatZ + 200),
        slab(`arm-${side < 0 ? 'l' : 'r'}`, `扶手 ${side < 0 ? '左' : '右'}`, 40, yh * 2 + leg, x, 0, seatZ + 200, seatZ + 225),
      );
    }
  }
  return out;
}

/** 弓字架 visitor chair: two tube runners on the floor carry the seat and back. Back is at -y. */
function sledChairComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const seatZ = clamp(h * 0.54, 420, 480);
  const seatT = 40;
  const tube = 25;
  const runner = 25;
  const x = w / 2 - 30;
  const frontY = d / 2 - 40;
  const rearY = -(d / 2 - 60);
  const armZ = seatZ + 200;
  const out: ModelPart[] = [];
  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'l' : 'r';
    const zh = side < 0 ? '左' : '右';
    out.push(
      slab(`runner-${tag}`, `弓字架底管 ${zh}`, tube, d - 40, side * x, 0, 0, runner),
      slab(`front-${tag}`, `弓字架前管 ${zh}`, tube, tube, side * x, frontY, runner, style.arms ? armZ : seatZ - seatT),
      slab(`rear-${tag}`, `弓字架後管 ${zh}`, tube, tube, side * x, rearY, runner, h - 20),
    );
    if (style.arms) {
      out.push(slab(`arm-${tag}`, `扶手 ${zh}`, 40, frontY - rearY + tube, side * x, (frontY + rearY) / 2, armZ, armZ + 25));
    }
  }
  out.push(
    slab('seat', '座墊', w - 70, d - 70, 0, 0, seatZ - seatT, seatZ),
    slab('back', '靠背', x * 2 - tube, 25, 0, rearY, seatZ + (h - seatZ) * 0.3, h),
  );
  return out;
}

function stoolComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const r = Math.min(w, d) / 2;
  const ring = r * 1.3;
  const ringZ = Math.min(300, h * 0.4);
  const bar = 25;
  if (style.legs === 'four') {
    const x = w / 2 - bar;
    const y = d / 2 - bar;
    return [
      ...[-1, 1].flatMap((sx, i) => [-1, 1].map((sy, j) =>
        slab(`leg-${i * 2 + j + 1}`, `凳腳 ${i * 2 + j + 1}`, bar, bar, sx * x, sy * y, 0, h - 50))),
      slab('seat', '座墊', w, d, 0, 0, h - 50, h),
      slab('rail-front', '腳踏 前', x * 2, bar, 0, y, ringZ, ringZ + bar),
      slab('rail-back', '腳踏 後', x * 2, bar, 0, -y, ringZ, ringZ + bar),
      slab('rail-l', '腳踏 左', bar, y * 2, -x, 0, ringZ, ringZ + bar),
      slab('rail-r', '腳踏 右', bar, y * 2, x, 0, ringZ, ringZ + bar),
    ];
  }
  return [
    column('foot', '底盤', r * 0.9, r * 0.9, 0, 0, 0, 15, 20),
    column('column', '中柱', 30, 30, 0, 0, 15, h - 50, 12),
    column('seat', '座墊', r, r, 0, 0, h - 50, h, 24),
    slab('ring-front', '腳踏 前', ring, bar, 0, ring / 2 - bar / 2, ringZ, ringZ + bar),
    slab('ring-back', '腳踏 後', ring, bar, 0, -(ring / 2 - bar / 2), ringZ, ringZ + bar),
    slab('ring-l', '腳踏 左', bar, ring - bar * 2, -(ring / 2 - bar / 2), 0, ringZ, ringZ + bar),
    slab('ring-r', '腳踏 右', bar, ring - bar * 2, ring / 2 - bar / 2, 0, ringZ, ringZ + bar),
  ];
}

/** Row seating on a shared beam (airport, auditorium, waiting rows). */
function beamSeatingComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const seats = clamp(Math.round(style.seats), 1, 8);
  const beamZ = 360;
  const seatZ = 440;
  const sw = w / seats;
  const out: ModelPart[] = [slab('beam', '橫樑', w, 60, 0, 0, beamZ, beamZ + 60)];
  const legXs = seats > 3 ? [-(w / 2 - 150), 0, w / 2 - 150] : [-(w / 2 - 150), w / 2 - 150];
  legXs.forEach((x, i) => {
    out.push(
      slab(`leg-${i + 1}`, `支腳 ${i + 1}`, 60, 60, x, 0, 30, beamZ),
      slab(`foot-${i + 1}`, `腳座 ${i + 1}`, 60, d * 0.8, x, 0, 0, 30),
    );
  });
  for (let i = 0; i < seats; i += 1) {
    const x = -w / 2 + sw * (i + 0.5);
    out.push(
      slab(`seat-${i + 1}`, `座位 ${i + 1}`, sw - 40, d * 0.6, x, d * 0.08, seatZ - 30, seatZ),
      profile(`back-${i + 1}`, `靠背 ${i + 1}`, 'x', x, sw - 40, [
        [-d * 0.22 - 25, seatZ], [-d * 0.22, seatZ], [-d / 2 + 25, h], [-d / 2, h],
      ]),
    );
  }
  if (style.arms) {
    for (let i = 0; i <= seats; i += 1) {
      const x = clamp(-w / 2 + sw * i, -w / 2 + 20, w / 2 - 20);
      out.push(slab(`arm-${i + 1}`, `扶手 ${i + 1}`, 40, d * 0.5, x, d * 0.05, seatZ + 180, seatZ + 210));
    }
  }
  return out;
}

function sofaComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const seats = clamp(Math.round(style.seats), 1, 8);
  const feet = 80;
  const seatZ = 430;
  const baseTop = seatZ - 130;
  const arm = style.arms ? Math.min(180, w * 0.12) : 0;
  const backT = Math.min(200, d * 0.24);
  const backCushion = 120;
  const innerW = w - arm * 2;
  const cw = innerW / seats;
  const seatD = d - backT - backCushion;
  const out: ModelPart[] = [
    slab('base', '底座', w, d, 0, 0, feet, baseTop),
    slab('back', '靠背', innerW, backT, 0, -(d / 2 - backT / 2), baseTop, h),
    ...fourLegs('foot', '腳', w / 2 - 60, d / 2 - 60, 40, 0, feet),
  ];
  for (let i = 0; i < seats; i += 1) {
    const x = -innerW / 2 + cw * (i + 0.5);
    out.push(
      slab(`seat-${i + 1}`, `座墊 ${i + 1}`, cw - 10, seatD, x, d / 2 - seatD / 2, baseTop, seatZ),
      slab(`back-cushion-${i + 1}`, `背墊 ${i + 1}`, cw - 10, backCushion, x, -(d / 2 - backT - backCushion / 2), seatZ, seatZ + (h - seatZ) * 0.85),
    );
  }
  if (arm > 0) {
    const armTop = Math.min(h, seatZ + 200);
    out.push(
      slab('arm-l', '扶手 左', arm, d, -(w / 2 - arm / 2), 0, feet, armTop),
      slab('arm-r', '扶手 右', arm, d, w / 2 - arm / 2, 0, feet, armTop),
    );
  }
  return out;
}

/** Restaurant booth: plinth, seat cushions, high back. Back is at -y. */
function boothComponents(w: number, d: number, h: number, style: ModelStyle): ModelPart[] {
  const seats = clamp(Math.round(style.seats), 1, 8);
  const plinth = 380;
  const seatZ = 450;
  const backT = Math.min(160, d * 0.25);
  const sw = w / seats;
  const out: ModelPart[] = [
    slab('plinth', '底座', w, d - backT, 0, backT / 2, 0, plinth),
    slab('back', '高背', w, backT, 0, -(d / 2 - backT / 2), 0, h),
  ];
  for (let i = 0; i < seats; i += 1) {
    const x = -w / 2 + sw * (i + 0.5);
    out.push(
      slab(`seat-${i + 1}`, `座墊 ${i + 1}`, sw - 10, d - backT - 100, x, (backT + 100) / 2, plinth, seatZ),
      slab(`back-cushion-${i + 1}`, `背墊 ${i + 1}`, sw - 10, 100, x, -(d / 2 - backT - 50), seatZ, seatZ + (h - seatZ) * 0.75),
    );
  }
  return out;
}

/** Phone booth / quiet pod: floor, roof, walls, glass door at the front (+y). */
function phoneBoothComponents(w: number, d: number, h: number): ModelPart[] {
  const wall = 50;
  const floor = 60;
  const roof = 80;
  const z0 = floor;
  const z1 = h - roof;
  const doorW = (w - wall * 2) * 0.6;
  const fixedW = w - wall * 2 - doorW;
  return [
    slab('floor', '地台', w, d, 0, 0, 0, floor),
    slab('roof', '頂蓋', w, d, 0, 0, z1, h),
    slab('wall-back', '後牆', w, wall, 0, -(d / 2 - wall / 2), z0, z1),
    slab('wall-l', '側牆 左', wall, d - wall, -(w / 2 - wall / 2), wall / 2, z0, z1),
    slab('wall-r', '側牆 右', wall, d - wall, w / 2 - wall / 2, wall / 2, z0, z1),
    slab('front-fixed', '前固定玻璃', fixedW, 12, -(w / 2 - wall - fixedW / 2), d / 2 - 6, z0, z1),
    slab('door', '玻璃門', doorW, 12, w / 2 - wall - doorW / 2, d / 2 - 6, z0, z1),
    slab('desk', '枱板', w - wall * 2, 350, 0, -(d / 2 - wall - 175), 1030, 1060),
  ];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function polygonArea(points: [number, number][]): number {
  let sum = 0;
  points.forEach(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    sum += x * ny - nx * y;
  });
  return sum / 2;
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const side = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** Outline with ≥3 points, real area, and no edges crossing each other. */
function simpleOutline(points: [number, number][]): boolean {
  if (points.length < 3 || points.length > 48) return false;
  if (new Set(points.map(([x, y]) => `${x},${y}`)).size !== points.length) return false;
  if (Math.abs(polygonArea(points)) < 1) return false;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 2; j < points.length; j += 1) {
      if (i === 0 && j === points.length - 1) continue;
      if (segmentsCross(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return true;
}

/**
 * Validate the entire list: silently dropping a support or replacing its shape changes
 * the furniture's structure. Reject malformed parts so the user can retry extraction.
 */
export function sanitizeCustomParts(input: unknown): CustomPartSpec[] {
  if (!Array.isArray(input)) return [];
  if (input.length > MAX_CUSTOM_PARTS) throw new Error('部件數量超出上限，請重新辨認部件');
  const out: CustomPartSpec[] = [];
  for (const raw of input) {
    const invalid = () => new Error(`部件 ${out.length + 1} 資料無效，請重新辨認部件`);
    if (!raw || typeof raw !== 'object') throw invalid();
    const r = raw as Record<string, unknown>;
    const size = Array.isArray(r.size_mm) ? r.size_mm.slice(0, 3) : [];
    const center = Array.isArray(r.center_mm) ? r.center_mm.slice(0, 3) : [];
    if (size.length !== 3 || center.length !== 3 || !size.every(finite) || !center.every(finite)) throw invalid();
    if (!size.every((n) => n >= 3 && n <= 10000) || !center.every((n) => Math.abs(n) <= 10000)) throw invalid();
    if (!['box', 'cylinder', 'profile', 'sweep', 'loft'].includes(String(r.shape))) throw invalid();
    const shape = r.shape as CustomPartSpec['shape'];
    const axisValue = r.axis === 'x' || r.axis === 'y' || r.axis === 'z' ? r.axis : undefined;
    const spec: CustomPartSpec = {
      name: String(r.name ?? '').trim().slice(0, 40) || `部件 ${out.length + 1}`,
      shape,
      size_mm: size as Vec3,
      center_mm: center as Vec3,
    };
    if (['leg', 'top', 'seat', 'back', 'arm', 'frame', 'body', 'shelf', 'other'].includes(String(r.role))) spec.role = r.role as CustomPartSpec['role'];
    if (r.product_index !== undefined) {
      if (!Number.isInteger(r.product_index) || Number(r.product_index) < 0 || Number(r.product_index) > 19) throw invalid();
      spec.product_index = Number(r.product_index);
    }
    if (['straight', 'slanted', 'bent', 'tapered', 'panel'].includes(String(r.form))) spec.form = r.form as CustomPartSpec['form'];
    if (r.connects_to !== undefined) {
      if (!Array.isArray(r.connects_to) || !r.connects_to.every(n => Number.isInteger(n) && n >= 0 && n < input.length && n !== out.length)) throw invalid();
      spec.connects_to = [...new Set(r.connects_to as number[])];
    }
    if (typeof r.part_id === 'string' && /^[\w-]{1,40}$/.test(r.part_id)) spec.part_id = r.part_id;
    if (Array.isArray(r.locked_axes)) {
      const locked = (['x', 'y', 'z'] as const).filter((a) => (r.locked_axes as unknown[]).includes(a));
      if (locked.length) spec.locked_axes = locked;
    }
    if (shape === 'sweep') {
      if (!Array.isArray(r.path_mm) || r.path_mm.length < 2 || r.path_mm.length > 32 ||
        !r.path_mm.every(p => Array.isArray(p) && p.length === 3 && p.every(n => finite(n) && Math.abs(n) <= 10000))) throw invalid();
      const path = r.path_mm as Vec3[];
      if (path.some((p, i) => i > 0 && Math.hypot(...p.map((n, k) => n - path[i - 1][k])) < 1)) throw invalid();
      if (new Set(path.map(p => p.join(','))).size !== path.length) throw invalid();
      const section = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(n => finite(n) && n >= 3 && n <= 1000);
      if (!section(r.section_mm) || (r.end_section_mm !== undefined && !section(r.end_section_mm)) || !['round', 'rect'].includes(String(r.section))) throw invalid();
      spec.path_mm = path.map(p => [...p] as Vec3);
      spec.section = r.section as 'round' | 'rect';
      spec.section_mm = r.section_mm;
      spec.end_section_mm = r.end_section_mm as [number, number] | undefined;
      if (r.geometry_scale !== undefined) {
        if (!Array.isArray(r.geometry_scale) || r.geometry_scale.length !== 3 || !r.geometry_scale.every(n => finite(n) && n > 0.001 && n < 1000)) throw invalid();
        spec.geometry_scale = r.geometry_scale as Vec3;
      }
      spec.size_mm = sweepPart(spec, 'checked', [1,1,1], [0,0,0]).size_mm;
    }
    if (shape === 'cylinder') spec.axis = axisValue ?? 'z';
    if (shape === 'profile') {
      if (!Array.isArray(r.points_mm) || r.points_mm.some((p) =>
        !Array.isArray(p) || p.length !== 2 || !p.every((n) => finite(n) && Math.abs(n) <= 10000))) throw invalid();
      const points = Array.isArray(r.points_mm)
        ? r.points_mm
            .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]))
            .map(([u, v]) => [u, v] as [number, number])
        : [];
      if (axisValue && simpleOutline(points)) {
        spec.axis = axisValue;
        spec.points_mm = points;
        if (r.smooth === true) spec.smooth = true;
      } else {
        throw new Error(`部件「${spec.name}」輪廓無效，請重新辨認部件`);
      }
    }
    if (shape === 'loft') {
      const badLoft = () => new Error(`部件「${spec.name}」截面無效，請重新辨認部件`);
      const raws = Array.isArray(r.sections_mm) ? r.sections_mm : [];
      if (!axisValue || raws.length < 2 || raws.length > 12) throw badLoft();
      const sections = raws.map((s) => {
        const row = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
        if (!finite(row.at) || Math.abs(row.at) > 10000 || !Array.isArray(row.points_mm) || row.points_mm.some((p) =>
          !Array.isArray(p) || p.length !== 2 || !p.every((n) => finite(n) && Math.abs(n) <= 10000))) throw badLoft();
        const points = (row.points_mm as [number, number][]).map(([u, v]) => [u, v] as [number, number]);
        if (!simpleOutline(points)) throw badLoft();
        return { at: row.at, points_mm: points };
      });
      const count = sections[0].points_mm.length;
      const winding = Math.sign(polygonArea(sections[0].points_mm));
      if (sections.some((s, i) => s.points_mm.length !== count || Math.sign(polygonArea(s.points_mm)) !== winding
        || (i > 0 && s.at - sections[i - 1].at < 1))) throw badLoft();
      spec.axis = axisValue;
      spec.sections_mm = sections;
      if (r.smooth === true) spec.smooth = true;
      spec.size_mm = loftPart(spec, 'checked', [1, 1, 1], [0, 0, 0]).size_mm;
    }
    out.push(spec);
  }
  return out;
}

/** Every face must triangulate to its own area, otherwise the outline folded over itself. */
function facesSound(p: ModelPart): boolean {
  return p.faces_mm.every((face) => {
    const n = newellNormal(face);
    const area = Math.hypot(n[0], n[1], n[2]) / 2;
    if (area < 0.5) return false;
    const tris = triangulateFace(face);
    if (tris.length !== face.length - 2) return false;
    const sum = tris.reduce((acc, [i, j, k]) => {
      const t = newellNormal([face[i], face[j], face[k]]);
      return acc + Math.hypot(t[0], t[1], t[2]) / 2;
    }, 0);
    return Math.abs(sum - area) <= Math.max(1, area * 0.01);
  });
}

function specPart(spec: CustomPartSpec, index: number, scale: Vec3, shift: Vec3): ModelPart {
  const size = spec.size_mm.map((n, i) => n * scale[i]) as Vec3;
  const center = spec.center_mm.map((n, i) => (n - shift[i]) * scale[i]) as Vec3;
  const id = `part-${index + 1}`;
  if (spec.shape === 'sweep') return sweepPart(spec, id, scale, shift);
  if (spec.shape === 'loft') return loftPart(spec, id, scale, shift);
  if (spec.shape === 'box') return part(id, spec.name, size, center);
  const along = spec.axis ?? 'z';
  const [u, v] = PLANE[along];
  const scaled = (spec.points_mm ?? []).map(([a, b]) => [a * scale[u], b * scale[v]] as [number, number]);
  const points =
    spec.shape === 'cylinder'
      ? ellipse(size[u] / 2, size[v] / 2, 20)
      : spec.smooth ? smoothOutline(scaled) : scaled;
  return part(id, spec.name, size, center, { axis: along, points_mm: points });
}

const SMOOTH_POINTS = 64;

/**
 * Closed centripetal Catmull-Rom through every control point. Centripetal spacing does not
 * loop or overshoot where control points crowd together, so a tight corner stays a corner.
 */
export function smoothOutline(points: [number, number][]): [number, number][] {
  const n = points.length;
  const steps = Math.max(1, Math.floor(SMOOTH_POINTS / n));
  if (steps === 1) return points;
  const out: [number, number][] = [];
  const lerp = (p: [number, number], q: [number, number], ta: number, tb: number, t: number): [number, number] =>
    tb - ta < 1e-9 ? p : [p[0] + (q[0] - p[0]) * (t - ta) / (tb - ta), p[1] + (q[1] - p[1]) * (t - ta) / (tb - ta)];
  const knot = (p: [number, number], q: [number, number]) => Math.sqrt(Math.hypot(q[0] - p[0], q[1] - p[1]));
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    for (let s = 0; s < steps; s += 1) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const a1 = lerp(p0, p1, 0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
      out.push(lerp(lerp(a1, a2, 0, t2, t), lerp(a2, a3, t1, t3, t), t1, t2, t));
    }
  }
  return out;
}

/** Sections joined in order; side quads that are not flat are split so every exporter gets planar faces. */
function loftPart(spec: CustomPartSpec, id: string, scale: Vec3, shift: Vec3): ModelPart {
  const along = AXIS_INDEX[spec.axis!];
  const [u, v] = PLANE[spec.axis!];
  let rings = spec.sections_mm!.map((section) => {
    const flat = section.points_mm.map(([a, b]) => [a * scale[u], b * scale[v]] as [number, number]);
    return (spec.smooth ? smoothOutline(flat) : flat).map(([a, b]) => {
      const p = spec.center_mm.map((n, k) => (n - shift[k]) * scale[k]) as Vec3;
      p[u] += a;
      p[v] += b;
      p[along] += section.at * scale[along];
      return p;
    });
  });
  if (newellNormal(rings[0])[along] < 0) rings = rings.map((ring) => [...ring].reverse());
  const faces: Vec3[][] = [[...rings[0]].reverse(), rings[rings.length - 1]];
  const sub = (a: Vec3, b: Vec3) => a.map((n, k) => n - b[k]) as Vec3;
  for (let i = 0; i < rings.length - 1; i += 1) {
    const [lo, hi] = [rings[i], rings[i + 1]];
    for (let j = 0; j < lo.length; j += 1) {
      const k = (j + 1) % lo.length;
      const [a, b, c, d] = [lo[j], lo[k], hi[k], hi[j]];
      const e1 = sub(b, a), e2 = sub(c, a);
      const nrm: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(...nrm);
      const off = len > 0 ? Math.abs(nrm.reduce((s, n, m) => s + n * (d[m] - a[m]), 0)) / len : Infinity;
      if (off < 0.01) faces.push([a, b, c, d]);
      else faces.push([a, b, c], [a, c, d]);
    }
  }
  const pts = faces.flat();
  const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
  return { id, name: spec.name, size_mm: hi.map((n, k) => n - lo[k]) as Vec3, position_mm: hi.map((n, k) => (n + lo[k]) / 2) as Vec3, faces_mm: faces };
}

/** Parallel-transported frames avoid twisting when a tube bends across several axes. */
function sweepPart(spec: CustomPartSpec, id: string, scale: Vec3, shift: Vec3): ModelPart {
  const path = spec.path_mm!;
  const sub = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]) as Vec3;
  const dot = (a: Vec3, b: Vec3) => a.reduce((s, n, i) => s + n * b[i], 0);
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const unit = (v: Vec3): Vec3 => { const len = Math.hypot(...v); if (len < 0.00001) throw new Error('彎管路徑折返，請重新辨認部件'); return v.map(n => n / len) as Vec3; };
  let previous: Vec3 | null = null;
  const lengths = path.map((p, i) => i ? Math.hypot(...sub(p, path[i - 1])) : 0);
  const total = lengths.reduce((a, b) => a + b, 0);
  let distance = 0;
  const rings = path.map((p, i) => {
    distance += lengths[i];
    const before = i > 0 ? unit(sub(p, path[i - 1])) : unit(sub(path[1], p));
    const after = i < path.length - 1 ? unit(sub(path[i + 1], p)) : before;
    if (dot(before, after) < -0.95) throw new Error('彎管路徑折返，請重新辨認部件');
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(before, after))));
    const radius = Math.max(...spec.section_mm!, ...(spec.end_section_mm ?? spec.section_mm!)) / 2;
    if (i > 0 && i < path.length - 1 && radius * Math.tan(angle / 2) >= Math.min(lengths[i], lengths[i + 1]) * 0.9) throw new Error('彎管轉角過急或截面過大，請重新辨認部件');
    const tangent = unit(before.map((n, k) => n + after[k]) as Vec3);
    const seed: Vec3 = previous ?? (Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
    let projected = seed.map((n, k) => n - dot(seed, tangent) * tangent[k]) as Vec3;
    if (Math.hypot(...projected) < 0.001) projected = cross(tangent, Math.abs(tangent[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const u = unit(projected); previous = u;
    const v = cross(tangent, u);
    const dims = spec.section_mm!.map((n, k) => n + ((spec.end_section_mm ?? spec.section_mm!)[k] - n) * distance / total);
    const ring: [number, number][] = spec.section === 'round' ? ellipse(dims[0] / 2, dims[1] / 2, 16) : [[-dims[0]/2,-dims[1]/2],[dims[0]/2,-dims[1]/2],[dims[0]/2,dims[1]/2],[-dims[0]/2,dims[1]/2]];
    return ring.map(([a,b]) => p.map((n,k) => (spec.center_mm[k] - shift[k] + (n + u[k]*a + v[k]*b)*(spec.geometry_scale?.[k] ?? 1))*scale[k]) as Vec3);
  });
  const faces: Vec3[][] = [[...rings[0]].reverse(), rings[rings.length - 1]];
  for (let i=0;i<rings.length-1;i++) for (let j=0;j<rings[i].length;j++) {
    const k=(j+1)%rings[i].length;
    // Split non-planar bent side quads, so every exporter receives the same planar faces.
    faces.push([rings[i][j],rings[i][k],rings[i+1][k]], [rings[i][j],rings[i+1][k],rings[i+1][j]]);
  }
  const pts=faces.flat();
  const lo=[0,1,2].map(k=>Math.min(...pts.map(p=>p[k])));
  const hi=[0,1,2].map(k=>Math.max(...pts.map(p=>p[k])));
  return { id, name:spec.name, size_mm:hi.map((n,k)=>n-lo[k]) as Vec3, position_mm:hi.map((n,k)=>(n+lo[k])/2) as Vec3, faces_mm:faces };
}

function soundBounds(specs: CustomPartSpec[]): { min: Vec3; max: Vec3; kept: boolean[] } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const kept = specs.map((spec, i) => {
    const p = specPart(spec, i, [1, 1, 1], [0, 0, 0]);
    if (!facesSound(p)) throw new Error(`部件「${spec.name}」無法建立完整幾何，請重新辨認部件`);
    for (const face of p.faces_mm) {
      for (const pt of face) {
        for (let k = 0; k < 3; k += 1) {
          min[k] = Math.min(min[k], pt[k]);
          max[k] = Math.max(max[k], pt[k]);
        }
      }
    }
    return true;
  });
  return kept.some(Boolean) ? { min, max, kept } : null;
}

/** Overall width × depth × height of the parts that will be built, or null when none will. */
export function customPartsSize(specs: CustomPartSpec[]): Vec3 | null {
  const b = soundBounds(specs);
  return b ? (b.max.map((n, i) => Math.round(n - b.min[i])) as Vec3) : null;
}

const AXIS_LABEL = ['闊', '深', '高'] as const;
/** Part edges closer than this share of the overall extent follow that boundary. */
const EDGE_ANCHOR = 0.35;

export function specBounds(spec: CustomPartSpec): { min: Vec3; max: Vec3 } {
  const pts = specPart(spec, 0, [1, 1, 1], [0, 0, 0]).faces_mm.flat();
  return {
    min: [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))) as Vec3,
    max: [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))) as Vec3,
  };
}

/** Scales a loft about its centre along one model axis; the smooth curve scales with its control points. */
export function scaleLoft(spec: CustomPartSpec, k: number, ratio: number): CustomPartSpec {
  const along = AXIS_INDEX[spec.axis!];
  const j = along === k ? -1 : PLANE[spec.axis!].indexOf(k);
  const out: CustomPartSpec = {
    ...spec,
    sections_mm: spec.sections_mm!.map((s) => ({
      at: j === -1 ? s.at * ratio : s.at,
      points_mm: s.points_mm.map((pt) => pt.map((n, i) => (i === j ? n * ratio : n)) as [number, number]),
    })),
  };
  out.size_mm = loftPart(out, 'scaled', [1, 1, 1], [0, 0, 0]).size_mm;
  return out;
}

export function moveAlong(spec: CustomPartSpec, k: number, delta: number): CustomPartSpec {
  const center_mm = [...spec.center_mm] as Vec3;
  center_mm[k] = round(center_mm[k] + delta);
  return { ...spec, center_mm };
}

/** Resize one part along one axis so its bounds become [lo, hi], keeping its section elsewhere. */
export function stretchAlong(spec: CustomPartSpec, k: number, lo: number, hi: number): CustomPartSpec | null {
  const size = hi - lo;
  const before = specBounds(spec);
  const oldSize = before.max[k] - before.min[k];
  if (spec.shape === 'sweep') {
    const path = spec.path_mm!;
    const span = Math.max(...path.map((p) => p[k])) - Math.min(...path.map((p) => p[k]));
    // A tube whose centreline does not run along this axis cannot stretch without changing its section.
    if (span < 1) return null;
    const withRatio = (r: number): CustomPartSpec => ({ ...spec, path_mm: path.map((p) => p.map((n, j) => (j === k ? n * r : n)) as Vec3) });
    const extent = (r: number) => { const b = specBounds(withRatio(r)); return b.max[k] - b.min[k]; };
    let r0 = 1, f0 = oldSize - size;
    let r1 = Math.max(0.001, (size - (oldSize - span)) / span), f1 = extent(r1) - size;
    for (let i = 0; i < 8 && Math.abs(f1) > 0.01 && Math.abs(f1 - f0) > 1e-9; i++) {
      const r2 = Math.max(0.001, r1 - (f1 * (r1 - r0)) / (f1 - f0));
      r0 = r1; f0 = f1; r1 = r2; f1 = extent(r1) - size;
    }
    const out = withRatio(r1);
    const b = specBounds(out);
    out.size_mm = b.max.map((n, j) => round(n - b.min[j])) as Vec3;
    return moveAlong(out, k, lo - b.min[k]);
  }
  if (spec.shape === 'loft') {
    const out = scaleLoft(spec, k, oldSize > 0 ? size / oldSize : 1);
    const b = specBounds(out);
    return moveAlong(out, k, lo - b.min[k]);
  }
  const out: CustomPartSpec = { ...spec, size_mm: [...spec.size_mm] as Vec3, center_mm: [...spec.center_mm] as Vec3 };
  out.size_mm[k] = round(size);
  if (spec.shape === 'profile' && spec.points_mm && spec.axis && AXIS_INDEX[spec.axis] !== k) {
    const j = PLANE[spec.axis].indexOf(k);
    const ratio = oldSize > 0 ? size / oldSize : 1;
    out.points_mm = spec.points_mm.map((pt) => pt.map((n, i) => (i === j ? round(n * ratio) : n)) as [number, number]);
  }
  const after = specBounds(out);
  out.center_mm[k] = round(out.center_mm[k] + lo - after.min[k]);
  return out;
}

export interface ConstraintFit {
  parts: CustomPartSpec[];
  /** Concrete contradictions: which part, which axis, which numbers. Empty when the fit holds. */
  conflicts: string[];
}

/**
 * Fit the parts to width × depth × height by constraints rather than by scaling every vertex:
 * each part edge follows the overall boundary it sits on (or the centre), so a wider desk gets
 * a wider top while legs keep their section and their distance from the edge. Axes listed in
 * `locked_axes` never change size. Deterministic: the same parts and size give the same result.
 */
export function fitCustomPartsWithConstraints(specs: CustomPartSpec[], w: number, d: number, h: number): ConstraintFit {
  const b = soundBounds(specs);
  if (!b) return { parts: specs, conflicts: [] };
  const target: Vec3 = [w, d, h];
  const conflicts: string[] = [];
  type Plan = { lo: number; hi: number; stretch: boolean } | null;
  // Plan first from where each part sat originally, then apply; anchors never drift.
  const plans: Plan[][] = specs.map((spec) => {
    const own = specBounds(spec);
    return [0, 1, 2].map((k): Plan => {
      const extent = b.max[k] - b.min[k];
      if (!(target[k] > 0) || extent < 1) return null;
      const newMin = k === 2 ? 0 : -target[k] / 2;
      const newMax = newMin + target[k];
      const mid = (b.min[k] + b.max[k]) / 2, newMid = (newMin + newMax) / 2;
      const place = (e: number) => {
        const t = (e - b.min[k]) / extent;
        if (t <= EDGE_ANCHOR) return newMin + (e - b.min[k]);
        if (t >= 1 - EDGE_ANCHOR) return newMax - (b.max[k] - e);
        return newMid + (e - mid);
      };
      const lo = place(own.min[k]), hi = place(own.max[k]);
      const oldSize = own.max[k] - own.min[k];
      const locked = spec.locked_axes?.includes((['x', 'y', 'z'] as const)[k]);
      if (locked && oldSize > target[k] + 1) conflicts.push(`「${spec.name}」已鎖定${AXIS_LABEL[k]} ${round(oldSize)} mm，大於整體${AXIS_LABEL[k]} ${round(target[k])} mm`);
      if (locked || Math.abs(hi - lo - oldSize) < 0.05) return { lo, hi, stretch: false };
      if (hi - lo < 3) {
        conflicts.push(`「${spec.name}」的${AXIS_LABEL[k]}會被壓縮至 ${round(Math.max(0, hi - lo))} mm，請修正整體尺寸或鎖定其他零件`);
        return { lo, hi, stretch: false };
      }
      return { lo, hi, stretch: true };
    });
  });
  const apply = (spec: CustomPartSpec, plan: Plan[], report: boolean): CustomPartSpec => {
    let out = spec;
    plan.forEach((step, k) => {
      if (!step) return;
      let stretched: CustomPartSpec | null = null;
      if (step.stretch) {
        try { stretched = stretchAlong(out, k, step.lo, step.hi); } catch { stretched = null; }
        if (!stretched && report) conflicts.push(`「${spec.name}」不能沿${AXIS_LABEL[k]}方向拉伸而不改變截面，請改由零件尺寸調整`);
      }
      if (stretched) { out = stretched; return; }
      const cur = specBounds(out);
      out = moveAlong(out, k, (step.lo + step.hi) / 2 - (cur.min[k] + cur.max[k]) / 2);
    });
    return out;
  };
  const parts = specs.map((spec, i) => {
    let out = apply(spec, plans[i], true);
    // A slanted tube stretched along one axis also changes its extent on the others.
    for (let pass = 0; out.shape === 'sweep' && pass < 6; pass++) {
      const cur = specBounds(out);
      const off = plans[i].some((step, k) => step && (step.stretch
        ? Math.abs(cur.min[k] - step.lo) > 0.05 || Math.abs(cur.max[k] - step.hi) > 0.05
        : Math.abs((cur.min[k] + cur.max[k]) / 2 - (step.lo + step.hi) / 2) > 0.05));
      if (!off) break;
      out = apply(out, plans[i], false);
    }
    return out;
  });
  const fitted = soundBounds(parts);
  if (fitted) {
    for (let k = 0; k < 3; k++) {
      const size = fitted.max[k] - fitted.min[k];
      if (target[k] > 0 && Math.abs(size - target[k]) > 1) conflicts.push(`按約束重建後整體${AXIS_LABEL[k]}為 ${round(size)} mm，與確認的 ${round(target[k])} mm 不符`);
    }
  }
  return { parts, conflicts: [...new Set(conflicts)] };
}

/**
 * Overall-size fit used when the AI answers or the user changes width, depth or height.
 * Deleting or resizing one part afterwards must not stretch the rest.
 */
export function fitCustomParts(specs: CustomPartSpec[], w: number, d: number, h: number): CustomPartSpec[] {
  return fitCustomPartsWithConstraints(specs, w, d, h).parts;
}

/** Parts keep their own sizes; only centred on the floor plan and stood on the floor. */
function customComponents(specs: CustomPartSpec[]): ModelPart[] {
  const b = soundBounds(specs);
  if (!b) throw new Error('沒有有效部件，請重新辨認部件');
  const shift: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
  return specs.flatMap((spec, i) => (b.kept[i] ? [specPart(spec, i, [1, 1, 1], shift)] : []));
}

function components(kind: FurnitureKind, w: number, d: number, h: number, style: ModelStyle, parts: CustomPartSpec[] = []): ModelPart[] {
  switch (kind) {
    case 'custom':
      return customComponents(parts);
    case 'desk':
      return isWorkstation(style, h) ? workstationComponents(w, d, h, style) : tableComponents(kind, w, d, h, style);
    case 'conference':
    case 'dining':
    case 'coffee':
      return tableComponents(kind, w, d, h, { ...style, top: style.top === 'L' ? 'rect' : style.top });
    case 'bar_counter':
      return counterComponents(w, d, h);
    case 'reception':
      return receptionComponents(w, d, h);
    case 'lectern':
      return lecternComponents(w, d, h);
    case 'cabinet':
      return cabinetComponents(w, d, h, style);
    case 'pedestal':
      return pedestalComponents(w, d, h, style);
    case 'shelf':
      return shelfComponents(w, d, h, style);
    case 'office_chair':
    case 'side_chair':
      if (style.chair_base === 'star') return officeChairComponents(w, d, h, style);
      if (style.chair_base === 'sled') return sledChairComponents(w, d, h, style);
      return sideChairComponents(w, d, h, style);
    case 'stool':
      return stoolComponents(w, d, h, style);
    case 'beam_seating':
      return beamSeatingComponents(w, d, h, style);
    case 'sofa':
      return sofaComponents(w, d, h, style);
    case 'booth':
      return boothComponents(w, d, h, style);
    case 'phone_booth':
      return phoneBoothComponents(w, d, h);
  }
}

/** Kind-specific defaults for counts and options, scaled to the size. */
export function defaultStyle(kind: FurnitureKind, w: number, d: number, h: number): ModelStyle {
  const base = { ...DEFAULT_MODEL_STYLE };
  switch (kind) {
    case 'desk':
      return { ...base, seats: 1, drawers: 0 };
    case 'dining':
      return { ...base, top: Math.abs(w - d) < 100 ? 'round' : 'rect', legs: Math.abs(w - d) < 100 ? 'pedestal' : 'four' };
    case 'cabinet':
      return { ...base, doors: w >= 600 ? 2 : 1, drawers: 0, shelves: Math.max(0, Math.round((h - 36) / 350) - 1) };
    case 'pedestal':
      return { ...base, drawers: 3 };
    case 'shelf':
      return { ...base, shelves: clamp(Math.round(h / 360) - 1, 1, 6) };
    case 'office_chair':
      return { ...base, arms: true, chair_base: 'star' };
    case 'stool':
      return { ...base, legs: 'pedestal' };
    case 'beam_seating':
      return { ...base, seats: clamp(Math.round(w / 550), 1, 8) };
    case 'sofa':
      return { ...base, seats: clamp(Math.round((w - 300) / 650), 1, 6), arms: true };
    case 'booth':
      return { ...base, seats: clamp(Math.round(w / 600), 1, 8) };
    default:
      return base;
  }
}

/** Image arrangements and catalogue model names must not select a multi-desk output.
 * The user can explicitly increase workstations in the confirmation form afterwards. */
export function initialModelStyle(kind: FurnitureKind | null, text: string, imageStyle?: Partial<ModelStyle> | null): Partial<ModelStyle> {
  const style = { ...inferModelStyle(text) };
  for (const [field, value] of Object.entries(imageStyle ?? {})) {
    if (value !== undefined && value !== null) (style as Record<string, unknown>)[field] = value;
  }
  if (kind === 'desk') style.seats = 1;
  return style;
}

/** Defaults for the kind, overridden by whatever was read or chosen. */
export function resolveStyle(kind: FurnitureKind, w: number, d: number, h: number, hints?: Partial<ModelStyle> | null): ModelStyle {
  const style = defaultStyle(kind, w, d, h);
  for (const field of STYLE_FIELDS[kind]) {
    const value = hints?.[field];
    if (value !== undefined && value !== null) (style as unknown as Record<string, unknown>)[field] = value;
  }
  for (const field of ['doors', 'drawers', 'shelves', 'seats'] as const) {
    const [min, max] = STYLE_LIMITS[field];
    style[field] = clamp(Math.round(Number(style[field]) || 0), min, max);
  }
  // Workstations stand on end panels unless legs were read or chosen.
  if (kind === 'desk' && hints?.legs == null && isWorkstation(style, h)) style.legs = 'panel';
  return style;
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
  style?: Partial<ModelStyle> | null;
  /** custom only; unchecked input is fine, it goes through sanitizeCustomParts. */
  parts?: unknown;
}): ParametricModel {
  const [dw, dd, dh] = DEFAULTS[input.kind];
  const estimated = new Set<SizeAxis>(input.estimated_axes ?? []);
  const width = axis(input.width_mm, dw, 250, 6000, estimated.has('width'));
  const depth = axis(input.depth_mm, dd, 250, 4000, estimated.has('depth'));
  const height = axis(input.height_mm, dh, 300, 2800, estimated.has('height'));
  const estimated_axes: SizeAxis[] = [];
  if (width.estimated) estimated_axes.push('width');
  if (depth.estimated) estimated_axes.push('depth');
  if (height.estimated) estimated_axes.push('height');
  const style = resolveStyle(input.kind, width.mm, depth.mm, height.mm, input.style);
  const parts = input.kind === 'custom' ? sanitizeCustomParts(input.parts) : [];
  if (input.kind === 'custom' && parts.length === 0) throw new Error('沒有有效部件，請重新辨認部件');
  return {
    kind: input.kind,
    supported: true,
    label: LABEL[input.kind],
    width_mm: width.mm,
    depth_mm: depth.mm,
    height_mm: height.mm,
    estimated_axes,
    ...(STYLE_FIELDS[input.kind].length > 0 ? { style } : {}),
    ...(input.kind === 'custom' ? { custom_parts: parts } : {}),
    components: components(input.kind, width.mm, depth.mm, height.mm, style, parts),
    engine_version: PARAMETRIC_ENGINE_VERSION,
  };
}

/**
 * Keyword → kind. When several match, the one ending last wins (Chinese names put the head noun
 * last: 「活動櫃辦公枱」 is a desk); on a tie the earlier, more specific entry wins.
 */
const KIND_PATTERNS: [FurnitureKind, RegExp][] = [
  ['phone_booth', /靜音倉|静音仓|電話亭|电话亭|phone ?booth|quiet pod/g],
  ['booth', /卡座|booth/g],
  ['reception', /前台|前枱|接待(台|枱|桌)|reception( desk)?/g],
  ['lectern', /講台|讲台|演講台|lectern|podium/g],
  ['stool', /吧椅|吧凳|吧台椅|bar ?stool|stool/g],
  ['bar_counter', /吧台|吧枱|bar counter/g],
  ['beam_seating', /排椅|禮堂椅|礼堂椅|機場椅|等候椅|beam seating|auditorium/g],
  ['sofa', /梳化|沙發|沙发|sofa|couch/g],
  ['office_chair', /大班椅|員工椅|员工椅|電競椅|电竞椅|辦公椅|办公椅|職員椅|老闆椅|轉椅|网椅|網椅|office chair|gaming chair/g],
  ['side_chair', /椅|chair/g],
  ['coffee', /茶几|茶枱|茶台|茶桌|coffee table|side table/g],
  ['dining', /餐(桌|枱|台)|洽談(桌|枱|台)|dining( table)?/g],
  ['conference', /會議(桌|枱|台)?|会议(桌|台)?|conference( table)?|meeting table/g],
  ['pedestal', /活動櫃|活动柜|移動櫃|pedestal/g],
  ['shelf', /書架|书架|層架|层架|置物架|bookcase|shelf|shelving/g],
  ['cabinet', /櫃|柜|cabinet|locker|wardrobe/g],
  ['desk', /桌|枱|台|desk|table|workstation/g],
];

export function inferFurnitureKind(text: string | null | undefined): FurnitureKind | null {
  const value = (text ?? '').toLowerCase();
  let best: { kind: FurnitureKind; end: number } | null = null;
  for (const [kind, pattern] of KIND_PATTERNS) {
    for (const match of value.matchAll(pattern)) {
      const end = (match.index ?? 0) + match[0].length;
      if (!best || end > best.end) best = { kind, end };
    }
  }
  return best?.kind ?? null;
}

/**
 * First field that names exactly one kind wins. A field listing two kinds
 * (category 「吧台、吧椅」) is skipped so the next field decides.
 */
export function inferFurnitureKindFrom(fields: (string | null | undefined)[]): FurnitureKind | null {
  for (const field of fields) {
    const pieces = (field ?? '').split(/[、,，/|]/);
    const kinds = new Set(pieces.map((piece) => inferFurnitureKind(piece)).filter((kind): kind is FurnitureKind => kind != null));
    if (kinds.size === 1) return [...kinds][0];
  }
  return null;
}

const CN_DIGITS: Record<string, number> = { 一: 1, 單: 1, 单: 1, 二: 2, 兩: 2, 两: 2, 雙: 2, 双: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 };

function countBefore(text: string, suffix: RegExp): number | undefined {
  const match = text.match(new RegExp(`(\\d|[一單单二兩两雙双三四五六七八])\\s*${suffix.source}`));
  if (!match) return undefined;
  return /\d/.test(match[1]) ? Number(match[1]) : CN_DIGITS[match[1]];
}

/** Structure hints the product name states outright. */
export function inferModelStyle(text: string): Partial<ModelStyle> {
  const hints: Partial<ModelStyle> = {};
  if (/船形|船型|boat/.test(text)) hints.top = 'boat';
  else if (/圓(桌|枱|形)|圆(桌|形)|round/i.test(text)) hints.top = 'round';
  else if (/直款|直型|一字/.test(text)) hints.top = 'rect';
  else if (/L\s*[型形款]|L-?shaped|乾字|F\s*[型形]/i.test(text)) hints.top = 'L';
  if (/板腳|板脚/.test(text)) hints.legs = 'panel';
  else if (/中柱|單腳|单脚|pedestal/i.test(text)) hints.legs = 'pedestal';
  else if (/四[腳脚]|four[ -]?leg/i.test(text)) hints.legs = 'four';
  if (/線盒|线盒|走線|走线/.test(text)) hints.cable_tray = true;
  if (/屏風|屏风|partition|screen/i.test(text)) hints.screen = true;
  if (/四[腳脚]|four[ -]?leg|(?:非|無|无|不是)\s*(?:弓字|弓形)/i.test(text)) hints.chair_base = 'four';
  else if (/弓字|弓形|sled|cantilever/i.test(text)) hints.chair_base = 'sled';
  else if (/五星|five-star|star base|轉椅|转椅/i.test(text)) hints.chair_base = 'star';
  if (/扶手|armrest/i.test(text)) hints.arms = true;
  if (/無扶手|无扶手|armless/i.test(text)) hints.arms = false;
  const seats = countBefore(text, /(人位|人|座)/);
  if (seats) hints.seats = seats;
  else if (/乾字|十字/.test(text)) hints.seats = 4;
  else if (/F\s*[型形]|T\s*字/i.test(text)) hints.seats = 2;
  const drawers = countBefore(text, /(抽|斗)/);
  if (drawers !== undefined) hints.drawers = drawers;
  else if (/活動櫃|活动柜|移動櫃|移动柜|pedestal/i.test(text)) hints.drawers = 3;
  const doors = countBefore(text, /門|门/);
  if (doors !== undefined) hints.doors = doors;
  if (/開放|开放|open/i.test(text) && doors === undefined) hints.doors = 0;
  if (/貨架|货架|角鋼|角钢|倉庫架|仓库架|鐵架|铁架|rack|boltless/i.test(text)) hints.frame = true;
  return hints;
}

/**
 * Total levels a shelf name states (三層, 3-tier), top and bottom boards included.
 * The shelf template's `shelves` is that number minus 2.
 */
export function inferShelfTiers(text: string): number | undefined {
  const match = text.match(/(\d+|[一二兩两雙双三四五六七八九十])\s*-?\s*(層|层|tier)/i);
  if (!match) return undefined;
  const n = /\d/.test(match[1]) ? Number(match[1]) : match[1] === '九' ? 9 : match[1] === '十' ? 10 : CN_DIGITS[match[1]];
  return n >= 2 && n <= 10 ? n : undefined;
}

/** @deprecated use inferModelStyle. */
export const inferTableStyle = inferModelStyle;

export type FurnitureKind = 'desk' | 'conference' | 'shelf' | 'cabinet';
export type SizeAxis = 'width' | 'depth' | 'height';

export interface ModelPart {
  id: string;
  name: string;
  /** Width, depth, height in millimetres. */
  size_mm: [number, number, number];
  /** Center of the box. X/Y are centered on the floor plan; Z is up from the floor. */
  position_mm: [number, number, number];
}

export interface ParametricModel {
  kind: FurnitureKind;
  supported: true;
  label: string;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  estimated_axes: SizeAxis[];
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

function axis(value: number | null | undefined, fallback: number, min: number, max: number): { mm: number; estimated: boolean } {
  if (value == null || !Number.isFinite(value) || value <= 0) return { mm: fallback, estimated: true };
  return { mm: clamp(value, min, max), estimated: false };
}

function part(
  id: string,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
): ModelPart {
  return { id, name, size_mm: size.map((n) => Math.round(n)) as [number, number, number], position_mm: position.map((n) => Math.round(n)) as [number, number, number] };
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

function components(kind: FurnitureKind, w: number, d: number, h: number): ModelPart[] {
  if (kind === 'desk' || kind === 'conference') {
    const topT = 25;
    const leg = kind === 'conference' ? 60 : 40;
    const inset = kind === 'conference' ? 80 : 50;
    const out = [
      part('top', '桌面', [w, d, topT], [0, 0, h - topT / 2]),
      ...legs(w, d, h, topT, leg, inset),
    ];
    if (kind === 'conference') {
      out.push(part('beam', '橫樑', [w - inset * 2, 40, 40], [0, 0, 140]));
    }
    return out;
  }
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
}): ParametricModel {
  const [dw, dd, dh] = DEFAULTS[input.kind];
  const width = axis(input.width_mm, dw, 400, 6000);
  const depth = axis(input.depth_mm, dd, 250, 2400);
  const height = axis(input.height_mm, dh, 400, 2800);
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
    components: components(input.kind, width.mm, depth.mm, height.mm),
  };
}

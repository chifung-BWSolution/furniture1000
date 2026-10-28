import { moveAlong, specBounds, stretchAlong, type CustomPartSpec } from './furnitureParametric';

/** Structure-derived sizes the PRD names besides width, depth and height. */
export interface KeyDimension {
  key: string;
  label: string;
  value_mm: number;
  /** Indices of the parts the value is measured on. */
  parts: number[];
}

/** Faces closer than this are treated as touching. */
const TOUCH_MM = 2;
const round = (n: number) => Math.round(n * 10) / 10;

function largest(parts: CustomPartSpec[], role: CustomPartSpec['role']): number {
  let best = -1;
  let area = 0;
  parts.forEach((part, i) => {
    if (part.role !== role) return;
    const b = specBounds(part);
    const a = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]);
    if (a > area) { area = a; best = i; }
  });
  return best;
}

const centre = (part: CustomPartSpec, k: number) => {
  const b = specBounds(part);
  return (b.min[k] + b.max[k]) / 2;
};

function legIndices(parts: CustomPartSpec[]): number[] {
  return parts.flatMap((part, i) => (part.role === 'leg' ? [i] : []));
}

function shelfIndices(parts: CustomPartSpec[]): number[] {
  return parts
    .flatMap((part, i) => (part.role === 'shelf' ? [i] : []))
    .sort((a, b) => specBounds(parts[a]).max[2] - specBounds(parts[b]).max[2]);
}

/** Read the key dimensions off the current parts. Template kinds have none: only overall size applies. */
export function deriveKeyDimensions(parts: CustomPartSpec[]): KeyDimension[] {
  const out: KeyDimension[] = [];
  const top = largest(parts, 'top');
  if (top >= 0) {
    const b = specBounds(parts[top]);
    out.push({ key: 'top_thickness', label: '面板厚', value_mm: round(b.max[2] - b.min[2]), parts: [top] });
  }
  const legs = legIndices(parts);
  if (legs.length >= 2) {
    for (const [k, key, label] of [[0, 'leg_span_x', '腳距（闊向，中至中）'], [1, 'leg_span_y', '腳距（深向，中至中）']] as const) {
      const cs = legs.map((i) => centre(parts[i], k));
      const span = Math.max(...cs) - Math.min(...cs);
      if (span >= 10) out.push({ key, label, value_mm: round(span), parts: legs });
    }
  }
  const seat = largest(parts, 'seat');
  if (seat >= 0) out.push({ key: 'seat_height', label: '座高', value_mm: round(specBounds(parts[seat]).max[2]), parts: [seat] });
  shelfIndices(parts).forEach((i, n) => {
    out.push({ key: `shelf_${n + 1}`, label: `第 ${n + 1} 層板面高`, value_mm: round(specBounds(parts[i]).max[2]), parts: [i] });
  });
  return out;
}

export interface KeyFit {
  parts: CustomPartSpec[];
  conflicts: string[];
}

/**
 * Apply confirmed key dimensions after the overall fit. Each change follows the structure:
 * a thinner top keeps its upper face and the parts under it reach up to the new underside;
 * a new seat height lifts the seat and everything on it while supports stretch; leg spacing
 * moves the legs and stretches rails between them. Values that cannot hold are named.
 */
export function applyKeyDimensions(input: CustomPartSpec[], values: Record<string, number>): KeyFit {
  let parts = input.map((part) => part);
  const conflicts: string[] = [];
  const current = () => Object.fromEntries(deriveKeyDimensions(parts).map((d) => [d.key, d]));
  // Keep shelf identity stable even when a height edit changes their vertical order.
  const originalDimensions = current();
  const stretchOrReport = (i: number, k: number, lo: number, hi: number, why: string) => {
    const bounds = specBounds(parts[i]);
    if (parts[i].locked_axes?.includes((['x', 'y', 'z'] as const)[k]) && Math.abs(hi - lo - (bounds.max[k] - bounds.min[k])) > 0.05) {
      conflicts.push(`${why}：與「${parts[i].name}」已鎖定的${['闊', '深', '高'][k]}衝突`);
      return;
    }
    if (hi - lo < 3) {
      conflicts.push(`${why}：「${parts[i].name}」會被壓縮至 ${round(Math.max(0, hi - lo))} mm`);
      return;
    }
    let next: CustomPartSpec | null = null;
    try { next = stretchAlong(parts[i], k, lo, hi); } catch { next = null; }
    if (next) {
      const after = specBounds(next);
      const changedLock = parts[i].locked_axes?.some(axis => {
        const j = ['x', 'y', 'z'].indexOf(axis);
        return Math.abs(after.max[j] - after.min[j] - (bounds.max[j] - bounds.min[j])) > 0.05;
      });
      if (changedLock) conflicts.push(`${why}：會改變「${parts[i].name}」已鎖定的截面尺寸`);
      else parts[i] = next;
    } else conflicts.push(`${why}：「${parts[i].name}」不能在不改截面的情況下拉伸`);
  };

  const thickness = values.top_thickness;
  const topDim = current().top_thickness;
  if (thickness != null && topDim && Math.abs(thickness - topDim.value_mm) > 0.05) {
    const why = `面板厚 ${thickness} mm`;
    const i = topDim.parts[0];
    const b = specBounds(parts[i]);
    const newBottom = b.max[2] - thickness;
    if (thickness < 3) conflicts.push(`${why}過薄`);
    else {
      stretchOrReport(i, 2, newBottom, b.max[2], why);
      parts.forEach((part, j) => {
        if (j === i) return;
        const pb = specBounds(part);
        const sameProduct = part.product_index === parts[i].product_index;
        const beneath = [0, 1].every(k => Math.min(pb.max[k], b.max[k]) - Math.max(pb.min[k], b.min[k]) > 0);
        if (sameProduct && beneath && Math.abs(pb.max[2] - b.min[2]) <= TOUCH_MM) stretchOrReport(j, 2, pb.min[2], newBottom, why);
      });
    }
  }

  const seatHeight = values.seat_height;
  const seatDim = current().seat_height;
  if (seatHeight != null && seatDim && Math.abs(seatHeight - seatDim.value_mm) > 0.05) {
    const why = `座高 ${seatHeight} mm`;
    const delta = seatHeight - seatDim.value_mm;
    const sb = specBounds(parts[seatDim.parts[0]]);
    const lifted = parts.map((part) => specBounds(part).min[2] >= sb.min[2] - TOUCH_MM);
    parts = parts.map((part, j) => (lifted[j] ? moveAlong(part, 2, delta) : part));
    parts.forEach((part, j) => {
      if (lifted[j]) return;
      const pb = specBounds(part);
      // Supports end at the old seat underside; parts rising past it (back posts) keep their foot.
      if (pb.max[2] >= sb.min[2] - TOUCH_MM) stretchOrReport(j, 2, pb.min[2], pb.max[2] + delta, why);
    });
  }

  for (const [key, want] of Object.entries(values)) {
    if (!/^shelf_\d+$/.test(key)) continue;
    const dim = originalDimensions[key];
    if (!dim || Math.abs(want - dim.value_mm) <= 0.05) continue;
    const i = dim.parts[0];
    parts[i] = moveAlong(parts[i], 2, want - dim.value_mm);
    const b = specBounds(parts[i]);
    if (b.min[2] < 0) conflicts.push(`${dim.label} ${want} mm 令「${parts[i].name}」低於地面`);
  }

  for (const [k, key] of [[0, 'leg_span_x'], [1, 'leg_span_y']] as const) {
    const want = values[key];
    const dim = current()[key];
    if (want == null || !dim || Math.abs(want - dim.value_mm) <= 0.05) continue;
    const legs = dim.parts;
    const cs = legs.map((i) => centre(parts[i], k));
    const lo = Math.min(...cs), hi = Math.max(...cs);
    const mid = (lo + hi) / 2;
    const scale = want / (hi - lo);
    const legSet = new Set(legs);
    const loShift = (lo - mid) * scale - (lo - mid);
    const hiShift = (hi - mid) * scale - (hi - mid);
    // Rails joined to legs on both sides follow the legs' new positions.
    parts.forEach((part, j) => {
      if (legSet.has(j) || part.role === 'top' || part.role === 'seat') return;
      const joined = (part.connects_to ?? []).filter((n) => legSet.has(n));
      const sides = new Set(joined.map((n) => Math.sign(centre(parts[n], k) - mid)));
      if (!(sides.has(-1) && sides.has(1))) return;
      const pb = specBounds(part);
      stretchOrReport(j, k, pb.min[k] + loShift, pb.max[k] + hiShift, dim.label);
    });
    legs.forEach((i) => {
      const c = centre(parts[i], k);
      parts[i] = moveAlong(parts[i], k, (c - mid) * scale - (c - mid));
    });
    const cover = largest(parts, 'top') >= 0 ? largest(parts, 'top') : largest(parts, 'seat');
    if (cover >= 0) {
      const cb = specBounds(parts[cover]);
      const outside = legs.some((i) => {
        const b = specBounds(parts[i]);
        return b.min[k] < cb.min[k] - TOUCH_MM || b.max[k] > cb.max[k] + TOUCH_MM;
      });
      if (outside) conflicts.push(`${dim.label} ${want} mm 令腳超出「${parts[cover].name}」${['闊', '深'][k]} ${round(cb.max[k] - cb.min[k])} mm`);
    }
  }
  // Later constraints can affect earlier ones (e.g. a bent support's two spans).
  // Measure the final geometry instead of assuming each requested value held.
  const finalDimensions = current();
  for (const [key, wanted] of Object.entries(values)) {
    const original = originalDimensions[key];
    if (!original) continue;
    const actual = /^shelf_\d+$/.test(key)
      ? specBounds(parts[original.parts[0]]).max[2]
      : finalDimensions[key]?.value_mm;
    if (actual == null || !Number.isFinite(wanted) || Math.abs(actual - wanted) > 1) {
      conflicts.push(`${original.label}重建後為 ${actual == null ? '無法量度' : round(actual)} mm，與確認的 ${wanted} mm 不符`);
    }
  }
  return { parts, conflicts: [...new Set(conflicts)] };
}

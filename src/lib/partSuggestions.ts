import type { CustomPartSpec } from './furnitureParametric';

/** Give every part a stable id so edits, locks and AI suggestions refer to the same part. */
export function ensurePartIds(parts: CustomPartSpec[]): CustomPartSpec[] {
  const used = new Set(parts.map((p) => p.part_id).filter(Boolean) as string[]);
  let n = 1;
  return parts.map((part) => {
    if (part.part_id) return part;
    while (used.has(`p${n}`)) n++;
    used.add(`p${n}`);
    return { ...part, part_id: `p${n}` };
  });
}

/** Copy of one part placed beside the original, with a new id and no joints yet. */
export function duplicatePart(parts: CustomPartSpec[], index: number): CustomPartSpec[] {
  const source = parts[index];
  if (!source) return parts;
  const copy: CustomPartSpec = {
    ...structuredClone(source),
    part_id: undefined,
    name: `${source.name}（複製）`.slice(0, 40),
    center_mm: [source.center_mm[0] + source.size_mm[0] + 20, source.center_mm[1], source.center_mm[2]],
    connects_to: [],
  };
  return ensurePartIds([...parts, copy]);
}

/** Parts that name this one as a joint; shown before a delete. */
export function referencesTo(parts: CustomPartSpec[], index: number): string[] {
  return parts.flatMap((part, i) => (i !== index && part.connects_to?.includes(index) ? [part.name] : []));
}

export function removePartAt(parts: CustomPartSpec[], index: number): CustomPartSpec[] {
  return parts.filter((_, i) => i !== index).map((part) => ({
    ...part,
    connects_to: part.connects_to?.filter((j) => j !== index).map((j) => (j > index ? j - 1 : j)),
  }));
}

/** Joints are symmetric: touching is a relation between two parts. */
export function setJoint(parts: CustomPartSpec[], a: number, b: number, joined: boolean): CustomPartSpec[] {
  const edit = (list: number[] | undefined, other: number) => {
    const set = new Set(list ?? []);
    if (joined) set.add(other);
    else set.delete(other);
    return [...set].sort((x, y) => x - y);
  };
  return parts.map((part, i) => (i === a ? { ...part, connects_to: edit(part.connects_to, b) } : i === b ? { ...part, connects_to: edit(part.connects_to, a) } : part));
}

export type PartChange = {
  id: string;
  kind: 'changed' | 'added' | 'removed';
  currentIndex?: number;
  nextIndex?: number;
  summary: string;
};

const fmt = (v: number[]) => v.map((n) => Math.round(n)).join('×');
const far = (a: number[], b: number[]) => a.some((n, i) => Math.abs(n - b[i]) > 1);

/** Pair each new part with an existing one: same id first, then same role nearest by position. */
function matchParts(current: CustomPartSpec[], next: CustomPartSpec[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const taken = new Set<number>();
  next.forEach((part, j) => {
    const i = part.part_id ? current.findIndex((c) => c.part_id === part.part_id) : -1;
    if (i >= 0 && !taken.has(i)) { pairs.set(j, i); taken.add(i); }
  });
  next.forEach((part, j) => {
    if (pairs.has(j)) return;
    let best = -1;
    let dist = Infinity;
    current.forEach((c, i) => {
      if (taken.has(i) || (c.role ?? 'other') !== (part.role ?? 'other')) return;
      const d = Math.hypot(...c.center_mm.map((n, k) => n - part.center_mm[k]));
      if (d < dist) { dist = d; best = i; }
    });
    if (best >= 0) { pairs.set(j, best); taken.add(best); }
  });
  return pairs;
}

/** What a new AI reading would change, one adoptable item per part. */
export function diffParts(current: CustomPartSpec[], next: CustomPartSpec[]): PartChange[] {
  const pairs = matchParts(current, next);
  const matched = new Set(pairs.values());
  const changes: PartChange[] = [];
  next.forEach((part, j) => {
    const i = pairs.get(j);
    if (i == null) {
      changes.push({ id: `add-${j}`, kind: 'added', nextIndex: j, summary: `新增「${part.name}」${fmt(part.size_mm)} mm` });
      return;
    }
    const c = current[i];
    const notes: string[] = [];
    if (c.shape !== part.shape) notes.push(`形狀 ${c.shape} → ${part.shape}`);
    if (far(c.size_mm, part.size_mm)) notes.push(`尺寸 ${fmt(c.size_mm)} → ${fmt(part.size_mm)}`);
    if (far(c.center_mm, part.center_mm)) notes.push(`位置 ${fmt(c.center_mm)} → ${fmt(part.center_mm)}`);
    if ((c.form ?? '') !== (part.form ?? '')) notes.push(`形態 ${c.form ?? '—'} → ${part.form ?? '—'}`);
    const joints = (ids: number[] | undefined, map: (n: number) => number | undefined) => (ids ?? []).map(map).filter((n) => n != null).sort().join(',');
    if (joints(c.connects_to, (n) => n) !== joints(part.connects_to, (n) => pairs.get(n))) notes.push('接合改變');
    if (notes.length) changes.push({ id: `chg-${i}`, kind: 'changed', currentIndex: i, nextIndex: j, summary: `「${c.name}」${notes.join('；')}` });
  });
  current.forEach((c, i) => {
    if (!matched.has(i)) changes.push({ id: `del-${i}`, kind: 'removed', currentIndex: i, summary: `移除「${c.name}」` });
  });
  return changes;
}

/** Apply only the adopted items; everything else stays as the person left it. */
export function applyPartChanges(current: CustomPartSpec[], next: CustomPartSpec[], adopted: ReadonlySet<string>): CustomPartSpec[] {
  const pairs = matchParts(current, next);
  const changes = diffParts(current, next).filter((c) => adopted.has(c.id));
  const removed = new Set(changes.filter((c) => c.kind === 'removed').map((c) => c.currentIndex!));
  const replaced = new Map(changes.filter((c) => c.kind === 'changed').map((c) => [c.currentIndex!, c.nextIndex!]));
  const added = changes.filter((c) => c.kind === 'added').map((c) => c.nextIndex!);
  const curToNew = new Map<number, number>();
  let n = 0;
  current.forEach((_, i) => { if (!removed.has(i)) curToNew.set(i, n++); });
  const addToNew = new Map(added.map((j) => [j, n++]));
  const nextToNew = (j: number) => addToNew.get(j) ?? (pairs.has(j) ? curToNew.get(pairs.get(j)!) : undefined);
  const mapJoints = (ids: number[] | undefined, map: (k: number) => number | undefined) =>
    [...new Set((ids ?? []).map(map).filter((k): k is number => k != null))];
  const out: CustomPartSpec[] = [];
  current.forEach((c, i) => {
    if (removed.has(i)) return;
    const j = replaced.get(i);
    if (j == null) out.push({ ...c, connects_to: mapJoints(c.connects_to, (k) => curToNew.get(k)) });
    else out.push({ ...next[j], part_id: c.part_id, locked_axes: c.locked_axes, connects_to: mapJoints(next[j].connects_to, nextToNew) });
  });
  for (const j of added) out.push({ ...next[j], part_id: undefined, connects_to: mapJoints(next[j].connects_to, nextToNew) });
  return ensurePartIds(out).map((part, i) => ({ ...part, connects_to: part.connects_to?.filter((k) => k !== i && k < out.length) }));
}

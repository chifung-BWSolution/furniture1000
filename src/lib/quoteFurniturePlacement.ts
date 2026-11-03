/** Position coordinates are percentages of the original floor-plan image. */
export type FurnitureBounds = { x: number; y: number; w: number; h: number };
export type FurniturePosition = {
  id: string; label: string; category: string; x: number; y: number;
  rect?: FurnitureBounds;
  angle: number | null; productId?: string; confidence?: number;
};
export type QuoteFurniturePlacements = {
  positions: Record<string, FurniturePosition[]>;
  assignments: Record<string, string[]>;
};

export function furnitureKind(value: string): string {
  const text = value.trim().toLowerCase();
  if (/辦公椅|办公椅|辦公座椅|办公座椅|電腦椅|电脑椅|office chair|task chair/.test(text)) return 'office-chair';
  if (/辦公桌|办公桌|辦公枱|办公枱|office desk|workstation/.test(text)) return 'office-desk';
  if (/儲物櫃|储物柜|storage cabinet|\bcabinet\b/.test(text)) return 'cabinet';
  if (/會議椅|会议椅|meeting chair|conference chair/.test(text)) return 'meeting-chair';
  return text;
}

/** Match only unambiguous categories; preserve existing selections and never reuse a position. */
export function matchFurniturePlacements(state: QuoteFurniturePlacements, zones: { id: string; products: { id: string; name: string; category?: string; quantity: number }[] }[], attempted: Set<string>): QuoteFurniturePlacements {
  const assignments = { ...state.assignments };
  const occupied = new Set(Object.values(assignments).flat().filter(Boolean));
  let changed = false;
  for (const zone of zones) {
    const products = zone.products.filter(p => furnitureKind(`${p.category || ''} ${p.name}`));
    for (const product of products) {
      if (assignments[product.id]?.some(Boolean)) { attempted.add(product.id); continue; }
      if (attempted.has(product.id)) continue;
      const kind = furnitureKind(`${product.category || ''} ${product.name}`);
      if (products.filter(p => furnitureKind(`${p.category || ''} ${p.name}`) === kind).length !== 1) continue;
      const matches = (state.positions[zone.id] || []).filter(p => !occupied.has(p.id) && furnitureKind(p.category) === kind).slice(0, Math.max(0, Math.floor(product.quantity)));
      if (!matches.length) continue;
      attempted.add(product.id);
      assignments[product.id] = matches.map(p => p.id);
      matches.forEach(p => occupied.add(p.id));
      changed = true;
    }
  }
  return changed ? { ...state, assignments } : state;
}

/** Reassign positions whose centres fall inside a different confirmed draft area. */
export function reassignFurnitureZones(state: QuoteFurniturePlacements, regions: { zoneId: string; rect: FurnitureBounds }[], productZones: { id: string; products: { id: string }[] }[]): QuoteFurniturePlacements {
  const positions: Record<string, FurniturePosition[]> = Object.fromEntries(Object.entries(state.positions).map(([id, list]) => [id, [...list]]));
  const assignments = Object.fromEntries(Object.entries(state.assignments).map(([id, values]) => [id, [...values]]));
  const productZone = new Map(productZones.flatMap(zone => zone.products.map(product => [product.id, zone.id] as const)));
  for (const [sourceId, list] of Object.entries(state.positions)) {
    for (const position of list) {
      const matches = regions.filter(({ rect }) => position.x >= rect.x && position.x <= rect.x + rect.w && position.y >= rect.y && position.y <= rect.y + rect.h);
      if (!matches.length || matches.some(region => region.zoneId === sourceId)) continue;
      matches.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h);
      const targetId = matches[0].zoneId;
      const target = positions[targetId] || [];
      const n = Math.max(0, ...target.map(p => Number(p.label.replace(/^P/, '')) || 0)) + 1;
      const newId = `${targetId}:P${n}`;
      positions[sourceId] = positions[sourceId].filter(p => p.id !== position.id);
      positions[targetId] = [...target, { ...position, id: newId, label: `P${n}`, productId: undefined, confidence: undefined }];
      for (const [productId, ids] of Object.entries(assignments)) {
        assignments[productId] = ids.map(id => id === position.id ? (productZone.get(productId) === targetId ? newId : '') : id);
      }
    }
  }
  return { positions, assignments };
}
export function parseFurniturePositions(value: unknown): FurniturePosition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((v, index) => {
    if (!v || typeof v !== 'object' || !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x < 0 || v.x > 100 || v.y < 0 || v.y > 100) return [];
    const id = typeof v.id === 'string' && /^(?:[A-Za-z0-9_-]+:)?P[1-9]\d*$/.test(v.id) ? v.id : `P${index + 1}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: id.split(':').at(-1) || id, category: typeof v.category === 'string' ? v.category.slice(0, 80) : '傢俬', x: v.x, y: v.y,
      ...(validFurnitureBounds(v.rect) ? { rect: v.rect } : {}),
      angle: typeof v.angle === 'number' && Number.isFinite(v.angle) ? ((v.angle % 360) + 360) % 360 : null,
      ...(typeof v.productId === 'string' ? { productId: v.productId } : {}),
      ...(typeof v.confidence === 'number' && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1 ? { confidence: v.confidence } : {}),
    }];
  }).slice(0, 200);
}
export function parseFurniturePlacements(value: unknown): QuoteFurniturePlacements {
  if (!value || typeof value !== 'object') return { positions: {}, assignments: {} };
  const row = value as Record<string, unknown>;
  const positions = Object.fromEntries(Object.entries(row.positions && typeof row.positions === 'object' ? row.positions : {}).map(([id, list]) => [id, parseFurniturePositions(list)]));
  const assignments = Object.fromEntries(Object.entries(row.assignments && typeof row.assignments === 'object' ? row.assignments : {}).map(([id, list]) => [id, Array.isArray(list) ? list.slice(0, 200).map(v => typeof v === 'string' ? v : '') : []]));
  return { positions, assignments };
}
export function autoFurniturePlacements(
  rows: { id: string; name: string }[],
  detected: { name: string; positions?: FurniturePosition[] }[],
  zones: { id: string; products: { id: string; quantity: number }[] }[],
): QuoteFurniturePlacements {
  const positions: Record<string, FurniturePosition[]> = {};
  const assignments: Record<string, string[]> = {};
  for (const row of rows) {
    const found = detected.find(z => z.name.trim().toLowerCase() === row.name.trim().toLowerCase());
    positions[row.id] = (found?.positions || []).filter(p => !/電視|电视|冰箱|雪櫃|雪柜|顯示器|显示器|螢幕|屏幕|television|\btv\b|refrigerator|fridge|monitor/i.test(p.category)).map(p => ({ ...p, id: `${row.id}:${p.label}` }));
    const products = zones.find(z => z.id === row.id)?.products || [];
    for (const product of products) {
      assignments[product.id] = positions[row.id].filter(p => p.productId === product.id && (p.confidence ?? 0) >= 0.9).slice(0, Math.max(0, Math.floor(product.quantity))).map(p => p.id);
    }
  }
  return { positions, assignments };
}
/** A location can belong to only one product instance within a zone. */
export function assignFurniturePosition(state: QuoteFurniturePlacements, zoneId: string, itemIds: string[], itemId: string, index: number, positionId: string): QuoteFurniturePlacements {
  if (!itemIds.includes(itemId) || (positionId && !state.positions[zoneId]?.some(p => p.id === positionId))) return state;
  const assignments = { ...state.assignments };
  for (const id of itemIds) assignments[id] = (assignments[id] || []).map((p, i) => p === positionId && positionId && (id !== itemId || i !== index) ? '' : p);
  const current = [...(assignments[itemId] || [])];
  while (current.length <= index) current.push('');
  current[index] = positionId;
  assignments[itemId] = current;
  return { ...state, assignments };
}

export function validFurnitureBounds(rect: unknown): rect is FurnitureBounds {
  if (!rect || typeof rect !== 'object') return false;
  const r = rect as FurnitureBounds;
  return [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= 100.00001 && r.y + r.h <= 100.00001;
}
/** Convert a drag within a cropped room into original floor-plan percentages. */
export function furnitureRectFromDrag(region: FurnitureBounds, start: { x: number; y: number }, end: { x: number; y: number }): FurnitureBounds | null {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  const x1 = clamp(start.x); const x2 = clamp(end.x); const y1 = clamp(start.y); const y2 = clamp(end.y);
  if (Math.abs(x2 - x1) < 1 || Math.abs(y2 - y1) < 1) return null;
  const rect = { x: region.x + Math.min(x1, x2) * region.w / 100, y: region.y + Math.min(y1, y2) * region.h / 100, w: Math.abs(x2 - x1) * region.w / 100, h: Math.abs(y2 - y1) * region.h / 100 };
  return validFurnitureBounds(rect) ? rect : null;
}
export function saveFurnitureSelection(state: QuoteFurniturePlacements, zoneId: string, itemIds: string[], itemId: string, index: number, selection: { positionId?: string; rect?: FurnitureBounds; category: string; angle: number | null }): QuoteFurniturePlacements {
  if (!itemIds.includes(itemId)) return state;
  const positions = state.positions[zoneId] || [];
  let positionId = selection.positionId;
  let nextPositions = positions;
  if (selection.rect) {
    if (!validFurnitureBounds(selection.rect)) return state;
    const n = Math.max(0, ...positions.map(p => Number(p.label.replace(/^P/, '')) || 0)) + 1;
    positionId = `${zoneId}:P${n}`;
    nextPositions = [...positions, { id: positionId, label: `P${n}`, category: selection.category, x: selection.rect.x + selection.rect.w / 2, y: selection.rect.y + selection.rect.h / 2, rect: selection.rect, angle: selection.angle }];
  } else {
    if (!positions.some(p => p.id === positionId)) return state;
    nextPositions = positions.map(p => p.id === positionId ? { ...p, angle: selection.angle } : p);
  }
  return assignFurniturePosition({ ...state, positions: { ...state.positions, [zoneId]: nextPositions } }, zoneId, itemIds, itemId, index, positionId || '');
}

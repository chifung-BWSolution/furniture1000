/** Per-view size readings from AI (T-801 / T-804). */
export type DimensionEstimate = {
  view?: string | null;
  width_mm?: number | null;
  depth_mm?: number | null;
  height_mm?: number | null;
};

const AXIS_META: { key: 'width_mm' | 'depth_mm' | 'height_mm'; label: string }[] = [
  { key: 'width_mm', label: '闊' },
  { key: 'depth_mm', label: '深' },
  { key: 'height_mm', label: '高' },
];

/** Relative spread above this between two positive readings counts as a conflict. */
export const DIMENSION_CONFLICT_TOLERANCE = 0.08;

function positive(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function spreadConflict(values: number[], tolerance: number): boolean {
  if (values.length < 2) return false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min > 0 && (max - min) / min > tolerance;
}

function formatValues(values: number[]): string {
  return values.map((v) => `${Math.round(v)}`).join(' / ');
}

/**
 * Build human-readable conflict messages when catalogue data, consolidated AI size,
 * or per-view estimates disagree beyond tolerance.
 */
export function buildDimensionConflicts(
  estimates: DimensionEstimate[] | undefined,
  options?: {
    tolerance?: number;
    catalog?: { width_mm?: number | null; depth_mm?: number | null; height_mm?: number | null };
    consolidated?: { width_mm?: number | null; depth_mm?: number | null; height_mm?: number | null };
  },
): string[] {
  const tolerance = options?.tolerance ?? DIMENSION_CONFLICT_TOLERANCE;
  const messages: string[] = [];
  const rows = (estimates ?? []).filter((row) =>
    AXIS_META.some(({ key }) => positive(row[key]) != null),
  );

  for (const { key, label } of AXIS_META) {
    const byView = rows
      .map((row) => ({ view: (row.view ?? '視圖').trim() || '視圖', value: positive(row[key]) }))
      .filter((entry): entry is { view: string; value: number } => entry.value != null);
    const values = byView.map((entry) => entry.value);
    if (spreadConflict(values, tolerance)) {
      const detail = byView.map((entry) => `${entry.view} ${Math.round(entry.value)}`).join('、');
      messages.push(
        `不同視圖的${label}度相差超過 ${Math.round(tolerance * 100)}%（${formatValues(values)} mm：${detail}）`,
      );
    }
  }

  const catalog = options?.catalog;
  const consolidated = options?.consolidated;
  if (catalog && consolidated) {
    for (const { key, label } of AXIS_META) {
      const cat = positive(catalog[key]);
      const ai = positive(consolidated[key]);
      if (cat == null || ai == null) continue;
      if (spreadConflict([cat, ai], tolerance)) {
        messages.push(
          `產品資料與圖片辨認的${label}度不一致（資料 ${Math.round(cat)} mm、圖片 ${Math.round(ai)} mm）`,
        );
      }
    }
  }

  return messages;
}

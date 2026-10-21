/** FDS 品牌模板 Autofill 欄位名（須與 Canva Bulk Create 資料欄一致）。 */
export const FDS_CANVA_BRAND_FIELDS = [
  'FDS_COVER_TITLE',
  'FDS_COVER_SUBTITLE',
  'FDS_COVER_CLIENT',
  'FDS_COVER_PURPOSE',
  'FDS_COVER_DATE',
  'FDS_OUTLINE',
  'FDS_OUTLINE_1',
  'FDS_OUTLINE_2',
  'FDS_OUTLINE_3',
  'FDS_OUTLINE_4',
  'FDS_OUTLINE_5',
  ...Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return [`FDS_PROD_${n}_TITLE`, `FDS_PROD_${n}_DETAILS`, `FDS_PROD_${n}_IMAGE`];
  }).flat(),
] as const;

export const CANVA_AUTOFILL_DOC_PATH = 'docs/prd/FDS-2.1-Canva品牌模板Autofill.md';

function truncatedProductSlots(warnings: unknown): { slotCount: number; selected?: number } | null {
  if (!Array.isArray(warnings)) return null;
  for (const item of warnings) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { code?: unknown; slot_count?: unknown; selected?: number };
    if (row.code !== 'products_truncated') continue;
    const slotCount = Number(row.slot_count);
    if (!Number.isFinite(slotCount) || slotCount < 0) continue;
    const selected = Number(row.selected);
    return { slotCount, selected: Number.isFinite(selected) ? selected : undefined };
  }
  return null;
}

function unusedSlotNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
}

function formatSlotNumbers(slots: number[]): string {
  const sorted = [...slots].sort((a, b) => a - b);
  const contiguous = sorted.length >= 3 && sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  return contiguous ? `${sorted[0]} 至 ${sorted[sorted.length - 1]}` : sorted.join('、');
}

/** Chinese lines for a Canva autofill populate_report. */
export function canvaAutofillNotices(report: Record<string, unknown> | null | undefined): string[] {
  if (!report) return [];
  const notices: string[] = [];
  const truncated = truncatedProductSlots(report.warnings);
  if (truncated) {
    const { slotCount, selected } = truncated;
    if (slotCount === 0) {
      notices.push(selected != null
        ? `已選 ${selected} 件產品，模板沒有產品欄位，沒有填入產品。`
        : '模板沒有產品欄位，沒有填入產品。');
    } else if (selected != null) {
      notices.push(`已選 ${selected} 件產品，模板只有 ${slotCount} 個產品欄位，已填入前 ${slotCount} 件。`);
    } else {
      notices.push(`模板只有 ${slotCount} 個產品欄位，多出的產品沒有填入。`);
    }
  }
  const unused = unusedSlotNumbers(report.unused_slots);
  if (unused.length > 0) {
    notices.push(`第 ${formatSlotNumbers(unused)} 個產品頁是空白，可在 Canva 刪除。`);
  }
  return notices;
}

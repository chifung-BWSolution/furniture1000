/**
 * Format selected 客戶產業 labels for list tables.
 * Empty selection → em dash (same as other list empty cells).
 */
export function formatClientIndustryLabel(
  industries: string[] | null | undefined,
  other?: string | null,
): string {
  const list = (industries || [])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (list.length === 0) return '—';

  const otherText = other?.trim() || '';
  return list
    .map((label) =>
      label === '其他' && otherText ? `其他（${otherText}）` : label,
    )
    .join('、');
}

import { industryEnglishSortKey } from '@/lib/clientIndustrySort';

export function filterIndustriesBySearch(
  labels: string[],
  query: string,
  selected: string[] = [],
): string[] {
  const q = query.trim();
  if (!q) return labels;
  const selectedSet = new Set(selected);
  return labels.filter(
    (label) => selectedSet.has(label) || industryMatchesSearch(label, q),
  );
}

/** Match Chinese or English fragments in bilingual industry labels. */
export function industryMatchesSearch(label: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;

  const lowerLabel = label.toLowerCase();
  const lowerQ = q.toLowerCase();
  if (lowerLabel.includes(lowerQ)) return true;

  const zhPart = label.split(/\s*-\s+/)[0]?.trim() || '';
  if (zhPart.includes(q)) return true;

  const enPart = industryEnglishSortKey(label);
  if (enPart.includes(lowerQ)) return true;

  return false;
}

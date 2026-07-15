import {
  industryEnglishSortKey,
  sortIndustryOptions,
} from '@/lib/clientIndustrySort';
import type { PmsIndustryOption } from '@/lib/pmsPitchingQuoteDefaults';

/** Legacy PMS tag to hide from the quick-quote picker. */
export const REMOVED_INDUSTRY_DISPLAYS = new Set([
  '教育及培訓業 - Education and Training',
]);

/** Local-only industry tags until synced in PMS nos_customer_tags. */
export const ADDED_INDUSTRY_OPTIONS: PmsIndustryOption[] = [
  { id: 'bwf-local:primary-school', display: '中小學 - Primary and School' },
  { id: 'bwf-local:kindergarten', display: '幼稚園 - Kindergarten' },
  { id: 'bwf-local:university', display: '大專院校 - University' },
  { id: 'bwf-local:education', display: '教育行業 - Education' },
];

export function isRemovedIndustryDisplay(display: string): boolean {
  const trimmed = display.trim();
  if (!trimmed) return true;
  if (REMOVED_INDUSTRY_DISPLAYS.has(trimmed)) return true;
  return industryEnglishSortKey(trimmed) === 'education and training';
}

export function applyClientIndustryCatalogOverrides(
  options: PmsIndustryOption[],
): PmsIndustryOption[] {
  const filtered = options.filter((o) => !isRemovedIndustryDisplay(o.display));
  const existing = new Set(filtered.map((o) => o.display.trim().toLowerCase()));
  const additions = ADDED_INDUSTRY_OPTIONS.filter(
    (o) => !existing.has(o.display.trim().toLowerCase()),
  );
  return sortIndustryOptions([...filtered, ...additions]);
}

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

export function sanitizeSelectedIndustries(selected: string[]): string[] {
  return selected.filter((s) => !isRemovedIndustryDisplay(s));
}

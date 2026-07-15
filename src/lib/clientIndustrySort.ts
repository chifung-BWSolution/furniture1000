import type { PmsIndustryOption } from '@/lib/pmsPitchingQuoteDefaults';

/** Extract English sort key from bilingual industry label (e.g. "保險業 - Insurance"). */
export function industryEnglishSortKey(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '';

  const dashParts = trimmed.split(/\s*-\s+/);
  if (dashParts.length >= 2) {
    const english = dashParts.slice(1).join(' - ').trim();
    if (english) return english.toLowerCase();
  }

  const enTail = trimmed.match(/[A-Za-z][A-Za-z0-9\s\-&',./()]*$/);
  if (enTail) return enTail[0].trim().toLowerCase();

  return trimmed.toLowerCase();
}

export function compareIndustryLabelsByEnglish(a: string, b: string): number {
  const ka = industryEnglishSortKey(a);
  const kb = industryEnglishSortKey(b);
  if (ka !== kb) return ka.localeCompare(kb, 'en');
  return a.localeCompare(b, 'zh-Hant');
}

export function sortIndustryLabels(labels: string[]): string[] {
  return [...labels].sort(compareIndustryLabelsByEnglish);
}

export function sortIndustryOptions(options: PmsIndustryOption[]): PmsIndustryOption[] {
  return [...options].sort((a, b) =>
    compareIndustryLabelsByEnglish(a.display, b.display),
  );
}

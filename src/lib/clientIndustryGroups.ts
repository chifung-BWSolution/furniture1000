import { industryEnglishSortKey } from '@/lib/clientIndustrySort';
import { industryMatchesSearch } from '@/lib/clientIndustryCatalog';

export interface ClientIndustryGroup {
  /** Section heading — not selectable industry data. */
  title: string;
  /** Preferred display labels in the intended order. */
  industries: string[];
}

/**
 * Quick Quote 客戶產業 groupings.
 * Titles (1.–6.) are headings only; `industries` are the selectable chips.
 */
export const CLIENT_INDUSTRY_GROUPS: ClientIndustryGroup[] = [
  {
    title: '1. 商業及專業服務 (Corporate & Professional Services)',
    industries: [
      '專業、科學及技術服務業 - Professional Services',
      '金融服務業 - Financial Services',
      '保險業 - Insurance',
      '法律業務 - Legal',
      '資訊科技業 - Information Technology',
      '地產 Real Estate',
      '媒體及娛樂業 - Media and Entertainment',
      '自僱 Self-employment',
    ],
  },
  {
    title: '2. 零售、餐飲及服務業 (Retail, Dining & Service Industry)',
    industries: [
      '批發及零售業 - Retail',
      '餐飲業 - Food and Beverage',
      '旅遊及酒店業 - Tourism and Hospitality',
      '美容業 - Beauty',
      '汽車業 - Automotive',
    ],
  },
  {
    title: '3. 教育及學術機構 (Education & Educational Institutions)',
    industries: [
      '幼稚園 - Kindergarten',
      '中小學 - Primary and School',
      '大專院校 - University',
      '教育行業 - Education',
    ],
  },
  {
    title: '4. 醫療及健康照護 (Medical & Healthcare Services)',
    industries: [
      '醫療及保健業 - Healthcare',
      '寵物診所 Veterinary Clinic',
    ],
  },
  {
    title: '5. 公共事業、政府及機構 (Government, Public & Non-Profit Sector)',
    industries: [
      '政府組織 - Government Organization',
      '非政府組織及社會服務 - Non-Governmental Organizations and Social Services',
      '公共事業及基礎建設 - Utilities and Infrastructure',
      '航空服務業 -Aviation',
    ],
  },
  {
    title: '6. 工業、農業及物流 (Industrial, Production & Logistics)',
    industries: [
      '工業 - Industrial',
      '製造業 - Manufacturing',
      '貿易及物流業 - Trade and Logistics',
      '建築業 Construction',
      '農業產品 - Agricultural products',
    ],
  },
];

/** Flat preferred catalog (group order preserved). */
export const GROUPED_INDUSTRY_LABELS: string[] = CLIENT_INDUSTRY_GROUPS.flatMap(
  (g) => g.industries,
);

function normalizeIndustryKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Match a preferred catalog label to an available option from PMS / fallback. */
export function matchAvailableIndustry(
  preferred: string,
  available: string[],
): string | null {
  if (available.includes(preferred)) return preferred;

  const preferredNorm = normalizeIndustryKey(preferred);
  const preferredEn = industryEnglishSortKey(preferred);
  const preferredZh = preferred.split(/\s*-\s+/)[0]?.trim() || preferred;

  for (const option of available) {
    if (normalizeIndustryKey(option) === preferredNorm) return option;
  }

  if (preferredEn) {
    for (const option of available) {
      if (industryEnglishSortKey(option) === preferredEn) return option;
    }
  }

  const preferredZhNorm = preferredZh.replace(/\s+/g, '').toLowerCase();
  for (const option of available) {
    const optionZh = (option.split(/\s*-\s+/)[0]?.trim() || option)
      .replace(/\s+/g, '')
      .toLowerCase();
    if (optionZh && optionZh === preferredZhNorm) return option;
  }

  return null;
}

export interface ResolvedIndustryGroup {
  title: string;
  /** Actual option labels to render (from available catalog). */
  options: string[];
}

/**
 * Build visible industry groups from available options.
 * Keeps catalog order; unmatched available options go under 「7. 其他」.
 */
export function resolveIndustryGroups(
  available: string[],
  searchQuery = '',
  selected: string[] = [],
): ResolvedIndustryGroup[] {
  const used = new Set<string>();
  const groups: ResolvedIndustryGroup[] = [];

  for (const group of CLIENT_INDUSTRY_GROUPS) {
    const options: string[] = [];
    for (const preferred of group.industries) {
      const matched = matchAvailableIndustry(preferred, available);
      if (!matched || used.has(matched)) continue;
      used.add(matched);
      options.push(matched);
    }
    if (options.length > 0) {
      groups.push({ title: group.title, options });
    }
  }

  const leftovers = available.filter((label) => !used.has(label));
  if (leftovers.length > 0) {
    groups.push({ title: '7. 其他', options: leftovers });
  }

  const q = searchQuery.trim();
  if (!q) return groups;

  const selectedSet = new Set(selected);
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (label) => selectedSet.has(label) || industryMatchesSearch(label, q),
      ),
    }))
    .filter((group) => group.options.length > 0);
}

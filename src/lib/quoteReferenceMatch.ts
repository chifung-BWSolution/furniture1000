/**
 * Score historical furniture quotes for 報價參考分析.
 * Category overlap and amount band are hard gates. Other factors only rank
 * the quotes that pass, and a missing value is left out of the denominator.
 */

export const QUOTE_REFERENCE_WEIGHTS = {
  category: 25,
  size: 25,
  industry: 20,
  customerType: 15,
  grade: 10,
  leadTime: 5,
} as const;

export const QUOTE_REFERENCE_GRADES = ['基本傢俬', '傢俬採購'] as const;

export interface QuoteReferenceBand {
  id: string;
  label: string;
  /** Inclusive. Null means no lower bound. */
  min: number | null;
  /** Exclusive. Null means no upper bound. */
  max: number | null;
}

export const QUOTE_AMOUNT_BANDS: QuoteReferenceBand[] = [
  { id: 'lt20k', label: '2 萬以下', min: null, max: 20_000 },
  { id: '20to50', label: '2–5 萬', min: 20_000, max: 50_000 },
  { id: '50to200', label: '5–20 萬', min: 50_000, max: 200_000 },
  { id: 'ge200', label: '20 萬以上', min: 200_000, max: null },
];

export const QUOTE_SIZE_BANDS: QuoteReferenceBand[] = [
  { id: 'lt1200', label: '1200mm 以下', min: null, max: 1_200 },
  { id: '1200', label: '1200–1600mm', min: 1_200, max: 1_600 },
  { id: '1600', label: '1600–2000mm', min: 1_600, max: 2_000 },
  { id: 'ge2000', label: '2000mm 以上', min: 2_000, max: null },
];

/** One quoted furniture line. Colors and materials are the fixed tags, not the original text. */
export interface QuoteItemTrait {
  category: string;
  colors: string[];
  materials: string[];
}

/** A selected 分類, with optional color and material narrowed to that same line. */
export interface QuoteReferenceClassification {
  category: string;
  colors: string[];
  materials: string[];
}

export interface QuoteReferenceCandidate {
  id: string;
  quoteId: string;
  version: string | null;
  totalAmount: number | null;
  createdAt: string | null;
  pitchingId: string | null;
  projectName?: string | null;
  industries: string[];
  scopes: string[];
  grades: string[];
  workPeriod: string | null;
  itemCount: number;
  sizedItemCount: number;
  sizeLt1200: number;
  size1200: number;
  size1600: number;
  sizeGe2000: number;
  customerType: string | null;
  itemTraits?: QuoteItemTrait[];
}

export interface QuoteReferenceQuery {
  categories: string[];
  amountBandId: string;
  sizeBandId: string | null;
  industries: string[];
  industryHard: boolean;
  customerType: string | null;
  grade: string | null;
  workPeriod: string | null;
  excludeQuoteId?: string | null;
  /** Empty or omitted means the level-1 category gate is enough. */
  classifications?: QuoteReferenceClassification[];
}

export type QuoteReferenceTagTone = 'teal' | 'amber' | 'slate';

export interface QuoteReferenceTag {
  key: string;
  label: string;
  tone: QuoteReferenceTagTone;
}

export interface QuoteReferenceMatch {
  candidate: QuoteReferenceCandidate;
  /** 0–100, earned weight divided by the weight of factors both sides recorded. */
  score: number;
  earned: number;
  applicable: number;
  tags: QuoteReferenceTag[];
}

type FactorKind = 'match' | 'partial' | 'mismatch' | 'unknown';

export function industryKey(label: string): string {
  const head = label.split(/\s+-\s+/)[0] ?? label;
  return head.trim().toLocaleLowerCase('zh-Hant');
}

export function valueInBand(value: number | null, band: QuoteReferenceBand | null): boolean {
  if (!band || value == null || !Number.isFinite(value)) return false;
  if (band.min != null && value < band.min) return false;
  if (band.max != null && value >= band.max) return false;
  return true;
}

function uniqueKeys(values: string[], keyOf: (value: string) => string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of values) {
    const key = keyOf(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function exactKey(value: string): string {
  return value.trim();
}

function traitKey(value: string): string {
  return value.trim().toLocaleLowerCase('zh-Hant');
}

function hasSelectedTag(selected: Set<string>, values: string[]): boolean {
  if (selected.size === 0) return true;
  return values.some((value) => selected.has(traitKey(value)));
}

function classificationHit(traits: QuoteItemTrait[], pick: QuoteReferenceClassification): boolean {
  const category = traitKey(pick.category);
  if (!category) return false;
  const colors = new Set(pick.colors.map(traitKey).filter(Boolean));
  const materials = new Set(pick.materials.map(traitKey).filter(Boolean));
  return traits.some((trait) => {
    if (traitKey(trait.category) !== category) return false;
    if (!hasSelectedTag(colors, trait.colors)) return false;
    if (!hasSelectedTag(materials, trait.materials)) return false;
    return true;
  });
}

function coverage(selected: string[], candidate: string[], keyOf: (value: string) => string): {
  hit: number;
  asked: number;
} {
  const wanted = uniqueKeys(selected, keyOf);
  const have = new Set(uniqueKeys(candidate, keyOf));
  let hit = 0;
  for (const key of wanted) {
    if (have.has(key)) hit += 1;
  }
  return { hit, asked: wanted.length };
}

function sizeCount(candidate: QuoteReferenceCandidate, bandId: string): number | null {
  if (candidate.sizedItemCount <= 0) return null;
  switch (bandId) {
    case 'lt1200':
      return candidate.sizeLt1200;
    case '1200':
      return candidate.size1200;
    case '1600':
      return candidate.size1600;
    case 'ge2000':
      return candidate.sizeGe2000;
    default:
      return null;
  }
}

function tag(key: string, name: string, kind: FactorKind): QuoteReferenceTag {
  const suffix =
    kind === 'match' ? '相符' : kind === 'partial' ? '部分相符' : kind === 'mismatch' ? '不符' : '未記錄';
  return {
    key,
    label: `${name} ${suffix}`,
    tone: kind === 'match' ? 'teal' : kind === 'unknown' ? 'slate' : 'amber',
  };
}

function ratioKind(ratio: number): FactorKind {
  if (ratio >= 1) return 'match';
  if (ratio > 0) return 'partial';
  return 'mismatch';
}

interface ScoreParts {
  earned: number;
  applicable: number;
  tags: QuoteReferenceTag[];
  excluded: boolean;
}

function scoreCandidate(candidate: QuoteReferenceCandidate, query: QuoteReferenceQuery): ScoreParts {
  const tags: QuoteReferenceTag[] = [];
  let earned = 0;
  let applicable = 0;

  const categories = coverage(query.categories, candidate.scopes, exactKey);
  if (categories.asked === 0 || categories.hit === 0) {
    return { earned: 0, applicable: 0, tags, excluded: true };
  }
  const categoryRatio = categories.hit / categories.asked;
  earned += categoryRatio * QUOTE_REFERENCE_WEIGHTS.category;
  applicable += QUOTE_REFERENCE_WEIGHTS.category;
  tags.push(tag('category', '類別', ratioKind(categoryRatio)));

  const picks = (query.classifications ?? []).filter((pick) => pick.category.trim());
  if (picks.length > 0 && !picks.some((pick) => classificationHit(candidate.itemTraits ?? [], pick))) {
    return { earned: 0, applicable: 0, tags, excluded: true };
  }

  const amountBand = QUOTE_AMOUNT_BANDS.find((band) => band.id === query.amountBandId) ?? null;
  if (!valueInBand(candidate.totalAmount, amountBand)) {
    return { earned: 0, applicable: 0, tags, excluded: true };
  }
  tags.push(tag('amount', '金額', 'match'));

  const sizeBandId = query.sizeBandId?.trim() || '';
  if (sizeBandId) {
    const matched = sizeCount(candidate, sizeBandId);
    if (matched == null) {
      tags.push(tag('size', '尺寸', 'unknown'));
    } else {
      const ratio = matched / candidate.sizedItemCount;
      earned += ratio * QUOTE_REFERENCE_WEIGHTS.size;
      applicable += QUOTE_REFERENCE_WEIGHTS.size;
      tags.push(tag('size', '尺寸', ratioKind(ratio)));
    }
  }

  const industries = coverage(query.industries, candidate.industries, industryKey);
  if (industries.asked > 0) {
    const candidateKeys = uniqueKeys(candidate.industries, industryKey);
    if (query.industryHard && (candidateKeys.length === 0 || industries.hit === 0)) {
      return { earned: 0, applicable: 0, tags, excluded: true };
    }
    if (candidateKeys.length === 0) {
      tags.push(tag('industry', '產業', 'unknown'));
    } else {
      const ratio = industries.hit / industries.asked;
      earned += ratio * QUOTE_REFERENCE_WEIGHTS.industry;
      applicable += QUOTE_REFERENCE_WEIGHTS.industry;
      tags.push(tag('industry', '產業', ratioKind(ratio)));
    }
  }

  const customerType = query.customerType?.trim() || '';
  if (customerType) {
    const historical = candidate.customerType?.trim() || '';
    if (!historical) {
      tags.push(tag('customerType', '客戶類型', 'unknown'));
    } else if (historical === customerType) {
      earned += QUOTE_REFERENCE_WEIGHTS.customerType;
      applicable += QUOTE_REFERENCE_WEIGHTS.customerType;
      tags.push(tag('customerType', '客戶類型', 'match'));
    } else {
      applicable += QUOTE_REFERENCE_WEIGHTS.customerType;
      tags.push(tag('customerType', '客戶類型', 'mismatch'));
    }
  }

  const grade = query.grade?.trim() || '';
  if (grade) {
    const historical = uniqueKeys(candidate.grades, exactKey);
    if (historical.length === 0) {
      tags.push(tag('grade', '級別', 'unknown'));
    } else if (historical.includes(grade)) {
      earned += QUOTE_REFERENCE_WEIGHTS.grade;
      applicable += QUOTE_REFERENCE_WEIGHTS.grade;
      tags.push(tag('grade', '級別', 'match'));
    } else {
      applicable += QUOTE_REFERENCE_WEIGHTS.grade;
      tags.push(tag('grade', '級別', 'mismatch'));
    }
  }

  const workPeriod = query.workPeriod?.trim() || '';
  if (workPeriod) {
    const historical = candidate.workPeriod?.trim() || '';
    if (!historical) {
      tags.push(tag('leadTime', '工期', 'unknown'));
    } else if (historical === workPeriod) {
      earned += QUOTE_REFERENCE_WEIGHTS.leadTime;
      applicable += QUOTE_REFERENCE_WEIGHTS.leadTime;
      tags.push(tag('leadTime', '工期', 'match'));
    } else {
      applicable += QUOTE_REFERENCE_WEIGHTS.leadTime;
      tags.push(tag('leadTime', '工期', 'mismatch'));
    }
  }

  return { earned, applicable, tags, excluded: false };
}

export function matchQuoteReferences(
  candidates: QuoteReferenceCandidate[],
  query: QuoteReferenceQuery,
): QuoteReferenceMatch[] {
  const excludeId = query.excludeQuoteId?.trim() || '';
  const matches: QuoteReferenceMatch[] = [];
  for (const candidate of candidates) {
    if (excludeId && candidate.id === excludeId) continue;
    if (candidate.itemCount <= 0) continue;
    const scored = scoreCandidate(candidate, query);
    if (scored.excluded || scored.applicable <= 0) continue;
    const score = Math.round((scored.earned / scored.applicable) * 100);
    matches.push({
      candidate,
      score,
      earned: scored.earned,
      applicable: scored.applicable,
      tags: scored.tags,
    });
  }
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.candidate.createdAt ? Date.parse(a.candidate.createdAt) : 0;
    const bTime = b.candidate.createdAt ? Date.parse(b.candidate.createdAt) : 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.candidate.id.localeCompare(b.candidate.id);
  });
  return matches;
}

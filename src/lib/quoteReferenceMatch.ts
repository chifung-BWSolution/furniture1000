/**
 * Score historical furniture quotes for 報價參考分析.
 * Furniture coverage caps the score. Selected project factors determine
 * how much of the final 10% of that coverage the quote earns.
 */

const PROJECT_WEIGHTS = {
  size: 25,
  industry: 20,
  customerType: 15,
  grade: 10,
  leadTime: 5,
} as const;
const CLASSIFICATION_WEIGHT = 70;
const COLOR_WEIGHT = 15;
const MATERIAL_WEIGHT = 15;
const PROJECT_WEIGHT = 0.1;

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

/** A selected 類別 and optional 分類, color and material. */
export interface QuoteReferenceFurnitureGroup {
  scope: string;
  classification: string;
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
  furnitureGroups: QuoteReferenceFurnitureGroup[];
  amountBandId: string;
  sizeBandId: string | null;
  industries: string[];
  industryHard: boolean;
  customerType: string | null;
  grade: string | null;
  workPeriod: string | null;
  excludeQuoteId?: string | null;
}

export type QuoteReferenceTagTone = 'teal' | 'amber' | 'slate';

export interface QuoteReferenceTag {
  key: string;
  label: string;
  tone: QuoteReferenceTagTone;
}

export interface QuoteReferenceMatch {
  candidate: QuoteReferenceCandidate;
  /** Display percentage, with 100 reserved for a complete match. */
  score: number;
  completeGroups: number;
  totalGroups: number;
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

function specificationStatus(selected: string[], values: string[]): FactorKind {
  const recorded = uniqueKeys(values, traitKey);
  if (!recorded.length) return 'unknown';
  return recorded.some((value) => selected.includes(value)) ? 'match' : 'mismatch';
}

function bestSpecificationMatch(traits: QuoteItemTrait[], group: QuoteReferenceFurnitureGroup) {
  const colors = uniqueKeys(group.colors, traitKey);
  const materials = uniqueKeys(group.materials, traitKey);
  const colorWeight = colors.length ? COLOR_WEIGHT : 0;
  const materialWeight = materials.length ? MATERIAL_WEIGHT : 0;
  if (colorWeight + materialWeight === 0) return { points: 100, checks: [] };

  let best: { earned: number; recorded: number; checks: Array<{ name: string; kind: FactorKind; weight: number }> } | undefined;
  for (const trait of traits) {
    const checks: Array<{ name: string; kind: FactorKind; weight: number }> = [];
    if (colorWeight) checks.push({ name: '顏色', kind: specificationStatus(colors, trait.colors), weight: colorWeight });
    if (materialWeight) checks.push({ name: '材質', kind: specificationStatus(materials, trait.materials), weight: materialWeight });
    const earned = checks.reduce((sum, check) => sum + (check.kind === 'match' ? check.weight : 0), CLASSIFICATION_WEIGHT);
    const recorded = checks.filter((check) => check.kind !== 'unknown').length;
    if (!best || earned > best.earned || (earned === best.earned && recorded > best.recorded)) {
      best = { earned, recorded, checks };
    }
  }
  const possible = CLASSIFICATION_WEIGHT + colorWeight + materialWeight;
  return {
    points: ((best?.earned ?? 0) / possible) * 100,
    checks: best?.checks ?? [],
  };
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

function statusLabel(name: string, kind: FactorKind): string {
  const suffix =
    kind === 'match' ? '相符' : kind === 'partial' ? '部分相符' : kind === 'mismatch' ? '不符' : '未記錄';
  return `${name} ${suffix}`;
}

function tag(key: string, name: string, kind: FactorKind): QuoteReferenceTag {
  return {
    key,
    label: statusLabel(name, kind),
    tone: kind === 'match' ? 'teal' : kind === 'unknown' ? 'slate' : 'amber',
  };
}

function ratioKind(ratio: number): FactorKind {
  if (ratio >= 1) return 'match';
  if (ratio > 0) return 'partial';
  return 'mismatch';
}

function scoreCandidate(
  candidate: QuoteReferenceCandidate,
  query: QuoteReferenceQuery,
  groups: QuoteReferenceFurnitureGroup[],
): QuoteReferenceMatch | null {
  const tags: QuoteReferenceTag[] = [];
  const amountBand = QUOTE_AMOUNT_BANDS.find((band) => band.id === query.amountBandId) ?? null;
  if (amountBand && !valueInBand(candidate.totalAmount, amountBand)) return null;
  const industries = coverage(query.industries, candidate.industries, industryKey);
  if (query.industryHard && industries.asked > 0 && industries.hit === 0) return null;

  const scopes = new Set(candidate.scopes.map(exactKey));
  let furniturePoints = 0;
  let completeGroups = 0;
  for (const [index, group] of groups.entries()) {
    const key = `furnitureGroup-${index}`;
    const name = group.classification || group.scope;
    if (!scopes.has(group.scope)) {
      tags.push(tag(key, name, 'mismatch'));
      continue;
    }
    if (!group.classification) {
      furniturePoints += 100;
      completeGroups += 1;
      tags.push(tag(key, name, 'match'));
      continue;
    }
    const classification = traitKey(group.classification);
    const matchingItems = (candidate.itemTraits ?? []).filter((item) => traitKey(item.category) === classification);
    if (matchingItems.length === 0) {
      tags.push(tag(key, name, 'mismatch'));
      continue;
    }
    const specs = bestSpecificationMatch(matchingItems, group);
    furniturePoints += specs.points;
    if (specs.points === 100) completeGroups += 1;
    tags.push({
      key,
      label: [statusLabel(name, 'match'), ...specs.checks.map((check) => statusLabel(check.name, check.kind))].join(' · '),
      tone: specs.points === 100 ? 'teal' : 'amber',
    });
  }
  if (furniturePoints === 0) return null;

  if (amountBand) tags.push(tag('amount', '金額', 'match'));
  let earned = 0;
  let applicable = 0;

  const sizeBandId = query.sizeBandId?.trim() || '';
  if (sizeBandId) {
    applicable += PROJECT_WEIGHTS.size;
    const matched = sizeCount(candidate, sizeBandId);
    if (matched == null) {
      tags.push(tag('size', '尺寸', 'unknown'));
    } else {
      const ratio = matched / candidate.sizedItemCount;
      earned += ratio * PROJECT_WEIGHTS.size;
      tags.push(tag('size', '尺寸', ratioKind(ratio)));
    }
  }

  if (industries.asked > 0) {
    const candidateKeys = uniqueKeys(candidate.industries, industryKey);
    const ratio = industries.hit / industries.asked;
    if (!query.industryHard) {
      applicable += PROJECT_WEIGHTS.industry;
      earned += ratio * PROJECT_WEIGHTS.industry;
    }
    if (candidateKeys.length === 0) {
      tags.push(tag('industry', '產業', 'unknown'));
    } else {
      tags.push(tag('industry', '產業', ratioKind(ratio)));
    }
  }

  const customerType = query.customerType?.trim() || '';
  if (customerType) {
    applicable += PROJECT_WEIGHTS.customerType;
    const historical = candidate.customerType?.trim() || '';
    if (!historical) {
      tags.push(tag('customerType', '客戶類型', 'unknown'));
    } else if (historical === customerType) {
      earned += PROJECT_WEIGHTS.customerType;
      tags.push(tag('customerType', '客戶類型', 'match'));
    } else {
      tags.push(tag('customerType', '客戶類型', 'mismatch'));
    }
  }

  const grade = query.grade?.trim() || '';
  if (grade) {
    applicable += PROJECT_WEIGHTS.grade;
    const historical = uniqueKeys(candidate.grades, exactKey);
    if (historical.length === 0) {
      tags.push(tag('grade', '級別', 'unknown'));
    } else if (historical.includes(grade)) {
      earned += PROJECT_WEIGHTS.grade;
      tags.push(tag('grade', '級別', 'match'));
    } else {
      tags.push(tag('grade', '級別', 'mismatch'));
    }
  }

  const workPeriod = query.workPeriod?.trim() || '';
  if (workPeriod) {
    applicable += PROJECT_WEIGHTS.leadTime;
    const historical = candidate.workPeriod?.trim() || '';
    if (!historical) {
      tags.push(tag('leadTime', '工期', 'unknown'));
    } else if (historical === workPeriod) {
      earned += PROJECT_WEIGHTS.leadTime;
      tags.push(tag('leadTime', '工期', 'match'));
    } else {
      tags.push(tag('leadTime', '工期', 'mismatch'));
    }
  }

  const projectRatio = applicable > 0 ? earned / applicable : 1;
  const score = (furniturePoints / groups.length) * (1 - PROJECT_WEIGHT * (1 - projectRatio));
  return { candidate, score, completeGroups, totalGroups: groups.length, tags };
}

export function matchQuoteReferences(
  candidates: QuoteReferenceCandidate[],
  query: QuoteReferenceQuery,
): QuoteReferenceMatch[] {
  const groupsBySelection = new Map<string, QuoteReferenceFurnitureGroup>();
  for (const group of query.furnitureGroups) {
    const scope = group.scope.trim();
    const classification = group.classification.trim();
    if (!scope) continue;
    groupsBySelection.set(JSON.stringify([scope, classification]), { ...group, scope, classification });
  }
  const groups = [...groupsBySelection.values()];
  const excludeId = query.excludeQuoteId?.trim() || '';
  const matches: QuoteReferenceMatch[] = [];
  for (const candidate of candidates) {
    if (excludeId && candidate.id === excludeId) continue;
    if (candidate.itemCount <= 0) continue;
    const scored = scoreCandidate(candidate, query, groups);
    if (scored) matches.push(scored);
  }
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.candidate.createdAt ? Date.parse(a.candidate.createdAt) : 0;
    const bTime = b.candidate.createdAt ? Date.parse(b.candidate.createdAt) : 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.candidate.id.localeCompare(b.candidate.id);
  });
  return matches.map((match) => ({
    ...match,
    score: match.score === 100 ? 100 : Math.min(99, Math.round(match.score)),
  }));
}

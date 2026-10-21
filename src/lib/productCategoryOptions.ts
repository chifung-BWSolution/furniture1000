import { supabase } from '@/lib/supabase';

export type ProductCategoryPair = { id?: string; level1: string; level2: string };

/** Legacy product text pair → current product_category row. */
const PRODUCT_CATEGORY_TEXT_ALIASES: Array<{
  from: { level1: string; level2: string };
  to: { level1: string; level2: string };
}> = [
  { from: { level1: '會議桌', level2: '會議桌' }, to: { level1: '辦公枱', level2: '會議枱' } },
];

export function canonicalizeProductCategoryPair(
  level1?: string | null,
  level2?: string | null,
): { level1: string; level2: string } {
  const l1 = String(level1 ?? '').trim();
  const l2 = String(level2 ?? '').trim();
  for (const alias of PRODUCT_CATEGORY_TEXT_ALIASES) {
    if (alias.from.level1 === l1 && alias.from.level2 === l2) return alias.to;
  }
  return { level1: l1, level2: l2 };
}

export function mapProductCategoryRows(
  rows:
    | Array<{ id?: string | null; level1?: string | null; level2?: string | null }>
    | null
    | undefined,
): ProductCategoryPair[] {
  return (rows ?? [])
    .map((row) => ({
      id: String(row.id ?? '').trim() || undefined,
      level1: String(row.level1 ?? '').trim(),
      level2: String(row.level2 ?? '').trim(),
    }))
    .filter((pair) => pair.level1);
}

/** Registry UUID for an L1+L2 pair, or null when incomplete / unknown. */
/** Lookup registry row by UUID (for quote line dropdowns). */
export function findProductCategoryPairById(
  pairs: ProductCategoryPair[],
  id?: string | null,
): ProductCategoryPair | null {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return pairs.find((p) => p.id === key) ?? null;
}

/** Label sent to the catalogue model: 「一級 / 二級」, or just 一級 when there is no 二級. */
export function productCategoryChoiceLabel(pair: ProductCategoryPair): string {
  const level1 = pair.level1.trim();
  const level2 = pair.level2.trim();
  return level2 ? `${level1} / ${level2}` : level1;
}

/** Value stored on a wizard row and shown by CascadingCategorySelector. */
export function categorySelectorValue(pair: ProductCategoryPair): string {
  return pair.level2.trim() || pair.level1.trim();
}

function foldCategoryText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[／>/]/g, '/')
    .replace(/[台檯]/g, '枱');
}

/**
 * Map free text onto one existing product_category row.
 * Unknown or invented names return null.
 */
export function matchExistingProductCategory(
  pairs: ProductCategoryPair[],
  raw?: string | null,
  level1Hint?: string | null,
): ProductCategoryPair | null {
  const text = String(raw ?? '').trim();
  if (!text || pairs.length === 0) return null;
  const folded = foldCategoryText(text);
  const hint = foldCategoryText(String(level1Hint ?? ''));
  const rows = pairs.map((pair) => ({
    pair,
    label: foldCategoryText(productCategoryChoiceLabel(pair)),
    level1: foldCategoryText(pair.level1),
    level2: foldCategoryText(pair.level2),
    display: foldCategoryText(categorySelectorValue(pair)),
  }));

  const pick = (hits: typeof rows): ProductCategoryPair | null => {
    if (hits.length === 1) return hits[0].pair;
    if (hits.length > 1 && hint) {
      const hinted = hits.filter((row) => row.level1 === hint);
      if (hinted.length === 1) return hinted[0].pair;
    }
    return null;
  };

  const byLabel = pick(rows.filter((row) => row.label === folded || row.display === folded));
  if (byLabel) return byLabel;

  const byLevel2 = pick(rows.filter((row) => row.level2 && row.level2 === folded));
  if (byLevel2) return byLevel2;

  const level1Only = rows.filter((row) => row.level1 === folded && !row.level2);
  const level1HasChildren = rows.some((row) => row.level1 === folded && row.level2);
  if (!level1HasChildren) return pick(level1Only);
  return null;
}

export function resolveProductCategoryId(
  pairs: ProductCategoryPair[],
  level1?: string | null,
  level2?: string | null,
): string | null {
  const canon = canonicalizeProductCategoryPair(level1, level2);
  if (!canon.level1 || !canon.level2) return null;
  const hit = pairs.find(
    (pair) =>
      pair.id &&
      pair.level1 === canon.level1 &&
      pair.level2 === canon.level2,
  );
  return hit?.id ?? null;
}

/** Distinct level-1 names from 設定 > 產品分類, preserving sort_order. */
export function uniqueLevel1InOrder(pairs: ProductCategoryPair[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pairs) {
    const l1 = String(p.level1 ?? '').trim();
    if (!l1 || seen.has(l1)) continue;
    seen.add(l1);
    out.push(l1);
  }
  return out;
}

/** Distinct level-2 names for a level-1, preserving sort_order. */
export function uniqueLevel2InOrder(pairs: ProductCategoryPair[], level1: string): string[] {
  const l1 = String(level1 ?? '').trim();
  if (!l1) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pairs) {
    if (String(p.level1 ?? '').trim() !== l1) continue;
    const l2 = String(p.level2 ?? '').trim();
    if (!l2 || seen.has(l2)) continue;
    seen.add(l2);
    out.push(l2);
  }
  return out;
}

/**
 * Sort category names by 設定 > 產品分類 order.
 * Names missing from the registry stay at the end (localeCompare).
 */
export function sortByCategoryRegistryOrder(names: string[], registryOrder: string[]): string[] {
  const order = new Map(registryOrder.map((n, i) => [n, i]));
  return [...names].sort((a, b) => {
    const oa = order.get(a);
    const ob = order.get(b);
    if (oa != null && ob != null) return oa - ob;
    if (oa != null) return -1;
    if (ob != null) return 1;
    return a.localeCompare(b, 'zh-Hant');
  });
}

export async function fetchLevel1CategoryOptions(): Promise<string[]> {
  return uniqueLevel1InOrder(await fetchProductCategoryPairs());
}

let categoryPairCache: ProductCategoryPair[] | null = null;
let categoryPairInflight: Promise<ProductCategoryPair[]> | null = null;

/** Level1/level2 pairs from 設定 > 產品分類（唯讀）. Cached for the session. */
export async function fetchProductCategoryPairs(): Promise<ProductCategoryPair[]> {
  if (categoryPairCache) return categoryPairCache;
  if (categoryPairInflight) return categoryPairInflight;
  categoryPairInflight = (async () => {
    const { data, error } = await supabase
      .from('product_category')
      .select('id, level1, level2, sort_order')
      .order('sort_order', { ascending: true });
    if (error) {
      console.warn('[productCategoryOptions] fetch pairs failed:', error.message);
      return [];
    }
    categoryPairCache = mapProductCategoryRows(data);
    return categoryPairCache;
  })().finally(() => {
    categoryPairInflight = null;
  });
  return categoryPairInflight;
}

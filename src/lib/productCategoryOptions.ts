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

/** Level1/level2 pairs from 設定 > 產品分類（唯讀）. */
export async function fetchProductCategoryPairs(): Promise<ProductCategoryPair[]> {
  const { data, error } = await supabase
    .from('product_category')
    .select('id, level1, level2, sort_order')
    .order('sort_order', { ascending: true });
  if (error) {
    console.warn('[productCategoryOptions] fetch pairs failed:', error.message);
    return [];
  }
  return mapProductCategoryRows(data);
}

import { supabase } from '@/lib/supabase';

export type ProductCategoryPair = { level1: string; level2: string };

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
    .select('level1, level2, sort_order')
    .order('sort_order', { ascending: true });
  if (error) {
    console.warn('[productCategoryOptions] fetch pairs failed:', error.message);
    return [];
  }
  return (data ?? [])
    .map((r: { level1: string | null; level2: string | null }) => ({
      level1: String(r.level1 ?? '').trim(),
      level2: String(r.level2 ?? '').trim(),
    }))
    .filter((p) => p.level1);
}

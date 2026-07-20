import { supabase } from '@/lib/supabase';

export type ProductCategoryPair = { level1: string; level2: string };

/** Distinct level-1 names from 設定 > 產品分類, preserving sort_order. */
export async function fetchLevel1CategoryOptions(): Promise<string[]> {
  const pairs = await fetchProductCategoryPairs();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pairs) {
    if (seen.has(p.level1)) continue;
    seen.add(p.level1);
    out.push(p.level1);
  }
  return out;
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

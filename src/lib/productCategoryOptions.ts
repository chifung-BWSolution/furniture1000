import { supabase } from '@/lib/supabase';

/** Distinct level-1 names from 設定 > 產品分類, preserving sort_order. */
export async function fetchLevel1CategoryOptions(): Promise<string[]> {
  const { data, error } = await supabase
    .from('product_category')
    .select('level1, sort_order')
    .order('sort_order', { ascending: true });
  if (error) {
    console.warn('[productCategoryOptions] fetch failed:', error.message);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of data ?? []) {
    const l1 = String(row.level1 ?? '').trim();
    if (!l1 || seen.has(l1)) continue;
    seen.add(l1);
    out.push(l1);
  }
  return out;
}

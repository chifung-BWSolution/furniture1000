import type { SupabaseClient } from '@supabase/supabase-js';

export interface CategoryRename {
  oldLevel1: string;
  oldLevel2: string;
  newLevel1: string;
  newLevel2: string;
}

/** Same format as ready_to_shopify.product_type and publish views. */
export function buildProductType(level1: string, level2: string): string {
  return [level1, level2].filter(Boolean).join(' / ');
}

/**
 * After product_category renames, mirror changes to products (list filters) and
 * ready_to_shopify.product_type (publish pipeline).
 */
export async function syncCategoryRenames(
  supabase: SupabaseClient,
  renames: CategoryRename[],
): Promise<{ productErrors: string[]; rtsErrors: string[] }> {
  const productErrors: string[] = [];
  const rtsErrors: string[] = [];

  for (const { oldLevel1, oldLevel2, newLevel1, newLevel2 } of renames) {
    const oldType = buildProductType(oldLevel1, oldLevel2);
    const newType = buildProductType(newLevel1, newLevel2);
    if (!oldType || oldType === newType) continue;

    const { error: productsErr } = await supabase
      .from('products')
      .update({
        level1_category: newLevel1,
        level2_category: newLevel2 || null,
      })
      .eq('level1_category', oldLevel1)
      .eq('level2_category', oldLevel2);

    if (productsErr) productErrors.push(productsErr.message);

    const { error: rtsErr } = await supabase
      .from('ready_to_shopify')
      .update({ product_type: newType || null })
      .eq('product_type', oldType);

    if (rtsErr) rtsErrors.push(rtsErr.message);
  }

  return { productErrors, rtsErrors };
}

/**
 * Align products + ready_to_shopify with the current category registry when level1
 * drifted (e.g. user renamed 工作臺 → 工作枱 before sync existed). Only runs for
 * level2 names that appear once in the registry to avoid ambiguous matches.
 */
export async function reconcileProductsFromCategoryRegistry(
  supabase: SupabaseClient,
  categories: { level1: string; level2: string }[],
): Promise<{ productErrors: string[]; rtsErrors: string[] }> {
  const level2Counts = new Map<string, number>();
  for (const { level2 } of categories) {
    if (!level2) continue;
    level2Counts.set(level2, (level2Counts.get(level2) ?? 0) + 1);
  }

  const productErrors: string[] = [];
  const rtsErrors: string[] = [];

  for (const { level1, level2 } of categories) {
    if (!level2 || (level2Counts.get(level2) ?? 0) > 1) continue;

    const newType = buildProductType(level1, level2);

    const { data: affected, error: selectErr } = await supabase
      .from('products')
      .select('id')
      .eq('level2_category', level2)
      .neq('level1_category', level1);

    if (selectErr) {
      productErrors.push(selectErr.message);
      continue;
    }
    if (!affected?.length) continue;

    const { error: productsErr } = await supabase
      .from('products')
      .update({ level1_category: level1 })
      .eq('level2_category', level2)
      .neq('level1_category', level1);

    if (productsErr) productErrors.push(productsErr.message);

    const ids = affected.map((p) => p.id);
    const { error: rtsErr } = await supabase
      .from('ready_to_shopify')
      .update({ product_type: newType })
      .in('product_id', ids);

    if (rtsErr) rtsErrors.push(rtsErr.message);
  }

  return { productErrors, rtsErrors };
}

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
  _categories: { level1: string; level2: string }[],
): Promise<{ productErrors: string[]; rtsErrors: string[] }> {
  const { data, error } = await supabase.rpc('reconcile_category_registry');
  if (error) return { productErrors: [error.message], rtsErrors: [] };
  const productsUpdated = Number((data as { products_updated?: number })?.products_updated ?? 0);
  const rtsUpdated = Number((data as { rts_updated?: number })?.rts_updated ?? 0);
  if (productsUpdated === 0 && rtsUpdated === 0) {
    return { productErrors: [], rtsErrors: [] };
  }
  return { productErrors: [], rtsErrors: [] };
}

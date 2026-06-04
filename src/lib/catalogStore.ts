// ============================================================================
// Product Catalog (產品目錄) — Supabase-backed membership.
// Catalog membership lives in products.in_catalog (boolean) so every user on
// every device sees the same catalog. The 產品目錄 page queries
// products WHERE in_catalog = true. No separate table needed.
// ============================================================================
import { supabase } from './supabase';

/** Add product IDs to the catalog (set in_catalog = true). Returns ok + count. */
export async function addToCatalog(ids: string[]): Promise<{ ok: boolean; count: number; error?: string }> {
  if (ids.length === 0) return { ok: true, count: 0 };
  try {
    const { error } = await supabase
      .from('products')
      .update({ in_catalog: true })
      .in('id', ids);
    if (error) return { ok: false, count: 0, error: error.message };
    return { ok: true, count: ids.length };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : '加入失敗' };
  }
}

/** Remove product IDs from the catalog (set in_catalog = false). */
export async function removeFromCatalog(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  if (ids.length === 0) return { ok: true };
  try {
    const { error } = await supabase
      .from('products')
      .update({ in_catalog: false })
      .in('id', ids);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '移除失敗' };
  }
}

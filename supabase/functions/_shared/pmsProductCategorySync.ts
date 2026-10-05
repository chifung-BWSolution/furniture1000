import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type CategoryRowPayload = {
  id: string;
  level1: string;
  level2: string;
  sort_order: number;
  previousLevel1?: string;
  previousLevel2?: string;
};

const BLOCKED_TEST_CATEGORIES = new Set([
  "test lv1|test lv 2",
  "test lv1|test lv2",
]);

export function isBlockedTestCategory(level1: string, level2: string): boolean {
  const key = `${level1.trim().toLowerCase()}|${level2.trim().toLowerCase()}`;
  return BLOCKED_TEST_CATEGORIES.has(key);
}

export function isSyncOriginPms(req: Request, body: Record<string, unknown>): boolean {
  const header = req.headers.get("x-sync-origin")?.trim().toLowerCase();
  if (header === "pms") return true;
  const fromBody = (body.syncOrigin ?? body.sync_origin) as string | undefined;
  return fromBody?.trim().toLowerCase() === "pms";
}

/** Active PMS product_types: display = level1, is_active true, bubble_id null. */
async function findActiveProductTypeByDisplay(
  pms: SupabaseClient,
  level1: string,
): Promise<{ id: string; display: string } | null> {
  const { data, error } = await pms
    .from("product_types")
    .select("id, display")
    .eq("display", level1)
    .eq("is_active", true)
    .is("bubble_id", null)
    .maybeSingle();
  if (error) throw new Error(`product_types lookup failed: ${error.message}`);
  return data as { id: string; display: string } | null;
}

async function upsertActiveProductTypeForLevel1(
  pms: SupabaseClient,
  level1: string,
): Promise<string> {
  const existing = await findActiveProductTypeByDisplay(pms, level1);
  if (existing?.id) return existing.id;

  const { data: inserted, error: insErr } = await pms
    .from("product_types")
    .insert({
      display: level1,
      is_active: true,
      bubble_id: null,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`product_types insert failed: ${insErr.message}`);
  return inserted.id as string;
}

async function renameActiveProductTypeLevel1(
  pms: SupabaseClient,
  oldLevel1: string,
  newLevel1: string,
): Promise<void> {
  if (!oldLevel1 || !newLevel1 || oldLevel1 === newLevel1) return;

  const activeOld = await findActiveProductTypeByDisplay(pms, oldLevel1);
  if (!activeOld?.id) return;

  const activeNew = await findActiveProductTypeByDisplay(pms, newLevel1);
  if (activeNew?.id && activeNew.id !== activeOld.id) return;

  const { error: updErr } = await pms
    .from("product_types")
    .update({ display: newLevel1 })
    .eq("id", activeOld.id)
    .eq("is_active", true)
    .is("bubble_id", null);
  if (updErr) throw new Error(`product_types display rename failed: ${updErr.message}`);
}

async function findProductByCategoryId(
  pms: SupabaseClient,
  categoryId: string,
): Promise<{ id: string; display: string | null; product_types_id: string | null } | null> {
  const { data, error } = await pms
    .from("bwf_products")
    .select("id, display, product_types_id")
    .eq("furniture_category_id", categoryId)
    .maybeSingle();
  if (error) throw new Error(`bwf_products lookup failed: ${error.message}`);
  return data as { id: string; display: string | null; product_types_id: string | null } | null;
}

async function productReferencedByOrders(
  pms: SupabaseClient,
  productId: string,
): Promise<boolean> {
  const { count, error } = await pms
    .from("bwf_orders")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  if (error) throw new Error(`bwf_orders lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function pushCategoryCreateToPms(
  pms: SupabaseClient,
  row: CategoryRowPayload,
): Promise<void> {
  const level1 = row.level1.trim();
  const level2 = row.level2.trim();
  if (isBlockedTestCategory(level1, level2)) return;
  const productTypeId = await upsertActiveProductTypeForLevel1(pms, level1);

  const linked = await findProductByCategoryId(pms, row.id);
  if (linked?.id) {
    const { error: updErr } = await pms
      .from("bwf_products")
      .update({
        display: level2,
        product_types_id: productTypeId,
        furniture_category_id: row.id,
        is_active: true,
        bubble_id: null,
      })
      .eq("id", linked.id);
    if (updErr) throw new Error(`bwf_products re-link failed: ${updErr.message}`);
    return;
  }

  const { error: insErr } = await pms.from("bwf_products").insert({
    display: level2,
    product_types_id: productTypeId,
    furniture_category_id: row.id,
    is_active: true,
    bubble_id: null,
  });
  if (insErr) throw new Error(`bwf_products insert failed: ${insErr.message}`);
}

export async function pushCategoryUpdateToPms(
  pms: SupabaseClient,
  row: CategoryRowPayload,
): Promise<void> {
  const level1 = row.level1.trim();
  const level2 = row.level2.trim();
  const prevL1 = (row.previousLevel1 ?? row.level1).trim();
  const prevL2 = (row.previousLevel2 ?? row.level2).trim();

  const productTypeId = await upsertActiveProductTypeForLevel1(pms, level1);

  const linked = await findProductByCategoryId(pms, row.id);
  if (!linked?.id) {
    await pushCategoryCreateToPms(pms, row);
    return;
  }

  const level2Changed = prevL2 !== level2;
  const level1Moved = prevL1 !== level1;
  if (!level2Changed && !level1Moved) return;

  const { error: updErr } = await pms
    .from("bwf_products")
    .update({
      display: level2,
      product_types_id: productTypeId,
    })
    .eq("id", linked.id);
  if (updErr) throw new Error(`bwf_products update failed: ${updErr.message}`);
}

export async function pushCategoryDeleteToPms(
  pms: SupabaseClient,
  categoryId: string,
): Promise<void> {
  const linked = await findProductByCategoryId(pms, categoryId);
  if (!linked?.id) return;

  const inOrders = await productReferencedByOrders(pms, linked.id);
  if (inOrders) {
    const { error: unlinkErr } = await pms
      .from("bwf_products")
      .update({ furniture_category_id: null })
      .eq("id", linked.id);
    if (unlinkErr) {
      throw new Error(`bwf_products unlink (orders) failed: ${unlinkErr.message}`);
    }
    return;
  }

  const { error: softErr } = await pms
    .from("bwf_products")
    .update({
      is_active: false,
      furniture_category_id: null,
    })
    .eq("id", linked.id);
  if (softErr) throw new Error(`bwf_products deactivate failed: ${softErr.message}`);
}

export async function pushProductCategoryBatchToPms(
  pms: SupabaseClient,
  payload: {
    creates: CategoryRowPayload[];
    updates: CategoryRowPayload[];
    deletes: string[];
  },
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const level1Renames = new Map<string, string>();

  for (const row of payload.updates) {
    const prevL1 = (row.previousLevel1 ?? row.level1).trim();
    const level1 = row.level1.trim();
    if (prevL1 !== level1) level1Renames.set(prevL1, level1);
  }

  for (const [oldL1, newL1] of level1Renames) {
    try {
      await renameActiveProductTypeLevel1(pms, oldL1, newL1);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  for (const id of payload.deletes) {
    try {
      await pushCategoryDeleteToPms(pms, id);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  for (const row of payload.updates) {
    try {
      await pushCategoryUpdateToPms(pms, row);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  for (const row of payload.creates) {
    try {
      await pushCategoryCreateToPms(pms, row);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  return { errors };
}

export async function applyProductCategoryBatchFromPms(
  furniture: SupabaseClient,
  payload: {
    creates: CategoryRowPayload[];
    updates: CategoryRowPayload[];
    deletes: string[];
  },
): Promise<{ errors: string[] }> {
  const errors: string[] = [];

  for (const id of payload.deletes) {
    const { error } = await furniture.from("product_category").delete().eq("id", id);
    if (error) errors.push(`product_category delete ${id}: ${error.message}`);
  }

  for (const row of payload.updates) {
    const { error } = await furniture
      .from("product_category")
      .update({
        level1: row.level1.trim(),
        level2: row.level2.trim(),
        sort_order: row.sort_order,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) errors.push(`product_category update ${row.id}: ${error.message}`);
  }

  for (const row of payload.creates) {
    const { error } = await furniture.from("product_category").upsert(
      {
        id: row.id,
        level1: row.level1.trim(),
        level2: row.level2.trim(),
        sort_order: row.sort_order,
      },
      { onConflict: "id" },
    );
    if (error) errors.push(`product_category create ${row.id}: ${error.message}`);
  }

  return { errors };
}

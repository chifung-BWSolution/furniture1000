import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type CategoryRowPayload = {
  id: string;
  level1: string;
  level2: string;
  sort_order: number;
  previousLevel1?: string;
  previousLevel2?: string;
};

export function buildCategoryLabel(level1: string, level2: string): string {
  return `${level1} · ${level2}`;
}

export function isSyncOriginPms(req: Request, body: Record<string, unknown>): boolean {
  const header = req.headers.get("x-sync-origin")?.trim().toLowerCase();
  if (header === "pms") return true;
  const fromBody = (body.syncOrigin ?? body.sync_origin) as string | undefined;
  return fromBody?.trim().toLowerCase() === "pms";
}

async function findProductTypeIdByLevel1(
  pms: SupabaseClient,
  level1: string,
): Promise<string | null> {
  const { data, error } = await pms
    .from("product_types")
    .select("id")
    .eq("furniture_level1", level1)
    .maybeSingle();
  if (error) throw new Error(`product_types lookup failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

async function maybeRenameProductTypeLevel1(
  pms: SupabaseClient,
  oldLevel1: string,
  newLevel1: string,
): Promise<void> {
  if (!oldLevel1 || !newLevel1 || oldLevel1 === newLevel1) return;

  const { data: oldRows, error: oldErr } = await pms
    .from("product_types")
    .select("id")
    .eq("furniture_level1", oldLevel1);
  if (oldErr) throw new Error(`product_types old level1 check failed: ${oldErr.message}`);
  if ((oldRows?.length ?? 0) !== 1) return;

  const { data: newRows, error: newErr } = await pms
    .from("product_types")
    .select("id")
    .eq("furniture_level1", newLevel1);
  if (newErr) throw new Error(`product_types new level1 check failed: ${newErr.message}`);
  if ((newRows?.length ?? 0) > 0) return;

  const { error: updErr } = await pms
    .from("product_types")
    .update({ furniture_level1: newLevel1 })
    .eq("id", oldRows![0].id);
  if (updErr) throw new Error(`product_types furniture_level1 rename failed: ${updErr.message}`);
}

async function ensureProductTypeLink(
  pms: SupabaseClient,
  productId: string,
  productTypeId: string,
): Promise<void> {
  const { data: existing, error: selErr } = await pms
    .from("bwf_product_product_types")
    .select("id")
    .eq("product_id", productId)
    .eq("product_type_id", productTypeId)
    .maybeSingle();
  if (selErr) throw new Error(`bwf_product_product_types lookup failed: ${selErr.message}`);
  if (existing?.id) return;

  const { error: insErr } = await pms.from("bwf_product_product_types").insert({
    product_id: productId,
    product_type_id: productTypeId,
  });
  if (insErr) throw new Error(`bwf_product_product_types insert failed: ${insErr.message}`);
}

export async function pushCategoryCreateToPms(
  pms: SupabaseClient,
  row: CategoryRowPayload,
): Promise<void> {
  const level1 = row.level1.trim();
  const level2 = row.level2.trim();
  const label = buildCategoryLabel(level1, level2);

  const { error: catErr } = await pms.from("furniture_product_categories").upsert(
    {
      id: row.id,
      level1,
      level2,
      label,
      sort_order: row.sort_order,
    },
    { onConflict: "id" },
  );
  if (catErr) {
    throw new Error(`furniture_product_categories upsert failed: ${catErr.message}`);
  }

  const { data: linked, error: linkErr } = await pms
    .from("bwf_products")
    .select("id, display, product_types_id")
    .eq("furniture_category_id", row.id)
    .maybeSingle();
  if (linkErr) throw new Error(`bwf_products lookup failed: ${linkErr.message}`);

  let productId = linked?.id as string | undefined;
  if (!productId) {
    const productTypesId = await findProductTypeIdByLevel1(pms, level1);
    const { data: inserted, error: insErr } = await pms
      .from("bwf_products")
      .insert({
        display: level2,
        furniture_category_id: row.id,
        product_types_id: productTypesId,
      })
      .select("id, product_types_id")
      .single();
    if (insErr) throw new Error(`bwf_products insert failed: ${insErr.message}`);
    productId = inserted.id as string;
    const ptId = inserted.product_types_id as string | null;
    if (ptId && productId) {
      await ensureProductTypeLink(pms, productId, ptId);
    }
    return;
  }

  const ptId = linked?.product_types_id as string | null;
  if (ptId && productId) {
    await ensureProductTypeLink(pms, productId, ptId);
  }
}

export async function pushCategoryUpdateToPms(
  pms: SupabaseClient,
  row: CategoryRowPayload,
): Promise<void> {
  const level1 = row.level1.trim();
  const level2 = row.level2.trim();
  const label = buildCategoryLabel(level1, level2);
  const prevL1 = (row.previousLevel1 ?? row.level1).trim();
  const prevL2 = (row.previousLevel2 ?? row.level2).trim();

  const { error: catErr } = await pms
    .from("furniture_product_categories")
    .update({ level1, level2, label, sort_order: row.sort_order })
    .eq("id", row.id);
  if (catErr) {
    throw new Error(`furniture_product_categories update failed: ${catErr.message}`);
  }

  if (prevL1 !== level1) {
    await maybeRenameProductTypeLevel1(pms, prevL1, level1);
  }

  const { data: linked, error: linkErr } = await pms
    .from("bwf_products")
    .select("id, display")
    .eq("furniture_category_id", row.id)
    .maybeSingle();
  if (linkErr) throw new Error(`bwf_products lookup failed: ${linkErr.message}`);

  if (linked?.id && (linked.display as string) === prevL2) {
    const { error: dispErr } = await pms
      .from("bwf_products")
      .update({ display: level2 })
      .eq("id", linked.id);
    if (dispErr) throw new Error(`bwf_products display update failed: ${dispErr.message}`);
  }
}

export async function pushCategoryDeleteToPms(
  pms: SupabaseClient,
  categoryId: string,
): Promise<void> {
  const { error: unlinkErr } = await pms
    .from("bwf_products")
    .update({ furniture_category_id: null })
    .eq("furniture_category_id", categoryId);
  if (unlinkErr) {
    throw new Error(`bwf_products unlink failed: ${unlinkErr.message}`);
  }

  const { error: delErr } = await pms
    .from("furniture_product_categories")
    .delete()
    .eq("id", categoryId);
  if (delErr) {
    throw new Error(`furniture_product_categories delete failed: ${delErr.message}`);
  }
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

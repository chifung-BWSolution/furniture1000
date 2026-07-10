/**
 * PMS-aligned audit fields for Furniture tables.
 *
 * creator_staff_id / editor_staff_id store PMS public.staff.id (UUID),
 * resolved via auth.users.id → PMS users.auth_user_id → users.member_id.
 * Never store Furniture auth.users.id, users.id, email, or display name.
 */

import { getCurrentPmsStaffId } from '@/lib/pmsStaff';

export type InsertAuditFields = {
  created_date: string;
  modified_date: string;
  creator_staff_id: string | null;
  editor_staff_id: string | null;
};

export type UpdateAuditFields = {
  modified_date: string;
  editor_staff_id: string | null;
};

/** Audit columns to set on INSERT (all four). */
export async function withInsertAuditFields<T extends Record<string, unknown>>(
  payload: T,
): Promise<T & InsertAuditFields> {
  const now = new Date().toISOString();
  const staffId = await getCurrentPmsStaffId();
  return {
    ...payload,
    created_date: now,
    modified_date: now,
    creator_staff_id: staffId,
    editor_staff_id: staffId,
  };
}

/** Audit columns to set on UPDATE (never touch created_date / creator_staff_id). */
export async function withUpdateAuditFields<T extends Record<string, unknown>>(
  payload: T,
): Promise<T & UpdateAuditFields> {
  const now = new Date().toISOString();
  const staffId = await getCurrentPmsStaffId();
  return {
    ...payload,
    modified_date: now,
    editor_staff_id: staffId,
  };
}

/**
 * For upsert batches: new rows get full insert audit; existing rows get update audit only.
 * Avoids overwriting creator_staff_id / created_date on conflict.
 */
export async function withUpsertAuditFields<T extends { id: string }>(
  rows: T[],
  existingIds: Set<string>,
): Promise<(T & Partial<InsertAuditFields> & UpdateAuditFields)[]> {
  const now = new Date().toISOString();
  const staffId = await getCurrentPmsStaffId();
  return rows.map((row) => {
    if (existingIds.has(row.id)) {
      return {
        ...row,
        modified_date: now,
        editor_staff_id: staffId,
      };
    }
    return {
      ...row,
      created_date: now,
      modified_date: now,
      creator_staff_id: staffId,
      editor_staff_id: staffId,
    };
  });
}

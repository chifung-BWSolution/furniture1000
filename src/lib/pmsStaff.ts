import { supabase } from '@/lib/supabase';
import { fetchStaffByIdsFromMaster } from '@/lib/supabaseMaster';
import { fetchPmsStaffFromMaster } from '@/lib/supabaseMaster';

export type PmsStaffInfo = {
  staff_id: string | null;
  name: string | null;
};

let cachedAuthUserId: string | null = null;
let cachedInfo: PmsStaffInfo | null = null;
let inflight: Promise<PmsStaffInfo> | null = null;

function normalizeInfo(raw: { staff_id?: unknown; name?: unknown } | null | undefined): PmsStaffInfo {
  const staff_id =
    typeof raw?.staff_id === 'string' && raw.staff_id.trim()
      ? raw.staff_id.trim()
      : null;
  const name =
    typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  return { staff_id, name };
}

/** Clear cached PMS staff lookup (call on logout / auth user change). */
export function clearPmsStaffCache(): void {
  cachedAuthUserId = null;
  cachedInfo = null;
  inflight = null;
}

/**
 * Fetch PMS staff_id + name for the logged-in user.
 * Prefer the authenticated edge function; fall back to master client.
 * Results are cached per auth user for the session.
 */
export async function fetchPmsStaffInfo(authUserId?: string | null): Promise<PmsStaffInfo> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const uid = authUserId || session?.user?.id || null;

  if (!uid) {
    clearPmsStaffCache();
    return { staff_id: null, name: null };
  }

  if (cachedAuthUserId === uid && cachedInfo) {
    return cachedInfo;
  }

  if (cachedAuthUserId === uid && inflight) {
    return inflight;
  }

  const promise = (async (): Promise<PmsStaffInfo> => {
    try {
      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-fetch-pms-staff-name',
        { body: {} },
      );

      if (!error && data && !data.error) {
        const info = normalizeInfo(data);
        if (info.staff_id || info.name) {
          cachedAuthUserId = uid;
          cachedInfo = info;
          return info;
        }
      }

      if (error) {
        console.warn('[fetchPmsStaffInfo] edge function failed:', error.message);
      } else if (data?.error) {
        console.warn('[fetchPmsStaffInfo] edge function error:', data.error);
      }
    } catch (err) {
      console.warn('[fetchPmsStaffInfo] invoke failed:', err);
    }

    const fallback = await fetchPmsStaffFromMaster(uid);
    cachedAuthUserId = uid;
    cachedInfo = fallback;
    return fallback;
  })();

  inflight = promise;

  try {
    return await promise;
  } finally {
    if (inflight === promise) inflight = null;
  }
}

/**
 * Resolve PMS v3 staff.name for the logged-in user.
 * Prefer the authenticated edge function (works without VITE_MASTER_SUPABASE_ANON_KEY).
 */
export async function fetchPmsStaffName(authUserId: string): Promise<string | null> {
  const info = await fetchPmsStaffInfo(authUserId);
  return info.name;
}

/**
 * Resolve current PMS public.staff.id (UUID) for audit columns.
 * Cached per session; returns null if unresolved — never invent IDs.
 */
export async function getCurrentPmsStaffId(): Promise<string | null> {
  const info = await fetchPmsStaffInfo();
  return info.staff_id;
}

export type ResolvedPmsStaff = {
  id: string;
  name: string | null;
  email: string | null;
  display_name: string | null;
};

const STAFF_BATCH_SIZE = 200;

function mergeStaffRows(
  map: Map<string, ResolvedPmsStaff>,
  rows: ResolvedPmsStaff[] | undefined,
): void {
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    map.set(row.id, row);
  }
}

async function invokeStaffResolver(body: {
  staff_ids?: string[];
  auth_user_ids?: string[];
}): Promise<{
  staff: ResolvedPmsStaff[];
  auth_users: ResolvedAuthUserStaff[];
} | null> {
  const slugs = [
    'supabase-functions-resolve-pms-staff-by-ids',
    'resolve-pms-staff-by-ids',
  ];

  for (const slug of slugs) {
    try {
      const { data, error } = await supabase.functions.invoke(slug, { body });
      if (error) {
        console.warn(`[resolvePmsStaff] ${slug} failed:`, error.message);
        continue;
      }
      const payload = data as {
        error?: string;
        staff?: ResolvedPmsStaff[];
        auth_users?: ResolvedAuthUserStaff[];
      } | null;
      if (payload?.error) {
        console.warn(`[resolvePmsStaff] ${slug} error:`, payload.error);
        continue;
      }
      return {
        staff: payload?.staff ?? [],
        auth_users: payload?.auth_users ?? [],
      };
    } catch (err) {
      console.warn(`[resolvePmsStaff] ${slug} unexpected error:`, err);
    }
  }
  return null;
}

export type ResolvedAuthUserStaff = {
  auth_user_id: string;
  staff_id: string | null;
  name: string | null;
  email: string | null;
  display_name: string | null;
};

/** Batch-resolve PMS staff.id → name + email (for upload_log historical enrichment). */
export async function resolvePmsStaffByIds(staffIds: string[]): Promise<Map<string, ResolvedPmsStaff>> {
  const unique = Array.from(new Set(staffIds.map((id) => id.trim()).filter(Boolean)));
  const map = new Map<string, ResolvedPmsStaff>();
  if (unique.length === 0) return map;

  for (let i = 0; i < unique.length; i += STAFF_BATCH_SIZE) {
    const chunk = unique.slice(i, i + STAFF_BATCH_SIZE);
    const resolved = await invokeStaffResolver({ staff_ids: chunk });
    mergeStaffRows(map, resolved?.staff);
  }

  const missing = unique.filter((id) => !map.has(id));
  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += STAFF_BATCH_SIZE) {
      const chunk = missing.slice(i, i + STAFF_BATCH_SIZE);
      const fallback = await fetchStaffByIdsFromMaster(chunk);
      mergeStaffRows(map, fallback);
    }
  }
  return map;
}

/** Batch-resolve Furniture auth.users.id → PMS staff name (for upload_log rows). */
export async function resolvePmsStaffByAuthUserIds(
  authUserIds: string[],
): Promise<Map<string, ResolvedAuthUserStaff>> {
  const unique = Array.from(new Set(authUserIds.map((id) => id.trim()).filter(Boolean)));
  const map = new Map<string, ResolvedAuthUserStaff>();
  if (unique.length === 0) return map;

  for (let i = 0; i < unique.length; i += STAFF_BATCH_SIZE) {
    const chunk = unique.slice(i, i + STAFF_BATCH_SIZE);
    const resolved = await invokeStaffResolver({ auth_user_ids: chunk });
    for (const row of resolved?.auth_users ?? []) {
      if (!row?.auth_user_id) continue;
      map.set(row.auth_user_id, row);
    }
  }

  const missing = unique.filter((id) => !map.has(id));
  for (const authUserId of missing) {
    const fallback = await fetchPmsStaffFromMaster(authUserId);
    if (fallback.staff_id || fallback.name) {
      map.set(authUserId, {
        auth_user_id: authUserId,
        staff_id: fallback.staff_id,
        name: fallback.name,
        email: null,
        display_name: fallback.name,
      });
    }
  }
  return map;
}

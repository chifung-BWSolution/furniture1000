import { supabase } from '@/lib/supabase';
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

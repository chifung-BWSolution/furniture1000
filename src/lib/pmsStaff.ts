import { supabase } from '@/lib/supabase';
import { fetchPmsStaffNameFromMaster } from '@/lib/supabaseMaster';

/**
 * Resolve PMS v3 staff.name for the logged-in user.
 * Prefer the authenticated edge function (works without VITE_MASTER_SUPABASE_ANON_KEY).
 */
export async function fetchPmsStaffName(authUserId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke(
      'supabase-functions-fetch-pms-staff-name',
      { body: {} },
    );

    if (!error && data?.name) {
      return String(data.name).trim() || null;
    }

    if (error) {
      console.warn('[fetchPmsStaffName] edge function failed:', error.message);
    } else if (data?.error) {
      console.warn('[fetchPmsStaffName] edge function error:', data.error);
    }
  } catch (err) {
    console.warn('[fetchPmsStaffName] invoke failed:', err);
  }

  return fetchPmsStaffNameFromMaster(authUserId);
}

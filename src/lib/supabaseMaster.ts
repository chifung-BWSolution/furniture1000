import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Secondary Supabase client for the Global Master Project (kqwktnplkqucsbasyfjl).
 * 
 * This client connects to the archive/master project that holds the
 * `bwf_product_master` table — a permanent record of all products
 * ever published to Shopify.
 * 
 * The master project is SEPARATE from the primary operational project
 * (which holds `products`, `product_variants`, `shopify_connections`).
 * 
 * Products are NEVER deleted from bwf_product_master — it serves as
 * the permanent archive.
 */

const MASTER_PROJECT_URL = 'https://kqwktnplkqucsbasyfjl.supabase.co';

// The master project anon key — used for client-side reads/writes
// with RLS policies allowing public access on bwf_product_master.
// For write operations from the edge function, we use the service role key instead.
const MASTER_ANON_KEY = import.meta.env.VITE_MASTER_SUPABASE_ANON_KEY || '';

let masterClient: SupabaseClient | null = null;

/**
 * Get the master Supabase client.
 * Returns null if the anon key is not configured.
 */
export function getMasterSupabaseClient(): SupabaseClient | null {
  if (!MASTER_ANON_KEY) {
    console.warn(
      '[supabaseMaster] VITE_MASTER_SUPABASE_ANON_KEY is not set. ' +
      'Master project writes will only happen via the edge function.'
    );
    return null;
  }

  if (!masterClient) {
    masterClient = createClient(MASTER_PROJECT_URL, MASTER_ANON_KEY);
  }

  return masterClient;
}

/**
 * Master project constants for use in edge functions.
 */
export const MASTER_PROJECT_CONFIG = {
  url: MASTER_PROJECT_URL,
  projectId: 'kqwktnplkqucsbasyfjl',
} as const;

export type PmsStaffInfoFromMaster = {
  staff_id: string | null;
  name: string | null;
};

/**
 * Resolve PMS v3 staff.id + name for the logged-in auth user via public.users.member_id.
 * Used as a fallback when the edge function is unavailable.
 */
export async function fetchPmsStaffFromMaster(authUserId: string): Promise<PmsStaffInfoFromMaster> {
  const client = getMasterSupabaseClient();
  if (!client) return { staff_id: null, name: null };

  const { data, error } = await client
    .from('users')
    .select('member_id, staff!fk_users_member_id(id, name)')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    console.warn('[fetchPmsStaffFromMaster]', error.message);
    return { staff_id: null, name: null };
  }

  const row = data as {
    member_id?: string | null;
    staff?: { id?: string | null; name?: string | null } | { id?: string | null; name?: string | null }[] | null;
  } | null;
  const staff = row?.staff;
  const staffRow = Array.isArray(staff) ? staff[0] : staff;
  const staff_id =
    staffRow?.id?.trim() || row?.member_id?.trim() || null;
  const name = staffRow?.name?.trim() || null;
  return { staff_id, name };
}

/** @deprecated Prefer fetchPmsStaffFromMaster — kept for call-site compatibility. */
export async function fetchPmsStaffNameFromMaster(authUserId: string): Promise<string | null> {
  const info = await fetchPmsStaffFromMaster(authUserId);
  return info.name;
}

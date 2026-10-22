// ============================================================================
// Admin settings data layer — 用戶管理 / 登入紀錄
// Reads real PMS staff + client_companies via fetch-platform-admin edge function.
// ============================================================================
import { supabase } from '@/lib/supabase';
import type { LogType, PlatformUser, UserRole } from '@/constants/analytics-mock';
import { mergeUploadActivityLogs } from '@/lib/loginLogEnrichment';

export interface LoginLog {
  id: string;
  user: string;
  email?: string;
  type: LogType;
  /** Page / product context for edit rows */
  detail?: string;
  /** Product SKUs for publish rows (and optional edit rows) */
  skus?: string[];
  ip: string;
  location: string;
  at: string;
  suspicious: boolean;
}

export interface SecurityTrendPoint {
  day: string;
  成功: number;
  失敗: number;
}

export interface PlatformAdminData {
  users: PlatformUser[];
  logs: LoginLog[];
  securityTrend: SecurityTrendPoint[];
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

async function invokeAdmin(body: Record<string, unknown> = {}): Promise<PlatformAdminData | null> {
  const slugs = [
    'supabase-functions-fetch-platform-admin',
    'fetch-platform-admin',
  ];

  for (const slug of slugs) {
    try {
      const { data, error } = await supabase.functions.invoke(slug, { body });
      if (error) {
        console.warn(`[adminApi] ${slug}:`, error.message);
        continue;
      }
      const payload = data as { error?: string; users?: PlatformUser[]; logs?: LoginLog[]; securityTrend?: SecurityTrendPoint[] };
      if (payload?.error) {
        console.warn(`[adminApi] ${slug} error:`, payload.error);
        continue;
      }
      return {
        users: payload.users ?? [],
        logs: payload.logs ?? [],
        securityTrend: payload.securityTrend ?? [],
      };
    } catch (err) {
      console.warn(`[adminApi] ${slug} unexpected:`, err);
    }
  }
  return null;
}

function mapProfilesToUsers(
  profiles: Array<{
    id: string;
    email: string;
    display_name?: string | null;
    role?: string | null;
    active?: boolean | null;
    last_login_at?: string | null;
  }> | null,
): PlatformUser[] {
  return (profiles ?? []).map((p) => ({
    id: p.id,
    name: p.display_name?.trim() || p.email.split('@')[0],
    email: p.email,
    role: (p.role ?? 'uploader') as UserRole,
    active: p.active ?? true,
    lastLogin: p.last_login_at ?? new Date(0).toISOString(),
  }));
}

/**
 * Call a specific edge action, falling back to the combined `fetch` action so a
 * function deployed before the split still works.
 */
async function invokeAdminAction(action: 'users' | 'logs'): Promise<PlatformAdminData | null> {
  const remote = await invokeAdmin({ action });
  if (remote) return remote;
  return invokeAdmin({ action: 'fetch' });
}

/** Sync + load platform users. Never touches the login log tables. */
async function loadPlatformUsers(): Promise<{ users: PlatformUser[] }> {
  const remote = await invokeAdminAction('users');
  if (remote) return { users: remote.users };

  // Fallback: profiles table only.
  try {
    const { data: profiles } = await supabase
      .from('platform_user_profiles')
      .select('*')
      .order('display_name');
    return { users: mapProfilesToUsers(profiles) };
  } catch {
    return { users: [] };
  }
}

/** Load login / activity logs. Never touches PMS or reconciles profiles. */
async function loadPlatformLogs(): Promise<{
  logs: LoginLog[];
  securityTrend: SecurityTrendPoint[];
}> {
  const remote = await invokeAdminAction('logs');
  if (remote) {
    return {
      logs: await mergeUploadActivityLogs(remote.logs),
      securityTrend: remote.securityTrend,
    };
  }

  // Fallback: client-built upload activity logs.
  try {
    return { logs: await mergeUploadActivityLogs([]), securityTrend: [] };
  } catch {
    return { logs: [], securityTrend: [] };
  }
}

// Share the expensive read when moving between users and login history. Manual
// refresh and account/permission changes always invalidate the short-lived entry.
type AdminCacheEntry<T> = {
  actor: string;
  expiresAt: number;
  data?: T;
  pending?: Promise<T>;
};
const ADMIN_CACHE_TTL_MS = 30_000;
const adminCache = new Map<string, AdminCacheEntry<unknown>>();
function invalidateAdminData() { adminCache.clear(); }
supabase.auth.onAuthStateChange((event) => {
  if (event !== 'TOKEN_REFRESHED') invalidateAdminData();
});

/** Per-resource cache: users and login history never block each other. */
async function cachedAdmin<T>(
  key: string,
  load: () => Promise<T>,
  forceRefresh: boolean,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const actor = session?.user.id;
  if (!actor) return load();
  if (forceRefresh) adminCache.delete(key);

  const existing = adminCache.get(key);
  if (existing?.actor === actor) {
    if (existing.pending) return existing.pending as Promise<T>;
    if (existing.data && existing.expiresAt > Date.now()) return existing.data as T;
  }

  const entry: AdminCacheEntry<T> = { actor, expiresAt: 0 };
  adminCache.set(key, entry as AdminCacheEntry<unknown>);
  entry.pending = load().then((data) => {
    if (adminCache.get(key) === (entry as AdminCacheEntry<unknown>)) {
      entry.data = data;
      entry.expiresAt = Date.now() + ADMIN_CACHE_TTL_MS;
      entry.pending = undefined;
    }
    return data;
  }, (error) => {
    if (adminCache.get(key) === (entry as AdminCacheEntry<unknown>)) adminCache.delete(key);
    throw error;
  });
  return entry.pending;
}

/** 用戶管理 only needs the user list — no login logs, no PMS log queries. */
export async function fetchPlatformUsers(forceRefresh = false): Promise<PlatformUser[]> {
  const { users } = await cachedAdmin('users', loadPlatformUsers, forceRefresh);
  return users;
}

/** 登入紀錄 only needs the logs — no PMS staff sync, no profile reconciliation. */
export async function fetchPlatformLoginLogs(forceRefresh = false): Promise<{
  logs: LoginLog[];
  securityTrend: SecurityTrendPoint[];
}> {
  return cachedAdmin('logs', loadPlatformLogs, forceRefresh);
}

/** Combined read kept for callers that need both halves at once. */
export async function fetchPlatformAdminData(forceRefresh = false): Promise<PlatformAdminData> {
  const [users, logs] = await Promise.all([
    fetchPlatformUsers(forceRefresh),
    fetchPlatformLoginLogs(forceRefresh),
  ]);
  return { users, logs: logs.logs, securityTrend: logs.securityTrend };
}

export async function updatePlatformUserProfile(
  profileId: string,
  patch: { role?: UserRole; active?: boolean },
): Promise<WriteResult> {
  try {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.role !== undefined) row.role = patch.role;
    if (patch.active !== undefined) row.active = patch.active;
    const { error } = await supabase
      .from('platform_user_profiles')
      .update(row)
      .eq('id', profileId);
    if (error) return { ok: false, error: error.message };
    invalidateAdminData();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '更新失敗' };
  }
}

export async function invitePlatformUser(
  email: string,
  role: UserRole,
  displayName?: string,
): Promise<WriteResult> {
  try {
    const normalized = email.trim().toLowerCase();
    const { error } = await supabase.from('platform_user_profiles').upsert({
      email: normalized,
      display_name: displayName?.trim() || normalized.split('@')[0],
      role,
      active: true,
      source: role === 'client' ? 'client' : 'pms',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' });
    if (error) return { ok: false, error: error.message };
    invalidateAdminData();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '邀請失敗' };
  }
}

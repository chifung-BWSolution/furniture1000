// ============================================================================
// Admin settings data layer — 用戶管理 / 登入紀錄
// Reads real PMS staff + client_companies via fetch-platform-admin edge function.
// ============================================================================
import { supabase } from '@/lib/supabase';
import type { LogType, PlatformUser, UserRole } from '@/constants/analytics-mock';

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

/** Sync + load platform users and login logs from real system data. */
export async function fetchPlatformAdminData(): Promise<PlatformAdminData> {
  const remote = await invokeAdmin({ action: 'fetch' });
  if (remote) return remote;

  // Fallback: profiles table only (if edge function unavailable but table exists).
  try {
    const [{ data: profiles }, { data: uploadLogs }] = await Promise.all([
      supabase.from('platform_user_profiles').select('*').order('display_name'),
      supabase
        .from('upload_log')
        .select('id, user_name, user_email, stage, action, logged_at')
        .order('logged_at', { ascending: false })
        .limit(100),
    ]);

    const users: PlatformUser[] = (profiles ?? []).map((p) => ({
      id: p.id,
      name: p.display_name?.trim() || p.email.split('@')[0],
      email: p.email,
      role: (p.role ?? 'uploader') as UserRole,
      active: p.active ?? true,
      lastLogin: p.last_login_at ?? new Date(0).toISOString(),
    }));

    const logs: LoginLog[] = (uploadLogs ?? [])
      .filter((l) => l.user_name !== '歷史紀錄')
      .map((l) => {
        const stageLabels: Record<string, string> = {
          copywriting: '產品文案',
          product_info: '產品信息',
          furniture_group_check: '傢俬組檢查',
          ready_to_publish: '準備上載',
          listed_products: '待處理產品',
          product_catalog: '產品目錄',
        };
        const page = stageLabels[String(l.stage)] || String(l.stage || '系統');
        const type = l.action === 'upload' ? 'publish' as LogType : 'edit' as LogType;
        return {
          id: `ul-${l.id}`,
          user: l.user_name?.trim() || l.user_email || '未知用戶',
          type,
          detail: page,
          ip: '—',
          location: '系統',
          at: l.logged_at,
          suspicious: false,
        };
      });

    return { users, logs, securityTrend: [] };
  } catch {
    return { users: [], logs: [], securityTrend: [] };
  }
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
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '邀請失敗' };
  }
}

import { supabase } from '@/lib/supabase';
import { fetchPmsStaffName } from '@/lib/pmsStaff';
import { getPublishTimestampHk } from '@/lib/publishTimestamps';

export type LoginLogEvent = 'login' | 'logout';
export type LoginLogMethod = 'password' | 'sso';

const SSO_LOGIN_SKIP_KEY = 'fds_sso_login_pending';

export function markSsoLoginPending(): void {
  try {
    sessionStorage.setItem(SSO_LOGIN_SKIP_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumeSsoLoginPending(): boolean {
  try {
    const v = sessionStorage.getItem(SSO_LOGIN_SKIP_KEY);
    if (v) sessionStorage.removeItem(SSO_LOGIN_SKIP_KEY);
    return Boolean(v);
  } catch {
    return false;
  }
}

/** Record sign-in/out (password or SSO session). SSO exchange also writes server-side in pms-sso. */
export async function writeLoginLog(
  event: LoginLogEvent = 'login',
  method: LoginLogMethod = 'password',
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;

    let name: string | null = null;
    try {
      name = await fetchPmsStaffName(user.id);
    } catch {
      /* non-fatal */
    }

    const { error } = await supabase.from('login_log').insert({
      user_id: user.id,
      user_email: user.email ?? null,
      user_name: name?.trim() || null,
      event,
      login_method: method,
      logged_at: getPublishTimestampHk(),
    });
    if (error) {
      console.warn('[loginLog] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[loginLog] unexpected error:', err);
  }
}

import { supabase } from '@/lib/supabase';
import { fetchPmsStaffName } from '@/lib/pmsStaff';
import { getPublishTimestampHk } from '@/lib/publishTimestamps';

export type LoginLogEvent = 'login' | 'logout';

/** Record password / session login (SSO already tracked in pms_sso_codes). */
export async function writeLoginLog(event: LoginLogEvent = 'login'): Promise<void> {
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
      logged_at: getPublishTimestampHk(),
    });
    if (error) {
      console.warn('[loginLog] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[loginLog] unexpected error:', err);
  }
}

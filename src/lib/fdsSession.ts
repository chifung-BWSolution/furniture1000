import { supabase } from '@/lib/supabase';
import { fetchPmsStaffName } from '@/lib/pmsStaff';

export type ForcedLogoutReason = 'session_replaced' | 'session_expired' | 'signed_out';

const FORCED_LOGOUT_REASON_KEY = 'fds_forced_logout_reason';
const SLUGS = ['supabase-functions-fds-session-guard', 'fds-session-guard'];

export function storeForcedLogoutReason(reason: ForcedLogoutReason): void {
  try {
    sessionStorage.setItem(FORCED_LOGOUT_REASON_KEY, reason);
  } catch {
    /* ignore */
  }
}

export function consumeForcedLogoutReason(): ForcedLogoutReason | null {
  try {
    const raw = sessionStorage.getItem(FORCED_LOGOUT_REASON_KEY);
    if (raw) sessionStorage.removeItem(FORCED_LOGOUT_REASON_KEY);
    if (raw === 'session_replaced' || raw === 'session_expired' || raw === 'signed_out') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

type GuardPayload = {
  ok?: boolean;
  valid?: boolean;
  reason?: string;
};

async function invokeGuard(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<GuardPayload | null> {
  for (const slug of SLUGS) {
    try {
      const { data, error } = await supabase.functions.invoke(slug, {
        body: { ...body, protocol: 'auth-session' },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const status = (error as { context?: { status?: number } } | null)?.context?.status ?? null;
      // The guard can reject a stale access token or return 401 when its Auth
      // lookup fails. Supabase Auth owns token refresh and auth sign-out events.
      if (status === 401) return null;
      if (error) continue;
      return (data ?? null) as GuardPayload | null;
    } catch {
      continue;
    }
  }
  return null;
}

function isForcedReason(reason: unknown): reason is ForcedLogoutReason {
  return reason === 'session_replaced' || reason === 'session_expired' || reason === 'signed_out';
}

export async function registerActiveSession(
  accessToken: string,
  options: { recordLogin: boolean; loginMethod: 'password' | 'sso' },
): Promise<{ ok: true } | { ok: false; reason?: ForcedLogoutReason; network?: boolean }> {
  let userName: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) userName = await fetchPmsStaffName(user.id);
  } catch {
    /* name is optional */
  }

  const payload = await invokeGuard(accessToken, {
    action: 'register_session',
    record_login: options.recordLogin,
    login_method: options.loginMethod,
    user_name: userName,
  });

  if (!payload) return { ok: false, network: true };
  if (payload.valid === false && isForcedReason(payload.reason)) {
    return { ok: false, reason: payload.reason };
  }
  if (payload.valid === true || payload.ok === true) return { ok: true };
  return { ok: false, network: true };
}

export async function verifyActiveSession(
  accessToken: string,
): Promise<{ valid: true } | { valid: false; reason: ForcedLogoutReason }> {
  const payload = await invokeGuard(accessToken, { action: 'verify_session' });
  if (payload?.valid === false && isForcedReason(payload.reason)) {
    return { valid: false, reason: payload.reason };
  }
  return { valid: true };
}

export async function clearActiveSession(accessToken: string | null | undefined): Promise<void> {
  if (!accessToken) return;
  try {
    await invokeGuard(accessToken, { action: 'clear_session', record_login: false });
  } catch {
    /* sign-out must continue */
  }
}

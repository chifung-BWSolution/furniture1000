import { supabase } from '@/lib/supabase';
import { fetchPmsStaffName } from '@/lib/pmsStaff';
import {
  FDS_SESSION_CLOCK_SKEW_MS,
  FDS_SESSION_MAX_AGE_MS,
  FORCED_LOGOUT_MESSAGES,
  isFdsSessionExpired,
  type ForcedLogoutReason,
} from '@/lib/fdsSessionPolicy';

export {
  FDS_SESSION_CLOCK_SKEW_MS,
  FDS_SESSION_MAX_AGE_MS,
  FORCED_LOGOUT_MESSAGES,
  isFdsSessionExpired,
  type ForcedLogoutReason,
};

export type LoginLogEvent = 'login' | 'logout';
export type LoginLogMethod = 'password' | 'sso';

const SSO_LOGIN_SKIP_KEY = 'fds_sso_login_pending';
const FDS_SESSION_ID_KEY = 'fds_session_id';
const FDS_SESSION_STARTED_AT_KEY = 'fds_session_started_at';
const FORCED_LOGOUT_REASON_KEY = 'fds_forced_logout_reason';

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

export function getStoredFdsSessionId(): string | null {
  try {
    return localStorage.getItem(FDS_SESSION_ID_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function storeFdsSessionId(sessionId: string | null | undefined): void {
  try {
    const trimmed = sessionId?.trim();
    if (trimmed) localStorage.setItem(FDS_SESSION_ID_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function getStoredFdsSessionStartedAt(): string | null {
  try {
    return localStorage.getItem(FDS_SESSION_STARTED_AT_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function storeFdsSessionStartedAt(iso: string | null | undefined): void {
  try {
    const trimmed = iso?.trim();
    if (trimmed) localStorage.setItem(FDS_SESSION_STARTED_AT_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function clearStoredFdsSession(): void {
  try {
    localStorage.removeItem(FDS_SESSION_ID_KEY);
    localStorage.removeItem(FDS_SESSION_STARTED_AT_KEY);
  } catch {
    /* ignore */
  }
}

export function storeForcedLogoutReason(reason: ForcedLogoutReason): void {
  try {
    sessionStorage.setItem(FORCED_LOGOUT_REASON_KEY, reason);
  } catch {
    /* ignore */
  }
}

export function peekForcedLogoutReason(): ForcedLogoutReason | null {
  try {
    const v = sessionStorage.getItem(FORCED_LOGOUT_REASON_KEY);
    if (v === 'ip_mismatch' || v === 'session_replaced' || v === 'session_expired') {
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearForcedLogoutReason(): void {
  try {
    sessionStorage.removeItem(FORCED_LOGOUT_REASON_KEY);
  } catch {
    /* ignore */
  }
}

export interface WriteLoginLogResult {
  ok: boolean;
  expired?: boolean;
  reason?: ForcedLogoutReason;
  sessionId?: string | null;
  boundIp?: string | null;
  sessionStartedAt?: string | null;
}

export interface VerifyFdsSessionResult {
  valid: boolean;
  reason?: ForcedLogoutReason;
  sessionId?: string | null;
  boundIp?: string | null;
  sessionStartedAt?: string | null;
  networkError?: boolean;
}

/**
 * Record sign-in/out through `fds-session-guard` so the server captures the true client IP
 * and binds the active session (browsers cannot write directly to `login_log`).
 */
export async function writeLoginLog(
  event: LoginLogEvent = 'login',
  method: LoginLogMethod = 'password',
): Promise<WriteLoginLogResult> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return { ok: false };

    let name: string | null = null;
    try {
      name = await fetchPmsStaffName(user.id);
    } catch {
      /* non-fatal */
    }

    const sessionId = getStoredFdsSessionId();
    const { data, error } = await supabase.functions.invoke('fds-session-guard', {
      body: {
        action: event === 'logout' ? 'record_logout' : 'record_login',
        login_method: method,
        user_name: name?.trim() || null,
        session_id: sessionId,
      },
    });

    if (error) {
      console.warn('[loginLog] fds-session-guard failed:', error.message);
      if (event === 'logout') clearStoredFdsSession();
      return { ok: false };
    }

    const payload = (data ?? {}) as {
      ok?: boolean;
      expired?: boolean;
      reason?: ForcedLogoutReason;
      sessionId?: string | null;
      boundIp?: string | null;
      sessionStartedAt?: string | null;
    };

    if (event === 'logout') {
      clearStoredFdsSession();
      return { ok: Boolean(payload.ok) };
    }

    if (payload.expired) {
      return {
        ok: false,
        expired: true,
        reason: payload.reason ?? 'session_expired',
      };
    }

    if (payload.sessionId) storeFdsSessionId(payload.sessionId);
    if (payload.sessionStartedAt) storeFdsSessionStartedAt(payload.sessionStartedAt);

    return {
      ok: payload.ok ?? true,
      sessionId: payload.sessionId ?? null,
      boundIp: payload.boundIp ?? null,
      sessionStartedAt: payload.sessionStartedAt ?? null,
    };
  } catch (err) {
    console.warn('[loginLog] unexpected error:', err);
    if (event === 'logout') clearStoredFdsSession();
    return { ok: false };
  }
}

export async function verifyFdsSession(): Promise<VerifyFdsSessionResult> {
  try {
    const { data, error } = await supabase.functions.invoke('fds-session-guard', {
      body: {
        action: 'verify_session',
        session_id: getStoredFdsSessionId(),
      },
    });

    if (error) {
      console.warn('[loginLog] verify_session failed:', error.message);
      return { valid: true, networkError: true };
    }

    const payload = (data ?? {}) as {
      valid?: boolean;
      reason?: ForcedLogoutReason;
      sessionId?: string | null;
      boundIp?: string | null;
      sessionStartedAt?: string | null;
    };

    if (payload.valid === false && payload.reason) {
      return {
        valid: false,
        reason: payload.reason,
        boundIp: payload.boundIp ?? null,
      };
    }

    if (payload.sessionId && !getStoredFdsSessionId()) {
      storeFdsSessionId(payload.sessionId);
    }
    if (payload.sessionStartedAt && !getStoredFdsSessionStartedAt()) {
      storeFdsSessionStartedAt(payload.sessionStartedAt);
    }

    return {
      valid: true,
      sessionId: payload.sessionId ?? null,
      boundIp: payload.boundIp ?? null,
      sessionStartedAt: payload.sessionStartedAt ?? null,
    };
  } catch (err) {
    console.warn('[loginLog] verify_session unexpected error:', err);
    return { valid: true, networkError: true };
  }
}

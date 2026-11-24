import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  clearForcedLogoutReason as clearStoredForcedLogoutReason,
  clearStoredFdsSession,
  consumeSsoLoginPending,
  getStoredFdsSessionId,
  getStoredFdsSessionStartedAt,
  isFdsSessionExpired,
  peekForcedLogoutReason,
  storeForcedLogoutReason,
  verifyFdsSession,
  writeLoginLog,
  type ForcedLogoutReason,
} from '@/lib/loginLog';
import { clearPmsStaffCache, fetchPmsStaffInfo } from '@/lib/pmsStaff';
import { clearPortalToken, clearQuoteShareToken } from '@/lib/customerPortalRoutes';

const SESSION_GUARD_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_GUARD_MIN_GAP_MS = 15 * 1000;

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  forcedLogoutReason: ForcedLogoutReason | null;
  clearForcedLogoutReason: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [forcedLogoutReason, setForcedLogoutReason] = useState<ForcedLogoutReason | null>(() =>
    peekForcedLogoutReason(),
  );

  const forcingLogoutRef = useRef(false);
  const lastGuardCheckAtRef = useRef(0);

  const clearForcedLogoutReason = useCallback(() => {
    clearStoredForcedLogoutReason();
    setForcedLogoutReason(null);
  }, []);

  const forceSignOut = useCallback(async (reason: ForcedLogoutReason) => {
    if (forcingLogoutRef.current) return;
    forcingLogoutRef.current = true;
    try {
      storeForcedLogoutReason(reason);
      setForcedLogoutReason(reason);
      clearStoredFdsSession();
      clearPortalToken();
      clearQuoteShareToken();
      clearPmsStaffCache();
      await supabase.auth.signOut();
      setSession(null);
    } finally {
      forcingLogoutRef.current = false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    // INITIAL_SESSION + SIGNED_IN can both fire on page load for the same user; handle once.
    let bootstrappedUserId: string | null = null;

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (!mounted) return;
      setSession(current);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setLoading(false);

      if (event === 'SIGNED_OUT') {
        bootstrappedUserId = null;
        clearStoredFdsSession();
        clearPmsStaffCache();
        return;
      }

      if (nextSession?.user?.id && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
        const userId = nextSession.user.id;
        if (event === 'SIGNED_IN' && bootstrappedUserId === userId) {
          return;
        }

        const isFreshSignIn = event === 'SIGNED_IN';
        bootstrappedUserId = userId;
        if (isFreshSignIn) {
          clearForcedLogoutReason();
        }

        void fetchPmsStaffInfo(userId);

        if (isFdsSessionExpired(nextSession.user.last_sign_in_at)) {
          void verifyFdsSession();
          void forceSignOut('session_expired');
          return;
        }

        if (consumeSsoLoginPending()) {
          lastGuardCheckAtRef.current = Date.now();
          return;
        }

        if (!isFreshSignIn && getStoredFdsSessionId()) {
          lastGuardCheckAtRef.current = Date.now();
          void verifyFdsSession().then((res) => {
            if (!mounted) return;
            if (!res.valid && res.reason) {
              void forceSignOut(res.reason);
            }
          });
          return;
        }

        lastGuardCheckAtRef.current = Date.now();
        void writeLoginLog('login', 'password').then((res) => {
          if (!mounted) return;
          if (res.expired) {
            void forceSignOut('session_expired');
          }
        });
        return;
      }

      if (nextSession?.user?.id && event === 'USER_UPDATED') {
        clearPmsStaffCache();
        void fetchPmsStaffInfo(nextSession.user.id);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [clearForcedLogoutReason, forceSignOut]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    let cancelled = false;

    const runSecurityCheck = async () => {
      if (cancelled || forcingLogoutRef.current) return;
      const now = Date.now();
      if (now - lastGuardCheckAtRef.current < SESSION_GUARD_MIN_GAP_MS) return;
      lastGuardCheckAtRef.current = now;

      const startedAt = getStoredFdsSessionStartedAt() ?? session.user.last_sign_in_at ?? null;
      if (isFdsSessionExpired(startedAt, now)) {
        void verifyFdsSession();
        void forceSignOut('session_expired');
        return;
      }

      const res = await verifyFdsSession();
      if (cancelled) return;
      if (!res.valid && res.reason) {
        void forceSignOut(res.reason);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runSecurityCheck();
      }
    };

    const handleFocus = () => {
      void runSecurityCheck();
    };

    void runSecurityCheck();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    const intervalId = window.setInterval(() => {
      void runSecurityCheck();
    }, SESSION_GUARD_INTERVAL_MS);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
    };
  }, [session?.user?.id, session?.user?.last_sign_in_at, forceSignOut]);

  const signOut = useCallback(async () => {
    clearForcedLogoutReason();
    await writeLoginLog('logout');
    clearPortalToken();
    clearQuoteShareToken();
    await supabase.auth.signOut();
    clearPmsStaffCache();
    setSession(null);
  }, [clearForcedLogoutReason]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      forcedLogoutReason,
      clearForcedLogoutReason,
      signOut,
    }),
    [session, loading, forcedLogoutReason, clearForcedLogoutReason, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

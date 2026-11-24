import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { consumeSsoLoginPending } from '@/lib/loginLog';
import {
  clearActiveSession,
  registerActiveSession,
  storeForcedLogoutReason,
  verifyActiveSession,
  type ForcedLogoutReason,
} from '@/lib/fdsSession';
import { clearPmsStaffCache, fetchPmsStaffInfo } from '@/lib/pmsStaff';
import { clearPortalToken, clearQuoteShareToken } from '@/lib/customerPortalRoutes';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let sessionLoginRegistered = false;

    const registerSessionLoginOnce = (accessToken: string) => {
      if (sessionLoginRegistered) return;
      sessionLoginRegistered = true;
      const loginMethod = consumeSsoLoginPending() ? 'sso' : 'password';
      void registerActiveSession(accessToken, { recordLogin: true, loginMethod }).then((result) => {
        if (!mounted || result.ok || !('reason' in result) || !result.reason) return;
        storeForcedLogoutReason(result.reason);
        void supabase.auth.signOut({ scope: 'local' });
        setSession(null);
      });
    };

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
        clearPmsStaffCache();
        return;
      }

      // INITIAL_SESSION and SIGNED_IN both fire on a normal page load.
      // Leave any in-flight lookup alone — fetchPmsStaffInfo dedupes by user.
      if (nextSession?.user?.id && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
        void fetchPmsStaffInfo(nextSession.user.id);
        if (nextSession.access_token) registerSessionLoginOnce(nextSession.access_token);
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
  }, []);

  useEffect(() => {
    const accessToken = session?.access_token;
    const userId = session?.user.id;
    if (!accessToken || !userId) return;

    let cancelled = false;
    let inFlight = false;

    const forceSignOut = async (reason: ForcedLogoutReason) => {
      if (cancelled || inFlight) return;
      inFlight = true;
      storeForcedLogoutReason(reason);
      setSession(null);
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        /* local state is already cleared */
      }
    };

    const checkSession = async () => {
      if (cancelled || inFlight) return;
      const result = await verifyActiveSession(accessToken);
      if (cancelled || inFlight) return;
      if (result.valid === false) await forceSignOut(result.reason);
    };

    void checkSession();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    const intervalId = window.setInterval(() => {
      void checkSession();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(intervalId);
    };
  }, [session?.access_token, session?.user.id]);

  const signOut = useCallback(async () => {
    await clearActiveSession(session?.access_token);
    clearPortalToken();
    clearQuoteShareToken();
    await supabase.auth.signOut();
    clearPmsStaffCache();
    setSession(null);
  }, [session?.access_token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut,
    }),
    [session, loading, signOut],
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

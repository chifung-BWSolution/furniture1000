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
import { consumeSsoLoginPending, writeLoginLog } from '@/lib/loginLog';
import { clearPmsStaffCache, fetchPmsStaffInfo } from '@/lib/pmsStaff';
import { clearPortalToken } from '@/lib/customerPortalRoutes';

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
    // INITIAL_SESSION + SIGNED_IN can both fire on page load; log at most once per full load.
    let sessionLoginLogged = false;

    const logSessionLoginOnce = () => {
      if (sessionLoginLogged) return;
      sessionLoginLogged = true;
      if (!consumeSsoLoginPending()) {
        void writeLoginLog('login', 'password');
      }
    };

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (!mounted) return;
      setSession(current);
      setLoading(false);
      if (current?.user?.id) {
        void fetchPmsStaffInfo(current.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setLoading(false);

      // Refresh / clear PMS staff cache on login, SSO, logout (not every token refresh).
      if (event === 'SIGNED_OUT') {
        clearPmsStaffCache();
      } else if (nextSession?.user?.id && event === 'INITIAL_SESSION') {
        clearPmsStaffCache();
        void fetchPmsStaffInfo(nextSession.user.id);
        // Page load / browser refresh with an existing session counts as one login.
        logSessionLoginOnce();
      } else if (nextSession?.user?.id && event === 'SIGNED_IN') {
        clearPmsStaffCache();
        void fetchPmsStaffInfo(nextSession.user.id);
        // Fresh sign-in after logout / password flow (INITIAL_SESSION already handled refresh).
        logSessionLoginOnce();
      } else if (nextSession?.user?.id && event === 'USER_UPDATED') {
        clearPmsStaffCache();
        void fetchPmsStaffInfo(nextSession.user.id);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await writeLoginLog('logout');
    clearPortalToken();
    await supabase.auth.signOut();
    clearPmsStaffCache();
    setSession(null);
  }, []);

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

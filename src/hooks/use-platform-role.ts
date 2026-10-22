import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/contexts/AuthProvider';
import { supabase } from '@/lib/supabase';

export type PlatformRole = 'admin' | 'staff' | 'client' | 'supplier' | null;

/**
 * Read-only role lookup used to keep client accounts inside 客戶專區.
 * Database/RLS remains the final security boundary.
 */
function usePlatformRoleState() {
  const { user } = useAuth();
  const [role, setRole] = useState<PlatformRole>(null);
  const [profileRole, setProfileRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const email = user?.email?.trim().toLowerCase();
    if (!email) {
      setRole(null);
      setProfileRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from('platform_user_profiles')
      .select('role')
      .ilike('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const next = String(data?.role || '').toLowerCase();
        setProfileRole(next || null);
        setRole(
          next === 'client'
            ? 'client'
            : next === 'supplier'
              ? 'supplier'
              : next === 'admin'
                ? 'admin'
                : 'staff',
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  return { role, profileRole, loading };
}

type PlatformRoleState = ReturnType<typeof usePlatformRoleState>;

const PlatformRoleContext = createContext<PlatformRoleState | null>(null);

/** Resolve the current user's platform role once for the dashboard subtree. */
export function PlatformRoleProvider({ children }: { children: ReactNode }) {
  const roleState = usePlatformRoleState();
  return createElement(PlatformRoleContext.Provider, { value: roleState }, children);
}

export function usePlatformRole() {
  const context = useContext(PlatformRoleContext);
  if (!context) {
    throw new Error('usePlatformRole must be used within PlatformRoleProvider');
  }
  return context;
}

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthProvider';
import { supabase } from '@/lib/supabase';

export type PlatformRole = 'admin' | 'staff' | 'client' | 'supplier' | null;

/**
 * Read-only role lookup used to keep client accounts inside 客戶專區.
 * Database/RLS remains the final security boundary.
 */
export function usePlatformRole() {
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

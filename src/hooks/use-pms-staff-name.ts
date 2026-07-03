import { useEffect, useState } from 'react';
import { fetchPmsStaffName } from '@/lib/supabaseMaster';

/**
 * Load PMS v3 staff.name for the current auth user (public.users → staff).
 * Returns null while loading or when no staff record is linked.
 */
export function usePmsStaffName(authUserId: string | undefined): string | null {
  const [staffName, setStaffName] = useState<string | null>(null);

  useEffect(() => {
    if (!authUserId) {
      setStaffName(null);
      return;
    }

    let cancelled = false;

    fetchPmsStaffName(authUserId).then((name) => {
      if (!cancelled) setStaffName(name);
    });

    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  return staffName;
}

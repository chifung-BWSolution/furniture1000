import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthProvider';
import {
  fetchInvitedProjects,
  fetchClientCompany,
  getClientAuthorName,
} from '@/lib/solutionsApi';
import { readStoredPortalToken } from '@/lib/customerPortalRoutes';
import type { ClientCompany, DesignProject } from '@/types/solutions';

export interface ClientZoneContext {
  loading: boolean;
  projects: DesignProject[];
  company: ClientCompany | null;
  authorName: string;
  clientEmail: string | null;
  shareToken: string | null;
  refresh: () => void;
}

export function useClientZoneContext(): ClientZoneContext {
  const { user } = useAuth();
  const clientEmail = user?.email ?? null;
  const queryToken =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('portal_token')
      : null;
  const shareToken = queryToken || readStoredPortalToken();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [company, setCompany] = useState<ClientCompany | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchInvitedProjects(clientEmail, shareToken),
      fetchClientCompany(clientEmail),
    ]).then(([projs, co]) => {
      if (cancelled) return;
      setProjects(projs);
      setCompany(co);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [clientEmail, shareToken, tick]);

  return {
    loading,
    projects,
    company,
    authorName: getClientAuthorName(company),
    clientEmail,
    shareToken,
    refresh: () => setTick((t) => t + 1),
  };
}

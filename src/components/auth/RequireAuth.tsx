import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthProvider';
import { LoginView } from './LoginView';
import {
  hasActiveQuoteShareAccess,
  storeQuoteShareToken,
} from '@/lib/customerPortalRoutes';

/**
 * Staff app requires login. Quote-share links (`?quote_share=…`) may enter
 * 客戶專區 (報價方案及各 Portal 頁) without email login.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const quoteShareGuest = hasActiveQuoteShareAccess();

  // Persist token before child effects run, so refresh / URL cleanup still works.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search)
      .get('quote_share')
      ?.trim();
    if (token) storeQuoteShareToken(token);
  }, []);

  if (loading && !quoteShareGuest) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user && !quoteShareGuest) {
    return <LoginView />;
  }

  return <>{children}</>;
}

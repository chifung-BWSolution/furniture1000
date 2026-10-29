import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthProvider';
import { LoginView } from './LoginView';
import {
  hasActiveQuoteShareAccess,
  storeQuoteShareToken,
  type QuoteShareLoginState,
} from '@/lib/customerPortalRoutes';

/**
 * Staff app requires login. Quote-share links (`?quote_share=…`) enter
 * 客戶專區「報價方案」without email login — that single page is the guest scope.
 *
 * AppShell drops the guest token when the visitor switches to another portal
 * page (or opens its deep link), so this gate must follow the URL: adding
 * `useLocation` re-evaluates guest access on every navigation and shows the
 * login screen instead of letting the shell survive as a guest.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const quoteShareGuest = hasActiveQuoteShareAccess();
  const gateState = location.state as QuoteShareLoginState | null;
  const quoteShareLogin = Boolean(gateState?.quoteShareLogin);
  const quoteShareReturnTo = gateState?.quoteShareReturnTo;

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
    return (
      <LoginView
        description={
          quoteShareLogin
            ? '此分享連結只開放「報價方案」。登入後即可瀏覽客戶專區其他頁面；只想看報價可按下方返回。'
            : undefined
        }
        onBack={
          quoteShareLogin && quoteShareReturnTo
            ? () => navigate(quoteShareReturnTo)
            : undefined
        }
        backLabel="返回報價方案"
      />
    );
  }

  return <>{children}</>;
}

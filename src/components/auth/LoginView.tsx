import { useEffect, useState } from 'react';
import { LogIn, LoaderCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FdsLogo } from '@/components/brand/FdsLogo';
import { supabase } from '@/lib/supabase';
import { getQuickLoginCredentials, isDevelopQuickLoginBuild } from '@/lib/quick-login';

const PMS_SSO_START_URL = import.meta.env.VITE_PMS_SSO_START_URL?.trim() || '';

function getPmsOrigin(): string | null {
  if (!PMS_SSO_START_URL) return null;
  try {
    return new URL(PMS_SSO_START_URL).origin;
  } catch {
    return null;
  }
}

export function LoginView({
  description,
  onBack,
  backLabel = '返回',
}: {
  /** Overrides the default subtitle (e.g. why a quote-share guest is here). */
  description?: string;
  /** Optional escape hatch shown under the sign-in button. */
  onBack?: () => void;
  backLabel?: string;
} = {}) {
  const useQuickLogin = isDevelopQuickLoginBuild();
  const quickLogin = getQuickLoginCredentials();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (useQuickLogin || !PMS_SSO_START_URL) return;

    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get('return_to');

    // PMS SSO start sends unauthenticated users to APP_URL/login?return_to=...
    // If NEXT_PUBLIC_APP_URL on PMS3.0 points at Furniture, we land here in a loop.
    // Bounce back to PMS login on the correct host.
    if (returnTo?.includes('bwf/sso')) {
      const pmsOrigin = getPmsOrigin();
      if (pmsOrigin) {
        window.location.replace(
          `${pmsOrigin}/login?return_to=${encodeURIComponent(returnTo)}`,
        );
      }
    }
  }, [useQuickLogin]);

  const handleSignIn = () => {
    if (!PMS_SSO_START_URL) {
      console.error('[LoginView] VITE_PMS_SSO_START_URL is not configured');
      return;
    }
    try {
      const start = new URL(PMS_SSO_START_URL, window.location.origin);
      // Preserve deep links (e.g. /project/design-projects/:id, /quote/...) across SSO.
      const redirectTo = `${window.location.pathname}${window.location.search}`;
      if (redirectTo && redirectTo !== '/') {
        start.searchParams.set('redirect_to', redirectTo);
      }
      window.location.href = start.toString();
    } catch {
      window.location.href = PMS_SSO_START_URL;
    }
  };

  const handleQuickLogin = async () => {
    if (!quickLogin || busy) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: quickLogin.email,
      password: quickLogin.password,
    });
    if (error) {
      toast.error('預覽帳戶登入失敗', { description: '請檢查 develop 的 Preview Credential。' });
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border bg-card p-10 text-center shadow-sm">
        <div className="mx-auto">
          <FdsLogo size="lg" className="rounded-2xl" />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            FDS Furniture Design Platform
          </h1>
          <p className="text-sm text-muted-foreground">
            {description ||
              (useQuickLogin
                ? '開發預覽請使用一鍵登入'
                : '請使用 PMS 帳號登入以存取傢俬設計管理平台')}
          </p>
        </div>

        <div className="space-y-3">
          {useQuickLogin ? (
            <Button
              className="h-11 w-full gap-2 text-sm font-semibold"
              onClick={() => void handleQuickLogin()}
              disabled={!quickLogin || busy}
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              一鍵登入
            </Button>
          ) : (
            <Button
              className="h-11 w-full gap-2 text-sm font-semibold"
              onClick={handleSignIn}
              disabled={!PMS_SSO_START_URL || busy}
            >
              <LogIn className="h-4 w-4" />
              使用 PMS 登入
            </Button>
          )}
        </div>

        {onBack ? (
          <Button
            variant="ghost"
            className="h-10 w-full text-sm font-medium"
            onClick={onBack}
            disabled={busy}
          >
            {backLabel}
          </Button>
        ) : null}

        {useQuickLogin && !quickLogin && (
          <p className="text-xs text-destructive">
            未設定預覽帳戶。請在 develop 的 Preview 環境設定 VITE_ENABLE_QUICK_LOGIN、VITE_QUICK_LOGIN_EMAIL、VITE_QUICK_LOGIN_PASSWORD。
          </p>
        )}

        {!useQuickLogin && !PMS_SSO_START_URL && (
          <p className="text-xs text-destructive">
            未設定 VITE_PMS_SSO_START_URL。請聯絡管理員。
          </p>
        )}
      </div>
    </div>
  );
};

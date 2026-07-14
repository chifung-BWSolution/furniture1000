import { useEffect } from 'react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FdsLogo } from '@/components/brand/FdsLogo';

const PMS_SSO_START_URL = import.meta.env.VITE_PMS_SSO_START_URL?.trim() || '';

function getPmsOrigin(): string | null {
  if (!PMS_SSO_START_URL) return null;
  try {
    return new URL(PMS_SSO_START_URL).origin;
  } catch {
    return null;
  }
}

export function LoginView() {
  useEffect(() => {
    if (!PMS_SSO_START_URL) return;

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
  }, []);

  const handleSignIn = () => {
    if (!PMS_SSO_START_URL) {
      console.error('[LoginView] VITE_PMS_SSO_START_URL is not configured');
      return;
    }
    window.location.href = PMS_SSO_START_URL;
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
            請使用 PMS 帳號登入以存取傢俬設計管理平台
          </p>
        </div>

        <Button
          className="h-11 w-full gap-2 text-sm font-semibold"
          onClick={handleSignIn}
          disabled={!PMS_SSO_START_URL}
        >
          <LogIn className="h-4 w-4" />
          使用 PMS 登入
        </Button>

        {!PMS_SSO_START_URL && (
          <p className="text-xs text-destructive">
            未設定 VITE_PMS_SSO_START_URL。請聯絡管理員。
          </p>
        )}
      </div>
    </div>
  );
};

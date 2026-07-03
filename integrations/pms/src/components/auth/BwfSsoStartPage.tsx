import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Chrome } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { getSiteOrigin } from '@/lib/siteUrl';

type StartState = 'loading' | 'login' | 'redirecting' | 'error';

export function BwfSsoStartPage() {
  const { session, loading, isAuthenticated, isAuthorized } = useAuth();
  const [state, setState] = useState<StartState>('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    if (loading) {
      setState('loading');
      return;
    }

    if (!isAuthenticated || !isAuthorized || !session?.user?.email) {
      setState('login');
      return;
    }

    let cancelled = false;

    async function startSso() {
      setState('redirecting');
      try {
        const { data, error } = await supabase.functions.invoke(
          'supabase-functions-bwf-sso-start',
          { body: {} },
        );

        if (cancelled) return;

        if (error) {
          throw new Error(error.message || 'SSO start failed');
        }
        if (data?.error) {
          throw new Error(data.error);
        }
        if (!data?.exchange_url) {
          throw new Error('Missing exchange_url from SSO start');
        }

        window.location.replace(data.exchange_url);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[BwfSsoStartPage]', msg);
        setErrorDetail(msg);
        setState('error');
      }
    }

    startSso();

    return () => {
      cancelled = true;
    };
  }, [loading, isAuthenticated, isAuthorized, session?.user?.email]);

  const handleGoogleLogin = async () => {
    setLoginLoading(true);
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${getSiteOrigin()}/bwf/sso/start`,
        },
      });
    } finally {
      setLoginLoading(false);
    }
  };

  if (state === 'loading' || state === 'redirecting') {
    return (
      <div className="min-h-screen bg-[#f5f8fc] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="text-teal-600 animate-spin" />
          <p className="text-[14px] font-medium text-[#0d1a2d]">
            {state === 'redirecting' ? '正在連接傢俬設計平台…' : '正在驗證身份…'}
          </p>
        </div>
      </div>
    );
  }

  if (state === 'login') {
    return (
      <div className="min-h-screen bg-[#f5f8fc] flex items-center justify-center p-4">
        <div className="w-full max-w-[420px] rounded-2xl border border-border bg-white p-8 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-[#0d1a2d]">前往傢俬設計平台</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            請先使用 PMS 帳號登入，系統會自動帶你進入 Furniture 1000。
          </p>
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loginLoading}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-3 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            <Chrome className="h-4 w-4" />
            {loginLoading ? '正在跳轉…' : '使用 Google 登入'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f8fc] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-500" />
        <h1 className="text-lg font-semibold text-[#0d1a2d]">無法啟動 SSO</h1>
        <p className="mt-2 text-sm text-muted-foreground">{errorDetail}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          重試
        </button>
      </div>
    </div>
  );
}

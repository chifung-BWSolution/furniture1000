import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { resolveSsoPostLoginPath } from '@/lib/ssoRedirect';

type CallbackState = 'processing' | 'success' | 'error';

export function PmsSsoCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>('processing');
  const [message, setMessage] = useState('正在驗證 PMS 登入…');
  const [errorDetail, setErrorDetail] = useState('');

  useEffect(() => {
    async function exchangeCode() {
      const code = searchParams.get('code');
      if (!code) {
        setState('error');
        setMessage('缺少 SSO 驗證碼');
        setErrorDetail('請從 PMS 重新登入，或返回登入頁再試一次。');
        return;
      }

      // Capture before exchange — keep full path + query for post-login navigation.
      const postLoginPath = resolveSsoPostLoginPath(searchParams) || '/';

      try {
        const { data, error } = await supabase.functions.invoke(
          'supabase-functions-pms-sso',
          { body: { action: 'exchange', code } },
        );

        if (error) {
          throw new Error(error.message || 'SSO exchange failed');
        }

        if (data?.error) {
          throw new Error(data.error);
        }

        if (!data?.access_token || !data?.refresh_token) {
          throw new Error('Session tokens missing from exchange response');
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });

        if (sessionError) {
          throw sessionError;
        }

        setState('success');
        setMessage('登入成功，正在進入系統…');
        setTimeout(() => navigate(postLoginPath, { replace: true }), 800);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[PmsSsoCallback]', msg);
        setState('error');
        setMessage('PMS 登入失敗');
        setErrorDetail(msg);
      }
    }

    exchangeCode();
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-10 text-center">
        {state === 'processing' && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{message}</p>
          </>
        )}

        {state === 'success' && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="text-sm font-medium text-foreground">{message}</p>
          </>
        )}

        {state === 'error' && (
          <>
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="text-sm font-semibold text-foreground">{message}</p>
            <p className="text-xs text-muted-foreground">{errorDetail}</p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              返回登入頁
            </button>
          </>
        )}
      </div>
    </div>
  );
}

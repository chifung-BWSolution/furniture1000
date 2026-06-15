import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Loader2, CheckCircle2, XCircle, Copy, Check, Key } from 'lucide-react';
import { toast } from 'sonner';

const PRODUCTION_URL = 'https://tempo-deployment-26c0258f-253c-4e4e.vercel.app';
const SUPABASE_FUNCTION_CALLBACK_URL = 'https://kqwktnplkqucsbasyfjl.supabase.co/functions/v1/supabase-functions-shopify-oauth-callback';

type CallbackState = 'processing' | 'success' | 'error';

export function ShopifyCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>('processing');
  const [message, setMessage] = useState('Processing Shopify authentication...');
  const [errorDetail, setErrorDetail] = useState('');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!accessToken) return;
    try {
      await navigator.clipboard.writeText(accessToken);
      setCopied(true);
      toast.success('Access token copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement('textarea');
      textarea.value = accessToken;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      toast.success('Access token copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    }
  }, [accessToken]);

  useEffect(() => {
    async function handleCallback() {
      // Case 1: Edge function already exchanged the code and redirected with access_token
      const directToken = searchParams.get('access_token');
      const directShop = searchParams.get('shop');
      const directScope = searchParams.get('scope');

      if (directToken && directShop) {
        console.log('[ShopifyCallback] Received pre-exchanged token from edge function redirect');
        console.log('[ShopifyCallback] Shop:', directShop, '| Scope:', directScope);
        
        setState('success');
        setMessage('Shopify connected successfully!');
        setAccessToken(directToken);
        setShowTokenModal(true);

        // Also save to localStorage settings
        try {
          const saved = localStorage.getItem('app-settings');
          const settings = saved ? JSON.parse(saved) : {};
          settings.shopifyApiKey = directToken;
          settings.shopifyStoreUrl = directShop;
          settings.isConnected = true;
          localStorage.setItem('app-settings', JSON.stringify(settings));
        } catch { /* ignore */ }

        return;
      }

      // Case 2: Browser redirect from Shopify with code + shop (exchange needed)
      const code = searchParams.get('code');
      const shop = searchParams.get('shop');
      const hmac = searchParams.get('hmac');
      const state = searchParams.get('state');

      if (!code || !shop) {
        setState('error');
        setMessage('Missing OAuth parameters');
        setErrorDetail(
          'The callback URL is missing required parameters (code, shop). Please try the OAuth flow again from Settings.'
        );
        return;
      }

      try {
        // Exchange the authorization code for an access token via edge function
        const { data, error } = await supabase.functions.invoke(
          'supabase-functions-shopify-oauth-callback',
          {
            body: {
              code,
              shop,
              hmac,
              state,
              redirect_uri: SUPABASE_FUNCTION_CALLBACK_URL,
            },
          }
        );

        if (error) {
          throw new Error(error.message || 'OAuth exchange failed');
        }

        if (data?.success) {
          setState('success');
          setMessage('Shopify connected successfully!');

          // Store the access token for display
          if (data.access_token) {
            setAccessToken(data.access_token);
            setShowTokenModal(true);

            // Also save to localStorage settings
            try {
              const saved = localStorage.getItem('app-settings');
              const settings = saved ? JSON.parse(saved) : {};
              settings.shopifyApiKey = data.access_token;
              settings.shopifyStoreUrl = shop;
              settings.isConnected = true;
              localStorage.setItem('app-settings', JSON.stringify(settings));
            } catch { /* ignore */ }
          }
        } else {
          throw new Error(data?.error || 'Unknown error during OAuth exchange');
        }
      } catch (err) {
        setState('error');
        setMessage('Authentication failed');
        setErrorDetail(
          err instanceof Error ? err.message : 'Unknown error occurred'
        );
      }
    }

    handleCallback();
  }, [searchParams]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      {/* Token Display Modal */}
      {showTokenModal && accessToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                <Key className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold">Shopify Access Token</h3>
                <p className="text-xs text-muted-foreground font-body">
                  Copy this token and add it to your Supabase Edge Function Secrets
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground font-body">
                SHOPIFY_ACCESS_TOKEN
              </label>
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 pr-12 text-xs font-mono-data text-foreground break-all whitespace-pre-wrap">
                  {accessToken}
                </pre>
                <button
                  onClick={handleCopy}
                  className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-xs text-amber-400 font-body">
                <strong>⚠️ Important:</strong> Go to{' '}
                <span className="font-mono-data">
                  Supabase Dashboard → Settings → Edge Functions → Secrets
                </span>{' '}
                and add this as <code className="rounded bg-muted px-1 py-0.5 text-[10px]">SHOPIFY_ACCESS_TOKEN</code>.
                This token will not be shown again.
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy Token
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowTokenModal(false);
                  navigate('/?view=settings', { replace: true });
                }}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted active:scale-[0.98]"
              >
                Continue to Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Status Card */}
      <div className="mx-auto max-w-md space-y-6 rounded-xl border border-border bg-card p-8 text-center shadow-lg">
        <div className="flex justify-center">
          {state === 'processing' && (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          {state === 'success' && (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
          )}
          {state === 'error' && (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10">
              <XCircle className="h-8 w-8 text-rose-500" />
            </div>
          )}
        </div>

        <div>
          <h2 className="font-display text-xl font-bold">{message}</h2>
          {state === 'processing' && (
            <p className="mt-2 text-sm text-muted-foreground font-body">
              Exchanging authorization code with Shopify...
            </p>
          )}
          {state === 'success' && !showTokenModal && (
            <p className="mt-2 text-sm text-emerald-500 font-body">
              Redirecting to Settings...
            </p>
          )}
          {state === 'success' && showTokenModal && (
            <p className="mt-2 text-sm text-emerald-500 font-body">
              Copy your access token from the dialog above.
            </p>
          )}
          {state === 'error' && errorDetail && (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-rose-400 font-body">{errorDetail}</p>
              <button
                onClick={() => navigate('/', { replace: true })}
                className="text-sm text-primary underline font-body hover:text-primary/80"
              >
                Return to Dashboard
              </button>
            </div>
          )}
        </div>

        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-[10px] text-muted-foreground font-mono-data">
            Redirect URI: {SUPABASE_FUNCTION_CALLBACK_URL}
          </p>
        </div>
      </div>
    </div>
  );
}
